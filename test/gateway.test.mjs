import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { once } from 'node:events';
import { AquaTempClient } from '../dist/cloud-client.js';
import { AquaTempGateway } from '../dist/gateway.js';
import { Diagnostics } from '../dist/diagnostics.js';
import { systemScheduler } from '../dist/scheduler.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { deferred } from './fake-scheduler.mjs';
import { credentials, login, reply, serverFor, success } from './fake-cloud.mjs';

async function observed(name) {
  const fixture = JSON.parse(
    await readFile(new URL(`../fixtures/protocol/${name}.json`, import.meta.url), 'utf8'),
  );
  return fixture.response.bodyProjection.objectResult;
}

test('the real cloud client discovers shared and owned identities and normalizes observed telemetry', async (t) => {
  const owned = await observed('deviceList');
  const shared = await observed('shared-device-list');
  const telemetry = await observed('telemetry-core');
  const server = await serverFor(t, (call, response) => {
    const path = call.path.split('/').at(-1);
    const result = {
      deviceList: owned,
      getMyAppectDeviceShareDataList: shared,
      getDeviceStatus: { status: 'ONLINE', isFault: false },
      getDataByCode: telemetry,
    }[path];
    reply(response, path === 'login' ? login : success(result));
  });
  const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }), {
    now: () => 123_000,
  });
  t.after(() => gateway.close());
  const signal = new AbortController().signal;
  const discovery = await gateway.discover(signal);
  assert.equal(discovery.complete, true);
  assert.deepEqual(discovery.devices, [
    { id: 'DEVICE_CODE_1', profile: 'boost-i-hp40', sources: ['owned', 'shared'] },
  ]);
  const sample = await gateway.read(discovery.devices[0], signal);
  assert.deepEqual(sample.waterCelsius, { available: true, value: 20.5 });
  assert.deepEqual(sample.reportedTargetCelsius, { available: true, value: 32 });
  assert.deepEqual(sample.control, { available: false, reason: 'unverified' });
  assert.equal(sample.observedAtMs, 123_000);
  assert.equal(server.calls.filter((call) => call.path.endsWith('/login')).length, 1);
  const before = server.calls.length;
  await assert.rejects(
    gateway.write(discovery.devices[0], { kind: 'target-temperature', celsius: 31 }, signal),
    { category: 'unverified' },
  );
  assert.equal(server.calls.length, before);
});

test('a malformed discovery source preserves the other source and reports partial discovery', async (t) => {
  const shared = await observed('shared-device-list');
  let sharedBroken = false;
  const server = await serverFor(t, (call, response) => {
    if (call.path.endsWith('/login')) reply(response, login);
    else if (call.path.endsWith('/deviceList') || sharedBroken)
      reply(response, success({ private: credentials.password }));
    else reply(response, success(shared));
  });
  const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }));
  t.after(() => gateway.close());
  const signal = new AbortController().signal;
  const result = await gateway.discover(signal);
  assert.equal(result.complete, false);
  assert.equal(result.failure.category, 'invalid-response');
  assert.equal(result.devices.length, 1);
  assert.deepEqual(result.devices[0].sources, ['shared']);
  assert.doesNotMatch(JSON.stringify(result.failure), /synthetic-password|private/);
  sharedBroken = true;
  await assert.rejects(gateway.discover(signal), { category: 'invalid-response' });
});

test('synthetic shared pagination is bounded and retains earlier pages when a later page repeats or fails', async (t) => {
  const [shape] = await observed('shared-device-list');
  const page = Array.from({ length: 100 }, (_, index) => ({
    ...shape,
    deviceCode: `synthetic-${index}`,
  }));
  for (const scenario of ['complete', 'repeated', 'rate-limited']) {
    const server = await serverFor(t, (call, response) => {
      if (call.path.endsWith('/login')) reply(response, login);
      else if (call.path.endsWith('/deviceList')) reply(response, success([]));
      else if (call.body.pageIndex === 1 || scenario === 'repeated') reply(response, success(page));
      else if (scenario === 'rate-limited') reply(response, {}, 429, { 'Retry-After': '300' });
      else reply(response, success([{ ...shape, deviceCode: 'synthetic-last' }]));
    });
    const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }));
    t.after(() => gateway.close());
    const result = await gateway.discover(new AbortController().signal);
    assert.deepEqual(
      server.calls.filter((call) => call.body.pageIndex).map((call) => call.body.pageIndex),
      [1, 2],
    );
    assert.equal(result.devices.length, scenario === 'complete' ? 101 : 100);
    assert.equal(result.complete, scenario === 'complete');
    if (scenario === 'rate-limited') {
      assert.equal(result.failure.category, 'rate-limited');
      assert.ok(result.failure.retryAfterMs >= 299_000);
    }
  }
});

