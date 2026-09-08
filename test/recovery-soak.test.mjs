import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, getEventListeners } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { test } from 'node:test';
import { HomebridgeAPI } from '../node_modules/homebridge/dist/api.js';
import { AquaTempClient } from '../dist/cloud-client.js';
import { AquaTempGateway } from '../dist/gateway.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { Diagnostics } from '../dist/diagnostics.js';
import { Thermostat } from '../dist/thermostat.js';
import { FakeScheduler } from './fake-scheduler.mjs';
import { credentials, login, reply, success } from './fake-cloud.mjs';

// Seven virtual days at the supported 300-second interval. All identities/values are synthetic.
// Successful and lost-acknowledgment writes exercise the supported profile; vendor behavior remains separately observed.
test(
  'seven virtual days recover through actual HTTP, normalization, freshness and HAP without accumulating work',
  { timeout: 180_000 },
  async (t) => {
    const scheduler = new FakeScheduler();
    const interval = 300_000;
    const cycles = (7 * 24 * 60 * 60 * 1000) / interval;
    const devices = ['synthetic-first', 'synthetic-second'].map((deviceCode) => ({
      deviceCode,
      model: 'PASRW040-P-BP4II-C',
      custModel: 'BOOSTi-INV-HP-40',
    }));
    let cycle = 0,
      requests = 0,
      logins = 0,
      writes = 0,
      sleeps = 0,
      notifications = 0,
      logLines = 0;
    let token = '',
      expiredToken = '',
      maximumSockets = 0,
      maximumTimers = 0;
    const targets = new Map();
    let commandOutcome = 'success';
    let attemptedWrites = 0;
    const sockets = new Set();
    const counts = new Map();
    const baselineTimers = process
      .getActiveResourcesInfo()
      .filter((type) => type === 'Timeout').length;
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      const path = request.url.split('/').at(-1);
      requests += 1;
      counts.set(path, (counts.get(path) ?? 0) + 1);
      maximumTimers = Math.max(
        maximumTimers,
        process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length,
      );
      if (path === 'control') {
        writes += 1;
        const command = input.param[0];
        assert.equal(command.protocolCode, 'R02');
        targets.set(command.deviceCode, command.value);
        if (commandOutcome === 'lost-ack') response.destroy();
        else reply(response, success(null));
        return;
      }
      if (path === 'login') {
        logins += 1;
        token = `synthetic-session-${logins}`;
        reply(response, success({ ...login.objectResult, 'x-token': token }));
        return;
      }
      if (request.headers['x-token'] === expiredToken) {
        reply(response, { error_code: '-100', isReusltSuc: false, objectResult: null });
        return;
      }
      const phase = cycle % 36;
      if (phase >= 5 && phase <= 8) {
        reply(response, { private: credentials.password }, cycle % 2 === 0 ? 429 : 503, {
          'Retry-After': '300',
        });
        return;
      }
      if (path === 'deviceList') {
        reply(response, success(phase === 13 ? [] : [devices[0]]));
        return;
      }
      if (path === 'getMyAppectDeviceShareDataList') {
        reply(
          response,
          success(
            phase === 12
              ? { unexpected: credentials.username }
              : phase === 13
                ? []
                : [devices[1], devices[0]],
          ),
        );
        return;
      }
      const first = input.deviceCode === devices[0].deviceCode;
      if (phase === 15 && first) {
        reply(response, { private: credentials.username }, 403);
        return;
      }
      if (path === 'getDeviceStatus') {
        reply(
          response,
          success({ status: phase === 18 && first ? 'OFFLINE' : 'ONLINE', isFault: false }),
        );
        return;
      }
      if (path === 'getDataByCode') {
        if (phase === 22 && first) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end('{');
          return;
        }
        const target = targets.get(input.deviceCode) ?? String(30 + (cycle % 3));
        reply(
          response,
          success(
            phase === 21 && first
              ? { unexpected: credentials.password }
              : [
                  { code: 'T02', dataType: 'TEMP', value: String(20 + (cycle % 10) / 10) },
                  { code: 'Power', dataType: 'ENUM', value: '1' },
                  { code: 'Mode', dataType: 'ENUM', value: '1' },
                  { code: 'O07', dataType: null, value: '0' },
                  { code: 'Set_Temp', dataType: 'TEMP', value: target },
                  { code: 'R02', dataType: 'TEMP', value: target },
                ],
          ),
        );
        return;
      }
      throw new Error('Unexpected route in soak');
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      maximumSockets = Math.max(maximumSockets, sockets.size);
      socket.once('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const client = new AquaTempClient(credentials, {
      origin: `http://127.0.0.1:${server.address().port}`,
      clock: {
        now: scheduler.now,
        random: () => 0,
        sleep: async () => {
          sleeps += 1;
          throw new Error('Unexpected short retry');
        },
      },
    });
    const coordinator = new AccountCoordinator(
      new AquaTempGateway(client, { now: scheduler.now }),
      { scheduler, intervalMs: interval },
    );
    t.after(() => coordinator.close());
    const api = new HomebridgeAPI();
    const accessories = devices.map(
      (device) =>
        new api.platformAccessory('Synthetic heater', api.hap.uuid.generate(device.deviceCode)),
    );
    const thermostats = accessories.map(
      (accessory, index) =>
        new Thermostat(api.hap, accessory, coordinator, devices[index].deviceCode, () => {}),
    );
    t.after(() => thermostats.forEach((thermostat) => thermostat.close()));
    const diagnostics = new Diagnostics(
      (line) => {
        logLines += 1;
        assert.doesNotMatch(line, /synthetic|@|password|session-|deviceCode/);
      },
      {
        now: scheduler.now,
        pluginVersion: '0.0.0-development.0',
        homebridgeVersion: '2.4.0',
        debug: true,
      },
    );
    const stop = new AbortController();
    const consume = (async () => {
      for await (const snapshot of coordinator.updates(stop.signal)) {
        notifications += 1;
        diagnostics.observe(snapshot);
        thermostats.forEach((thermostat) => thermostat.update());
      }
    })();
    t.after(async () => {
      stop.abort();
      await consume;
    });
    async function settled() {
      const until = performance.now() + 5_000;
      // The account deadline exists only while a poll is active. Normal polls/freshness are >=300s.
      while (
        [...scheduler.tasks.values()].some((task) => task.at === scheduler.now() + 30_000) ||
        sockets.size > 0
      ) {
        if (performance.now() > until) throw new Error(`Soak poll ${cycle} failed to settle`);
        await nextTurn();
      }
      await scheduler.flush();
    }
    async function advanceWindow(milliseconds) {
      const end = scheduler.now() + milliseconds;
      // Let real HTTP settle at each virtual event; jumping across an in-flight
      // request would spuriously fire its timeout before the OS can deliver data.
      for (;;) {
        const next = Math.min(...[...scheduler.tasks.values()].map((task) => task.at));
        if (next > end) break;
        await scheduler.advance(next - scheduler.now());
        await settled();
      }
      await scheduler.advance(end - scheduler.now());
      await settled();
    }
    const start = scheduler.now();
    coordinator.start();
    await settled();
    for (cycle = 1; cycle <= cycles; cycle += 1) {
      targets.clear(); // Later app changes must replace previous command results.
      if (cycle % 288 === 0) expiredToken = token;
      await advanceWindow(interval);
      const states = coordinator.snapshot().devices;
      assert.equal(states.length, 2);
      assert.ok(scheduler.tasks.size <= 2, `retained scheduler tasks at cycle ${cycle}`);
      assert.equal(getEventListeners(stop.signal, 'abort').length, 1);
      const phase = cycle % 36;
      const first = coordinator.state(devices[0].deviceCode);
      if (phase === 7 || phase === 8) assert.equal(first.status, 'stale');
      else if (phase === 15) assert.equal(first.status, 'permission-denied');
      else if (phase === 18) assert.equal(first.status, 'offline');
      else if (phase === 21 || phase === 22) assert.equal(first.status, 'protocol-error');
      else assert.equal(first.status, 'healthy');
      if (phase < 5 || phase > 8) {
        assert.equal(coordinator.state(devices[1].deviceCode).status, 'healthy');
        const current = accessories[1]
          .getService(api.hap.Service.Thermostat)
          .getCharacteristic(api.hap.Characteristic.CurrentTemperature);
        assert.ok(
          Math.abs((await current.handleGetRequest()) - (20 + (cycle % 10) / 10)) < 1e-8,
          `water at cycle ${cycle}: ${await current.handleGetRequest()}`,
        );
      }
      assert.equal(writes, attemptedWrites, 'no command replay during recovery');
      if (cycle % 24 === 0) {
        commandOutcome = cycle % 48 === 0 ? 'lost-ack' : 'success';
        const target = accessories[0]
          .getService(api.hap.Service.Thermostat)
          .getCharacteristic(api.hap.Characteristic.TargetTemperature);
        const result = target.handleSetRequest(31.5);
        attemptedWrites += 1;
        if (commandOutcome === 'lost-ack')
          await assert.rejects(result, (error) => error === -70402);
        else {
          await result;
          assert.equal(await target.handleGetRequest(), 31.5);
        }
        await scheduler.advance(0);
        await settled();
        assert.equal(writes, attemptedWrites, 'lost acknowledgments are never replayed');
      }
    }
    assert.equal(scheduler.now() - start, 7 * 24 * 60 * 60 * 1000);
    coordinator.close();
    stop.abort();
    await consume;
    assert.equal(scheduler.tasks.size, 0);
    assert.equal(getEventListeners(stop.signal, 'abort').length, 0);
    assert.equal(sockets.size, 0);
    assert.equal(
      process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length,
      baselineTimers,
    );
    assert.equal(writes, 84);
    assert.equal(sleeps, 0);
    assert.equal(logins, 8, 'one initial login and one renewal per virtual day');
    assert.ok(requests <= (cycles + 1) * 8);
    assert.ok(notifications <= (cycles + 1) * 5);
    assert.ok(logLines <= (cycles + 1) * 5);
    assert.ok(maximumSockets <= 8);
    assert.ok(maximumTimers <= baselineTimers + 10);
    assert.equal(counts.size, 6);
    t.diagnostic(
      JSON.stringify({
        virtualDays: 7,
        pollIntervalSeconds: 300,
        polls: cycles + 1,
        requests,
        logins,
        writes,
        notifications,
        logLines,
        maximumSockets,
        maximumTimersAboveBaseline: maximumTimers - baselineTimers,
      }),
    );
  },
);
