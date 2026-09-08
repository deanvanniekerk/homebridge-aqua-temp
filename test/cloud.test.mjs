import assert from 'node:assert/strict';
import dns from 'node:dns';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { once } from 'node:events';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { AquaTempClient } from '../dist/cloud-client.js';

import { credentials, login, reply, serverFor, success } from './fake-cloud.mjs';

function virtualClock() {
  let now = Date.parse('2026-09-08T12:00:00Z');
  const sleeps = [];
  return {
    now: () => now,
    random: () => 0,
    sleeps,
    advance: (ms) => {
      now += ms;
    },
    sleep: async (ms, signal) => {
      signal.throwIfAborted();
      sleeps.push(ms);
      now += ms;
    },
  };
}

test('concurrent reads share one login and send the observed CRM contract', async (t) => {
  const server = await serverFor(t, (call, res) => {
    reply(
      res,
      call.path.endsWith('/login') ? login : success([{ deviceCode: 'synthetic-device' }]),
    );
  });
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  const results = await Promise.all(
    Array.from({ length: 12 }, () => client.read({ kind: 'owned' })),
  );
  assert.deepEqual(results[0], [{ deviceCode: 'synthetic-device' }]);
  assert.equal(server.calls.filter((call) => call.path.endsWith('/login')).length, 1);
  assert.deepEqual(server.calls[0].body, {
    userName: credentials.username,
    password: '6ee7966bfda254813a6a475e009f6780',
    type: '2',
  });
  assert.deepEqual(server.calls[1].body, { userId: 'synthetic-user', appId: '14' });
  assert.equal(server.calls[1].token, 'synthetic-token');
});

test('an expiry race renews once and each safe read replays at most once', async (t) => {
  let logins = 0;
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) {
      logins += 1;
      reply(res, success({ ...login.objectResult, 'x-token': `token-${logins}` }));
    } else if (call.token === 'token-1') {
      reply(res, { error_code: '-100', isReusltSuc: false, objectResult: null });
    } else reply(res, success([]));
  });
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await Promise.all(Array.from({ length: 12 }, () => client.read({ kind: 'owned' })));
  assert.equal(logins, 2);
  assert.equal(server.calls.filter((call) => !call.path.endsWith('/login')).length, 24);
});

test('a rejected renewal enters cooldown and refuses further login contention', async (t) => {
  const server = await serverFor(t, (call, res) => {
    reply(
      res,
      call.path.endsWith('/login')
        ? login
        : { error_code: '-100', isReusltSuc: false, objectResult: null },
    );
  });
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'session-contention' });
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'session-contention' });
  assert.equal(server.calls.length, 4);
});

test('confirmed credential and permission failures pause traffic until a new client is configured', async (t) => {
  for (const [status, category] of [
    [401, 'invalid-credentials'],
    [403, 'permission-denied'],
  ]) {
    const server = await serverFor(t, (_call, res) =>
      reply(res, { secret: credentials.password }, status),
    );
    const client = new AquaTempClient(credentials, { origin: server.origin });
    t.after(() => client.close());
    await assert.rejects(client.read({ kind: 'owned' }), { category });
    await assert.rejects(client.read({ kind: 'owned' }), { category });
    assert.equal(server.calls.length, 1);
  }
});

test(
  'a hanging login is bounded and cancelling one waiter does not cancel its peers',
  { timeout: 10_000 },
  async (t) => {
    let release;
    const arrived = new Promise((resolve) => {
      release = resolve;
    });
    let loginResponse;
    const server = await serverFor(t, (call, res) => {
      if (call.path.endsWith('/login')) {
        loginResponse = res;
        release();
      } else reply(res, success([]));
    });
    const client = new AquaTempClient(credentials, {
      origin: server.origin,
      requestTimeoutMs: 500,
    });
    t.after(() => client.close());
    const abort = new AbortController();
    const first = client.read({ kind: 'owned' }, { signal: abort.signal });
    const cancelled = assert.rejects(first, { category: 'cancelled' });
    const second = client.read({ kind: 'owned' });
    await arrived;
    abort.abort(new Error('synthetic-private-abort-reason'));
    await cancelled;
    reply(loginResponse, login);
    assert.deepEqual(await second, []);
    assert.equal(server.calls.length, 2);
    const stalled = await serverFor(t, () => {});
    const bounded = new AquaTempClient(credentials, {
      origin: stalled.origin,
      requestTimeoutMs: 250,
    });
    t.after(() => bounded.close());
    await assert.rejects(bounded.read({ kind: 'owned' }), { category: 'timeout' });
    assert.equal(stalled.calls.length, 1);
  },
);

