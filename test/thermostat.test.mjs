import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomebridgeAPI } from '../node_modules/homebridge/dist/api.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { CloudError } from '../dist/cloud-error.js';
import { Thermostat } from '../dist/thermostat.js';
import { FakeScheduler, deferred } from './fake-scheduler.mjs';

// Synthetic domain contract: no assertion here establishes physical device capabilities.
const device = { id: 'synthetic-device', profile: 'boost-i-hp40', sources: ['shared'] };
const available = (value) => ({ available: true, value });
const unknown = { available: false, reason: 'unverified' };
async function setup(t, options = {}) {
  const api = new HomebridgeAPI();
  const scheduler = new FakeScheduler();
  let sample = {
    connectivity: 'online',
    measuredAtMs: null,
    waterCelsius: available(20.5),
    outletCelsius: available(21),
    ambientCelsius: available(36),
    reportedTargetCelsius: available(32),
    power: available('on'),
    mode: available('heat'),
    fault: available(false),
    activity: available('idle'),
    control: available({ minimumCelsius: 5, maximumCelsius: 60, stepCelsius: 0.5 }),
    ...options.readings,
  };
  const writes = [];
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => {
        if (sample instanceof Error) throw sample;
        return { ...sample, observedAtMs: scheduler.now() };
      },
      validateCommand: () => {},
      write: async (_device, command) => {
        writes.push(command);
        if (options.write) await options.write(command);
        if (command.kind === 'target-temperature')
          sample.reportedTargetCelsius = available(command.celsius);
        else sample.power = available(command.state === 'off' ? 'off' : 'on');
      },
    },
    { scheduler },
  );
  const accessory = new api.platformAccessory(
    'Synthetic heater',
    api.hap.uuid.generate('synthetic-device'),
  );
  accessory.context = { deviceId: device.id };
  let saved = 0;
  const thermostat = new Thermostat(api.hap, accessory, coordinator, device.id, () => {
    saved += 1;
  });
  const service = accessory.getService(api.hap.Service.Thermostat);
  const get = (name) => service.getCharacteristic(api.hap.Characteristic[name]);
  t.after(() => {
    thermostat.close();
    coordinator.close();
  });
  return {
    api,
    scheduler,
    coordinator,
    thermostat,
    accessory,
    writes,
    get,
    saved: () => saved,
    start: async () => {
      coordinator.start();
      await scheduler.flush();
      thermostat.update();
    },
    change: async (changes) => {
      sample = changes instanceof Error ? changes : { ...sample, ...changes };
      await scheduler.advance(60_000);
      thermostat.update();
    },
  };
}
const communicationFailure = (error) => error === -70402;

test('real HAP reads fail before freshness, then expose verified telemetry and capability intersections', async (t) => {
  const h = await setup(t);
  for (const name of [
    'CurrentTemperature',
    'TargetTemperature',
    'TargetHeatingCoolingState',
    'CurrentHeatingCoolingState',
  ]) {
    await assert.rejects(h.get(name).handleGetRequest(), communicationFailure);
  }
  assert.equal(
    h.get('TargetTemperature').props.minValue,
    undefined,
    'no invented cold-start range',
  );
  await h.start();
  assert.equal(await h.get('CurrentTemperature').handleGetRequest(), 20.5);
  assert.equal(await h.get('TargetTemperature').handleGetRequest(), 32);
  assert.equal(await h.get('TargetHeatingCoolingState').handleGetRequest(), 1);
  assert.equal(await h.get('CurrentHeatingCoolingState').handleGetRequest(), 0);
  assert.equal(h.get('TargetTemperature').props.minValue, 10);
  assert.equal(h.get('TargetTemperature').props.maxValue, 38);
  assert.equal(h.get('TargetTemperature').props.minStep, 0.5);
  assert.deepEqual(h.get('TargetHeatingCoolingState').props.validValues, [0, 1]);
  assert.equal(h.writes.length, 0);
});

test('unrepresentable readings and activity never become rounded temperatures or guessed Off/Heat', async (t) => {
  const h = await setup(t);
  await h.start();
  await h.change({ waterCelsius: available(20.55), activity: unknown, mode: unknown });
  for (const name of [
    'CurrentTemperature',
    'CurrentHeatingCoolingState',
    'TargetHeatingCoolingState',
  ]) {
    await assert.rejects(h.get(name).handleGetRequest(), communicationFailure);
  }
  await h.change({
    waterCelsius: available(20.5),
    mode: available('heat'),
    activity: available('heating'),
  });
  assert.equal(await h.get('CurrentHeatingCoolingState').handleGetRequest(), 1);
  for (const activity of ['defrost', 'flow-fault']) {
    await h.change({ activity: available(activity) });
    await assert.rejects(
      h.get('CurrentHeatingCoolingState').handleGetRequest(),
      communicationFailure,
    );
  }
  await h.change({
    activity: available('idle'),
    power: available('off'),
    reportedTargetCelsius: available(45),
  });
  assert.equal(await h.get('TargetHeatingCoolingState').handleGetRequest(), 0);
  assert.equal(await h.get('CurrentHeatingCoolingState').handleGetRequest(), 0);
  await assert.rejects(h.get('TargetTemperature').handleGetRequest(), communicationFailure);
  await h.change({ control: unknown });
  assert.equal(h.get('TargetTemperature').props.minValue, undefined);
  await assert.rejects(h.get('TargetTemperature').handleSetRequest(32), communicationFailure);
  assert.equal(h.writes.length, 0);
});