test('coordinator shutdown closes gateway authentication independently of cancelled read waiters', async (t) => {
  const arrived = deferred();
  const server = await serverFor(t, (_call, response) => {
    const disconnected = once(response, 'close', { signal: AbortSignal.timeout(1000) });
    arrived.resolve({ disconnected });
  });
  const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }));
  t.after(() => gateway.close());
  const coordinator = new AccountCoordinator(gateway);
  t.after(() => coordinator.close());
  coordinator.start();
  const { disconnected } = await arrived.promise;
  coordinator.close();
  await disconnected;
  assert.equal(server.calls.length, 1);
});

test('offline, unknown-profile and malformed status responses do not trigger telemetry requests', async (t) => {
  const [known] = await observed('deviceList');
  const device = { id: known.deviceCode, profile: 'boost-i-hp40', sources: ['shared'] };
  let status = { status: 'OFFLINE' };
  const server = await serverFor(t, (call, response) =>
    reply(response, call.path.endsWith('/login') ? login : success(status)),
  );
  const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }));
  t.after(() => gateway.close());
  const signal = new AbortController().signal;
  assert.equal((await gateway.read(device, signal)).connectivity, 'offline');
  status = { status: 'ONLINE' };
  assert.equal(
    (await gateway.read({ ...device, profile: 'unknown' }, signal)).waterCelsius.reason,
    'unsupported',
  );
  status = {};
  await assert.rejects(gateway.read(device, signal), { category: 'invalid-response' });
  assert.equal(server.calls.length, 4);
  assert.ok(server.calls.every((call) => !call.path.endsWith('/getDataByCode')));
});

test('wall-clock corrections do not corrupt acquisition freshness or diagnostic ages', async (t) => {
  const owned = await observed('deviceList');
  const telemetry = await observed('telemetry-core');
  const server = await serverFor(t, (call, response) => {
    const path = call.path.split('/').at(-1);
    const result = {
      deviceList: owned,
      getMyAppectDeviceShareDataList: [],
      getDeviceStatus: { status: 'ONLINE' },
      getDataByCode: telemetry,
    }[path];
    reply(response, path === 'login' ? login : success(result));
  });
  const original = Date.now;
  Date.now = () => original() - 86_400_000;
  t.after(() => {
    Date.now = original;
  });
  const coordinator = new AccountCoordinator(
    new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin })),
  );
  t.after(() => coordinator.close());
  const updates = coordinator.updates(AbortSignal.timeout(1000));
  coordinator.start();
  let state;
  for await (const snapshot of updates) {
    if (snapshot.devices[0]?.readings) {
      state = snapshot.devices[0];
      break;
    }
  }
  assert.ok(state, 'received a real HTTP reading');
  assert.equal(state.status, 'healthy');
  assert.ok(Math.abs(state.lastSuccessMs - systemScheduler.now()) < 1000);
  const diagnostics = new Diagnostics(() => {}, {
    pluginVersion: '0.0.0-development.0',
    homebridgeVersion: '2.4.0',
  });
  const report = diagnostics.report({
    ...coordinator.snapshot(),
    devices: [{ ...state, lastSuccessMs: systemScheduler.now() - 60_000 }],
  });
  assert.ok(
    report.devices[0].lastSuccessAgeMs >= 60_000 && report.devices[0].lastSuccessAgeMs < 61_000,
  );
});