test('safe reads bound transient retries, honor Retry-After and reset backoff after success', async (t) => {
  const clock = virtualClock();
  let reads = 0;
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) return reply(res, login);
    reads += 1;
    if (reads === 1) reply(res, {}, 503);
    else if (reads === 2) reply(res, {}, 429, { 'Retry-After': '12' });
    else if (reads === 4) reply(res, {}, 500);
    else reply(res, success([]));
  });
  const client = new AquaTempClient(credentials, { origin: server.origin, clock });
  t.after(() => client.close());
  assert.deepEqual(await client.read({ kind: 'owned' }), []);
  assert.deepEqual(await client.read({ kind: 'owned' }), []);
  assert.deepEqual(clock.sleeps, [5000, 12000, 5000]);
  assert.equal(server.calls.length, 6);
});

test('writes are sent once even when the response is lost, expired, malformed or unavailable', async (t) => {
  for (const failure of ['disconnect', 'expiry', 'malformed', 'unavailable']) {
    const server = await serverFor(t, (call, res) => {
      if (call.path.endsWith('/login')) return reply(res, login);
      if (failure === 'disconnect') res.destroy();
      else if (failure === 'expiry')
        reply(res, { error_code: '-100', isReusltSuc: false, objectResult: null });
      else if (failure === 'malformed') res.end('synthetic-private-malformed');
      else reply(res, {}, 503);
    });
    const client = new AquaTempClient(credentials, { origin: server.origin });
    t.after(() => client.close());
    await assert.rejects(
      client.write([{ deviceCode: 'synthetic-device', protocolCode: 'R02', value: '31.0' }]),
      { deliveryUncertain: true },
    );
    assert.equal(server.calls.length, 2);
    assert.deepEqual(server.calls[1].body, {
      param: [{ deviceCode: 'synthetic-device', protocolCode: 'R02', value: '31.0' }],
    });
  }
});

test('untrusted configuration and oversized commands fail before authentication traffic', async (t) => {
  for (const origin of [
    'https://example.invalid',
    'http://127.0.0.1:1/path',
    'http://user:password@127.0.0.1:1',
    'not a URL',
  ]) {
    assert.throws(() => new AquaTempClient(credentials, { origin }), {
      category: 'invalid-request',
    });
  }
  assert.throws(() => new AquaTempClient({ username: '', password: '' }), {
    category: 'invalid-request',
  });
  const server = await serverFor(t, (_call, res) => reply(res, login));
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await assert.rejects(
    client.write([{ deviceCode: 'x', protocolCode: 'R02', value: 'x'.repeat(100_000) }]),
    { category: 'invalid-request', deliveryUncertain: false },
  );
  await assert.rejects(client.read({ kind: 'unexpected' }), { category: 'invalid-request' });
  assert.equal(server.calls.length, 0);
});

test('repeated invalidation across successful operations cools down and later recovers', async (t) => {
  const clock = virtualClock();
  let logins = 0;
  let expire = true;
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) {
      logins += 1;
      return reply(res, success({ ...login.objectResult, 'x-token': `token-${logins}` }));
    }
    if (expire) reply(res, { error_code: '-100', isReusltSuc: false, objectResult: null });
    else reply(res, success([]));
    expire = !expire;
  });
  const client = new AquaTempClient(credentials, { origin: server.origin, clock });
  t.after(() => client.close());
  await client.read({ kind: 'owned' });
  await client.read({ kind: 'owned' });
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'session-contention' });
  assert.equal(logins, 3);
  clock.advance(300_000);
  assert.deepEqual(await client.read({ kind: 'owned' }), []);
  assert.equal(logins, 4);
});