test('HAP setters validate before traffic, wait for confirmation and persist only local display units', async (t) => {
  const held = deferred();
  const h = await setup(t, { write: () => held.promise });
  await h.start();
  for (const invalid of [9, 39, 31.1, NaN, '31']) {
    await assert.rejects(
      h.get('TargetTemperature').handleSetRequest(invalid),
      (error) => error === -70410,
    );
  }
  for (const invalid of [2, 3, '1']) {
    await assert.rejects(
      h.get('TargetHeatingCoolingState').handleSetRequest(invalid),
      (error) => error === -70410,
    );
  }
  assert.equal(h.writes.length, 0);
  const set = h.get('TargetTemperature').handleSetRequest(31);
  await h.scheduler.flush();
  assert.equal(await h.get('TargetTemperature').handleGetRequest(), 32);
  held.resolve();
  await set;
  assert.equal(await h.get('TargetTemperature').handleGetRequest(), 31);
  await h.get('TargetHeatingCoolingState').handleSetRequest(0);
  assert.equal(await h.get('TargetHeatingCoolingState').handleGetRequest(), 0);
  await h.get('TemperatureDisplayUnits').handleSetRequest(1);
  assert.equal(await h.get('TemperatureDisplayUnits').handleGetRequest(), 1);
  assert.equal(h.accessory.context.displayUnits, 1);
  assert.equal(h.saved(), 1);
  assert.equal(h.writes.length, 2);
  await assert.rejects(
    h.get('TemperatureDisplayUnits').handleSetRequest(2),
    (error) => error === -70410,
  );
});

test('stale/offline/shutdown characteristic reads fail while retaining the last confirmed value', async (t) => {
  const h = await setup(t);
  await h.start();
  await h.change({ connectivity: 'offline' });
  await assert.rejects(h.get('CurrentTemperature').handleGetRequest(), communicationFailure);
  await h.change({ connectivity: 'online' });
  assert.equal(await h.get('CurrentTemperature').handleGetRequest(), 20.5);
  await h.change(new CloudError('unavailable'));
  assert.equal(await h.get('CurrentTemperature').handleGetRequest(), 20.5);
  await h.scheduler.advance(120_000);
  h.thermostat.update();
  await assert.rejects(h.get('CurrentTemperature').handleGetRequest(), communicationFailure);
  assert.equal(h.get('CurrentTemperature').value, 20.5);
  await assert.rejects(
    h.get('TargetHeatingCoolingState').handleSetRequest(0),
    communicationFailure,
  );
  h.thermostat.close();
  await assert.rejects(h.get('CurrentTemperature').handleGetRequest(), communicationFailure);
  assert.equal(h.writes.length, 0);
});

test('timed-out HAP setters settle within eight seconds and never replay late commands', async (t) => {
  const held = deferred();
  const h = await setup(t, { write: () => held.promise });
  await h.start();
  const failed = assert.rejects(
    h.get('TargetTemperature').handleSetRequest(31),
    (error) => error === -70408,
  );
  await h.scheduler.advance(8_000);
  await failed;
  assert.equal(h.writes.length, 1);
  held.resolve();
  await h.scheduler.flush();
  assert.equal(h.writes.length, 1);
});

test('target constraints intersect offset grids and fail closed for empty or malformed capabilities', async (t) => {
  const h = await setup(t);
  await h.start();
  await h.change({
    control: available({ minimumCelsius: 9.95, maximumCelsius: 40, stepCelsius: 0.15 }),
    reportedTargetCelsius: available(20),
  });
  assert.equal(h.get('TargetTemperature').props.minValue, 10.1);
  assert.equal(h.get('TargetTemperature').props.maxValue, 38);
  assert.equal(h.get('TargetTemperature').props.minStep, 0.3);
  assert.equal(await h.get('TargetTemperature').handleGetRequest(), 20);
  for (const constraints of [
    { minimumCelsius: 50, maximumCelsius: 60, stepCelsius: 1 },
    { minimumCelsius: 20, maximumCelsius: 40, stepCelsius: 0 },
    { minimumCelsius: NaN, maximumCelsius: 40, stepCelsius: 1 },
  ]) {
    await h.change({ control: available(constraints) });
    await assert.rejects(h.get('TargetTemperature').handleGetRequest(), communicationFailure);
    await assert.rejects(h.get('TargetTemperature').handleSetRequest(32), communicationFailure);
    assert.equal(h.get('TargetTemperature').props.minValue, undefined);
  }
  assert.equal(h.writes.length, 0);
});
