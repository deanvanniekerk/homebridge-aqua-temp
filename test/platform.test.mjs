import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { HomebridgeAPI } from '../node_modules/homebridge/dist/api.js';
import { AquaTempPlatform } from '../dist/platform.js';
import { PLUGIN_NAME, PLATFORM_NAME } from '../dist/settings.js';
import { redirectCloud } from './redirect-cloud.mjs';
import { credentials, login, reply, serverFor, success } from './fake-cloud.mjs';

const device = {
  deviceCode: 'synthetic-device',
  model: 'PASRW040-P-BP4II-C',
  custModel: 'BOOSTi-INV-HP-40',
};
async function waitUntil(condition) {
  const deadline = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Platform condition timed out');
    await delay(10);
  }
}
const uuid = (api, id = device.deviceCode) => api.hap.uuid.generate(`${PLUGIN_NAME}:device:${id}`);
async function host(t, extraConfig = {}, cached = [], scenario = 'online') {
  const server = await serverFor(t, (call, response) => {
    const path = call.path.split('/').at(-1);
    if (scenario === 'denied' && path === 'login') {
      reply(
        response,
        {
          error: {
            message: credentials.password,
            email: credentials.username,
            token: 'synthetic-token',
          },
        },
        401,
      );
      return;
    }
    const result = {
      deviceList: scenario === 'empty' ? [] : [device],
      getMyAppectDeviceShareDataList: scenario === 'empty' ? [] : [device],
      getDeviceStatus: { status: 'ONLINE' },
      getDataByCode: [{ code: 'T02', value: '20.5', dataType: 'TEMP' }],
    }[path];
    reply(response, path === 'login' ? login : success(result));
  });
  const restoreTransport = redirectCloud(server.origin);
  const api = new HomebridgeAPI();
  const registered = [],
    removed = [],
    updated = [],
    logs = [];
  let failedRegistration = false;
  api.on('registerPlatformAccessories', (accessories) => {
    if (
      scenario === 'registration-failure' &&
      !failedRegistration &&
      accessories[0].context.role === 'power'
    ) {
      failedRegistration = true;
      throw new Error('synthetic-private-registration-error');
    }
    registered.push(...accessories);
  });
  api.on('unregisterPlatformAccessories', (accessories) => removed.push(...accessories));
  api.on('updatePlatformAccessories', (accessories) => updated.push(...accessories));
  const log = Object.fromEntries(
    ['info', 'warn', 'error', 'debug'].map((key) => [key, (line) => logs.push(line)]),
  );
  const platform = new AquaTempPlatform(
    log,
    { platform: PLATFORM_NAME, ...credentials, ...extraConfig },
    api,
  );
  const restored = cached.map((item) => {
    const accessory = api.platformAccessory.deserialize(item);
    platform.configureAccessory(accessory);
    return accessory;
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    api.emit('shutdown');
    restoreTransport();
  };
  t.after(stop);
  return {
    api,
    stop,
    platform,
    registered,
    removed,
    updated,
    logs,
    restored,
    calls: server.calls,
    launch: async () => {
      api.emit('didFinishLaunching');
      await waitUntil(() =>
        server.calls.some((call) => call.path.endsWith('/getMyAppectDeviceShareDataList')),
      );
    },
  };
}
function current(api, accessory) {
  return accessory
    .getService(api.hap.Service.Thermostat)
    .getCharacteristic(api.hap.Characteristic.CurrentTemperature);
}

test('platform registers one namespaced identity, restores it before fresh reads and retains temporary omissions', async (t) => {
  const cold = await host(t, { includePowerSwitch: true, includeWaterTemperatureSensor: true });
  await cold.launch();
  await waitUntil(
    () => cold.registered.length === 3 && current(cold.api, cold.registered[0]).value === 20.5,
  );
  const accessory = cold.registered.find((item) => !item.context.role);
  const power = cold.registered.find((item) => item.context.role === 'power');
  const water = cold.registered.find((item) => item.context.role === 'water');
  assert.ok(power.getService(cold.api.hap.Service.Switch));
  assert.equal(
    await water
      .getService(cold.api.hap.Service.TemperatureSensor)
      .getCharacteristic(cold.api.hap.Characteristic.CurrentTemperature)
      .handleGetRequest(),
    20.5,
  );
  assert.equal(new Set(cold.registered.map((item) => item.UUID)).size, 3);
  assert.equal(accessory.UUID, uuid(cold.api));
  assert.equal(accessory._associatedPlugin, PLUGIN_NAME);
  assert.equal(await current(cold.api, accessory).handleGetRequest(), 20.5);
  const serialized = cold.api.platformAccessory.serialize(accessory);
  assert.deepEqual(serialized.context, { deviceId: device.deviceCode, displayUnits: 0 });
  cold.stop();
  const warm = await host(
    t,
    { includePowerSwitch: true, includeWaterTemperatureSensor: true },
    cold.registered.map((item) => cold.api.platformAccessory.serialize(item)),
    'empty',
  );
  assert.equal(warm.restored.length, 3);
  await assert.rejects(
    current(warm.api, warm.restored[0]).handleGetRequest(),
    (error) => error === -70402,
  );
  await warm.launch();
  assert.equal(warm.registered.length, 0);
  assert.equal(warm.removed.length, 0);
  assert.equal(warm.restored[0].UUID, accessory.UUID);
  assert.ok(cold.calls.every((call) => !call.path.endsWith('/control')));
});

test('explicit selection removes only excluded plugin identities; invalid config keeps cache unavailable without traffic', async (t) => {
  const source = await host(t);
  await source.launch();
  await waitUntil(() => source.registered.length === 1);
  const serialized = source.api.platformAccessory.serialize(source.registered[0]);
  source.stop();
  const excluded = await host(t, { deviceIds: ['another-device'] }, [serialized]);
  await excluded.launch();
  assert.equal(excluded.removed.length, 1);
  assert.equal(excluded.registered.length, 0);
  excluded.stop();
  const invalid = await host(t, { password: '' }, [serialized]);
  invalid.api.emit('didFinishLaunching');
  await delay(30);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.removed.length, 0);
  await assert.rejects(
    current(invalid.api, invalid.restored[0]).handleGetRequest(),
    (error) => error === -70402,
  );
  assert.match(invalid.logs.join('\n'), /Configuration rejected/);
  assert.doesNotMatch(invalid.logs.join('\n'), /synthetic-password|synthetic@example/);
});