test('malformed envelopes and missing or unsafe tokens fail closed without exposing vendor data', async (t) => {
  const cases = [
    null,
    [],
    {},
    { error_code: 0, isReusltSuc: true, objectResult: [] },
    { error_code: '0', isReusltSuc: false, objectResult: null },
    { error_code: '-100', isReusltSuc: true, objectResult: null },
    { error_code: '0', isReusltSuc: true },
    success(null),
    success({}),
    success({ ...login.objectResult, 'x-token': '' }),
    success({ ...login.objectResult, 'x-token': 'private\r\nheader' }),
    success({ ...login.objectResult, user_id: 'conflicting-user' }),
  ];
  for (const body of cases) {
    const server = await serverFor(t, (_call, res) => reply(res, body));
    const client = new AquaTempClient(credentials, { origin: server.origin });
    t.after(() => client.close());
    await assert.rejects(client.read({ kind: 'owned' }), (error) => {
      assert.equal(error.category, 'invalid-response');
      assert.doesNotMatch(
        inspect(error) + JSON.stringify(error) + inspect(client),
        /synthetic-password|synthetic@example|synthetic-token|private|conflicting-user/,
      );
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(server.calls.length, 1);
  }
});

test('invalid JSON, oversized and incomplete bodies are bounded at the real transport', async (t) => {
  for (const variant of ['json', 'oversized', 'truncated']) {
    const server = await serverFor(t, (call, res) => {
      if (call.path.endsWith('/login')) return reply(res, login);
      if (variant === 'json') res.end('private-synthetic-token');
      else if (variant === 'oversized') reply(res, success('private'.repeat(200_000)));
      else {
        res.writeHead(200, { 'Content-Length': '10000' });
        res.end('{');
      }
    });
    const clock = virtualClock();
    const client = new AquaTempClient(credentials, {
      origin: server.origin,
      clock,
      requestTimeoutMs: 50,
      readBudgetMs: 100,
    });
    t.after(() => client.close());
    await assert.rejects(client.read({ kind: 'owned' }), (error) => {
      assert.ok(['invalid-response', 'unavailable', 'timeout'].includes(error.category));
      assert.doesNotMatch(inspect(error), /private|synthetic-token/);
      return true;
    });
    assert.equal(server.calls.length, 2);
  }
});

test('unknown HTTP-200 vendor errors are not guessed to be bad credentials or expiry', async (t) => {
  let reject = true;
  const server = await serverFor(t, (call, res) =>
    reply(
      res,
      reject
        ? {
            error_code: '-1',
            isReusltSuc: false,
            objectResult: null,
            error_msg: credentials.password,
          }
        : call.path.endsWith('/login')
          ? login
          : success([]),
    ),
  );
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'vendor-rejected' });
  assert.equal(server.calls.length, 1);
  reject = false;
  assert.deepEqual(await client.read({ kind: 'owned' }), []);
});

test('Retry-After dates exceeding the budget block later traffic until the delay expires', async (t) => {
  const clock = virtualClock();
  let throttled = true;
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) return reply(res, login);
    if (throttled) reply(res, {}, 429, { 'Retry-After': 'Tue, 08 Sep 2026 12:10:00 GMT' });
    else reply(res, success([]));
  });
  const client = new AquaTempClient(credentials, { origin: server.origin, clock });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), {
    category: 'rate-limited',
    retryAfterMs: 600_000,
  });
  await assert.rejects(client.read({ kind: 'owned' }), {
    category: 'rate-limited',
    retryAfterMs: 600_000,
  });
  assert.equal(server.calls.length, 2);
  assert.deepEqual(clock.sleeps, []);
  clock.advance(600_000);
  throttled = false;
  assert.deepEqual(await client.read({ kind: 'owned' }), []);
});

test('persistent 5xx stops after three reads and preserves exponential backoff across operations', async (t) => {
  const clock = virtualClock();
  const server = await serverFor(t, (call, res) =>
    reply(res, call.path.endsWith('/login') ? login : {}, call.path.endsWith('/login') ? 200 : 500),
  );
  const client = new AquaTempClient(credentials, { origin: server.origin, clock });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), {
    category: 'unavailable',
    retryAfterMs: 20_000,
  });
  assert.equal(server.calls.length, 4);
  await assert.rejects(client.read({ kind: 'owned' }), {
    category: 'unavailable',
    retryAfterMs: 40_000,
  });
  assert.equal(server.calls.length, 5);
  assert.deepEqual(clock.sleeps, [5000, 10000, 20000]);
});

