import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomebridgeAPI } from '../node_modules/homebridge/dist/api.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { BasicAccessory } from '../dist/basic-accessory.js';
import { FakeScheduler } from './fake-scheduler.mjs';

const yes = (value) => ({ available: true, value });
const unknown = { available: false, reason: 'unverified' };
test('independent inlet, outlet and ambient sensors isolate missing readings and recover after stale data', async (t) => {
  const api = new HomebridgeAPI();
  const scheduler = new FakeScheduler();
  const device = { id: 'synthetic-device', profile: 'boost-i-hp40', sources: ['shared'] };
  const sample = {
    connectivity: 'online',
    measuredAtMs: null,
    waterCelsius: yes(20.5),
    outletCelsius: yes(23),
    ambientCelsius: yes(18),
    reportedTargetCelsius: unknown,
    mode: unknown,
    power: unknown,
    activity: unknown,
    fault: unknown,
    control: unknown,
  };
  let fail = false;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => {
        if (fail) throw new Error('synthetic outage');
        return { ...sample, observedAtMs: scheduler.now() };
      },
      write: async () => {
        writes++;
      },
    },
    { scheduler },
  );
  const sensors = ['inlet', 'outlet', 'ambient'].map((role) => {
    const accessory = new api.platformAccessory(role, api.hap.uuid.generate(role));
    const binding = new BasicAccessory(api.hap, accessory, coordinator, device.id, role);
    const characteristic = accessory
      .getService(api.hap.Service.TemperatureSensor)
      .getCharacteristic(api.hap.Characteristic.CurrentTemperature);
    assert.equal(accessory.getService(api.hap.Service.Switch), undefined);
    assert.equal(characteristic.props.perms.includes('pw'), false);
    return { binding, characteristic };
  });
  const read = (i) => sensors[i].characteristic.handleGetRequest();
  const unavailable = (error) => error === -70402;
  t.after(() => {
    sensors.forEach((s) => s.binding.close());
    coordinator.close();
  });
  await assert.rejects(read(0), unavailable);
  coordinator.start();
  await scheduler.flush();
  assert.deepEqual(await Promise.all(sensors.map((_, i) => read(i))), [20.5, 23, 18]);
  sample.outletCelsius = unknown;
  await scheduler.advance(60_000);
  await assert.rejects(read(1), unavailable);
  assert.equal(await read(0), 20.5);
  assert.equal(await read(2), 18);
  sample.ambientCelsius = yes(18.55);
  await scheduler.advance(60_000);
  await assert.rejects(read(2), unavailable);
  fail = true;
  await scheduler.advance(180_000);
  for (let i = 0; i < sensors.length; i++) await assert.rejects(read(i), unavailable);
  fail = false;
  sample.outletCelsius = yes(24);
  sample.ambientCelsius = yes(19);
  await scheduler.advance(60_000);
  assert.deepEqual(await Promise.all(sensors.map((_, i) => read(i))), [20.5, 24, 19]);
  assert.equal(writes, 0);
  sensors.forEach((s) => s.binding.close());
  for (let i = 0; i < sensors.length; i++) await assert.rejects(read(i), unavailable);
});