test('real login denial before discovery reaches sanitized normal/debug diagnostics without exposing vendor errors', async (t) => {
  for (const debug of [false, true]) {
    const h = await host(t, { debug }, [], 'denied');
    h.api.emit('didFinishLaunching');
    await waitUntil(() => h.logs.some((line) => line.includes('Check credentials')));
    assert.equal(h.calls.length, 1);
    assert.equal(h.registered.length, 0);
    assert.doesNotMatch(
      h.logs.join('\n'),
      /synthetic-device|synthetic-password|synthetic@example|synthetic-token/,
    );
    const lines = h.logs.filter((line) => line.startsWith('Diagnostic report: '));
    assert.equal(lines.length, debug ? 1 : 0);
    if (debug) {
      const report = JSON.parse(lines[0].slice('Diagnostic report: '.length));
      assert.deepEqual(report.account, {
        discoveryComplete: false,
        failure: 'invalid-credentials',
      });
      assert.deepEqual(report.devices, []);
      assert.equal(report.runtime.plugin, '0.0.0-development.0');
      assert.equal(report.runtime.homebridge, '2.4.0');
    }
    h.stop();
  }
});

test('one accessory registration failure is retried without stopping other capabilities or exposing raw errors', async (t) => {
  const h = await host(
    t,
    { includePowerSwitch: true, includeWaterTemperatureSensor: true },
    [],
    'registration-failure',
  );
  await h.launch();
  await waitUntil(() => h.registered.length === 3);
  assert.equal(new Set(h.registered.map((item) => item.UUID)).size, 3);
  const water = h.registered.find((item) => item.context.role === 'water');
  assert.equal(
    await water
      .getService(h.api.hap.Service.TemperatureSensor)
      .getCharacteristic(h.api.hap.Characteristic.CurrentTemperature)
      .handleGetRequest(),
    20.5,
  );
  assert.equal(
    h.logs.filter((line) => line.includes('Accessory capability temporarily unavailable')).length,
    1,
  );
  assert.doesNotMatch(h.logs.join('\n'), /synthetic-private|updates stopped/);
});

test('fallback accessories default off, can be selected independently, and are removed when disabled', async (t) => {
  const defaults = await host(t);
  await defaults.launch();
  await waitUntil(() => defaults.registered.length === 1);
  assert.equal(defaults.registered[0].context.role, undefined);
  defaults.stop();
  const waterOnly = await host(t, { includeWaterTemperatureSensor: true });
  await waterOnly.launch();
  await waitUntil(() => waterOnly.registered.length === 2);
  assert.deepEqual(
    waterOnly.registered.map((a) => a.context.role),
    [undefined, 'water'],
  );
  const cached = waterOnly.registered.map((a) => waterOnly.api.platformAccessory.serialize(a));
  waterOnly.stop();
  const disabled = await host(t, {}, cached);
  await disabled.launch();
  assert.equal(disabled.removed.length, 1);
  assert.equal(disabled.removed[0].context.role, 'water');
  assert.equal(disabled.registered.length, 0);
});