test('an expired read gets only one replay even when that replay encounters a transient failure', async (t) => {
  let reads = 0;
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) return reply(res, login);
    reads += 1;
    if (reads === 1) reply(res, { error_code: '-100', isReusltSuc: false, objectResult: null });
    else reply(res, {}, 503);
  });
  const client = new AquaTempClient(credentials, { origin: server.origin, clock: virtualClock() });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'unavailable' });
  assert.equal(reads, 2);
});

test('HTTP 401 on reads renews while an authenticated 403 pauses without relogin', async (t) => {
  for (const status of [401, 403]) {
    let reads = 0;
    const server = await serverFor(t, (call, res) => {
      if (call.path.endsWith('/login')) return reply(res, login);
      reads += 1;
      reply(res, reads === 1 ? {} : success([]), reads === 1 ? status : 200);
    });
    const client = new AquaTempClient(credentials, { origin: server.origin });
    t.after(() => client.close());
    if (status === 401) {
      assert.deepEqual(await client.read({ kind: 'owned' }), []);
      assert.equal(server.calls.length, 4);
    } else {
      await assert.rejects(client.read({ kind: 'owned' }), { category: 'permission-denied' });
      await assert.rejects(client.read({ kind: 'owned' }), { category: 'permission-denied' });
      assert.equal(server.calls.length, 2);
    }
  }
});

test(
  'read and write deadlines include shared authentication and prevent late command delivery',
  { timeout: 10_000 },
  async (t) => {
    let release;
    const arrived = new Promise((resolve) => {
      release = resolve;
    });
    let loginResponse;
    const server = await serverFor(t, (call, res) => {
      if (call.path.endsWith('/login')) {
        loginResponse = res;
        release();
      } else reply(res, success([]));
    });
    const client = new AquaTempClient(credentials, {
      origin: server.origin,
      readBudgetMs: 500,
      writeBudgetMs: 500,
    });
    t.after(() => client.close());
    const read = assert.rejects(client.read({ kind: 'owned' }), { category: 'timeout' });
    const write = assert.rejects(
      client.write([{ deviceCode: 'synthetic', protocolCode: 'R02', value: '31' }]),
      { category: 'timeout', deliveryUncertain: false },
    );
    await arrived;
    await Promise.all([read, write]);
    reply(loginResponse, login);
    assert.deepEqual(await client.read({ kind: 'owned' }), []);
    assert.equal(server.calls.length, 2);
    assert.equal(
      server.calls.some((call) => call.path.endsWith('/control')),
      false,
    );
  },
);

test(
  'shutdown cancels outstanding sockets and backoff without sending further requests',
  { timeout: 10_000 },
  async (t) => {
    for (const phase of ['login', 'read', 'backoff']) {
      let release;
      const arrived = new Promise((resolve) => {
        release = resolve;
      });
      const server = await serverFor(t, (call, res) => {
        if (phase === 'login') {
          release();
          return;
        }
        if (call.path.endsWith('/login')) return reply(res, login);
        if (phase === 'backoff') reply(res, {}, 503);
        else release();
      });
      const client = new AquaTempClient(credentials, {
        origin: server.origin,
        clock:
          phase === 'backoff'
            ? {
                now: Date.now,
                random: () => 0,
                sleep: (_ms, signal) => {
                  release();
                  return new Promise((_resolve, reject) =>
                    signal.addEventListener('abort', () => reject(new Error('private')), {
                      once: true,
                    }),
                  );
                },
              }
            : undefined,
      });
      const pending = assert.rejects(client.read({ kind: 'owned' }), { category: 'cancelled' });
      await arrived;
      client.close();
      client.close();
      await pending;
      const count = server.calls.length;
      await assert.rejects(client.read({ kind: 'owned' }), { category: 'cancelled' });
      assert.equal(server.calls.length, count);
    }
  },
);

test('redirects never forward account credentials or tokens', async (t) => {
  const destination = await serverFor(t, (_call, res) => reply(res, login));
  const server = await serverFor(t, (_call, res) =>
    reply(res, {}, 302, { Location: destination.origin + '/capture' }),
  );
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), { category: 'invalid-response' });
  assert.equal(server.calls.length, 1);
  assert.equal(destination.calls.length, 0);
});

test('shared discovery, status and telemetry use validated snapshots and a write returns only its acknowledgment', async (t) => {
  const server = await serverFor(t, (call, res) =>
    reply(res, call.path.endsWith('/login') ? login : success(null)),
  );
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  const request = { kind: 'telemetry', deviceCode: 'synthetic-device', codes: ['T02'] };
  const pending = client.read(request);
  request.codes.push('mutated');
  request.deviceCode = 'mutated';
  await pending;
  await client.read({ kind: 'shared', page: 2 });
  await client.read({ kind: 'status', deviceCode: 'synthetic-device' });
  assert.equal(
    await client.write([{ deviceCode: 'synthetic-device', protocolCode: 'R02', value: '32.0' }]),
    null,
  );
  assert.deepEqual(server.calls[1].body, {
    userId: 'synthetic-user',
    appId: '14',
    deviceCode: 'synthetic-device',
    protocalCodes: ['T02'],
  });
  assert.deepEqual(server.calls[2].body, {
    toUser: 'synthetic-user',
    appId: '14',
    pageIndex: 2,
    pageSize: 100,
  });
  assert.equal(server.calls[3].path, '/crmservice/api/app/device/getDeviceStatus');
  assert.equal(server.calls.length, 5);
});

test('connection refusal and TLS negotiation failures return sanitized, bounded transport errors', async (t) => {
  const closed = createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  // No certificate: intentionally fail the TLS handshake without weakening verification.
  const tls = createHttpsServer();
  tls.listen(0, '127.0.0.1');
  await once(tls, 'listening');
  t.after(() => {
    tls.closeAllConnections();
    tls.close();
  });
  for (const origin of [`http://127.0.0.1:${port}`, `https://127.0.0.1:${tls.address().port}`]) {
    const client = new AquaTempClient(credentials, { origin });
    t.after(() => client.close());
    await assert.rejects(client.read({ kind: 'owned' }), (error) => {
      assert.equal(error.category, 'unavailable');
      assert.doesNotMatch(inspect(error), /127\.0\.0\.1|synthetic|ECONN|SSL|TLS/);
      return true;
    });
  }
});

test('permission denial for one device does not invalidate another device or renew the account', async (t) => {
  const server = await serverFor(t, (call, res) => {
    if (call.path.endsWith('/login')) return reply(res, login);
    if (call.body.deviceCode === 'denied') reply(res, {}, 403);
    else reply(res, success({ status: 'ONLINE' }));
  });
  const client = new AquaTempClient(credentials, { origin: server.origin });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'status', deviceCode: 'denied' }), {
    category: 'permission-denied',
  });
  assert.deepEqual(await client.read({ kind: 'status', deviceCode: 'allowed' }), {
    status: 'ONLINE',
  });
  assert.equal(server.calls.length, 3);
});

test('DNS lookup failure traverses the real HTTPS transport without disclosing resolver errors', async (t) => {
  const original = dns.lookup;
  let lookups = 0;
  dns.lookup = (hostname, options, callback) => {
    assert.equal(hostname, 'cloud.linked-go.com');
    lookups += 1;
    const error = Object.assign(new Error('synthetic-private-resolver@example.invalid'), {
      code: 'ENOTFOUND',
    });
    setImmediate(() => callback(error));
  };
  t.after(() => {
    dns.lookup = original;
  });
  const client = new AquaTempClient(credentials, { readBudgetMs: 100, clock: virtualClock() });
  t.after(() => client.close());
  await assert.rejects(client.read({ kind: 'owned' }), (error) => {
    assert.equal(error.category, 'unavailable');
    assert.doesNotMatch(inspect(error), /synthetic-private|@|ENOTFOUND|cloud\.linked-go/);
    return true;
  });
  assert.equal(lookups, 1);
});
