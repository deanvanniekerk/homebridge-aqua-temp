import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HomebridgeAPI } from '../node_modules/homebridge/dist/api.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { AquaTempGateway } from '../dist/gateway.js';
import { BasicAccessory } from '../dist/basic-accessory.js';
import { FakeScheduler } from './fake-scheduler.mjs';

const yes = (value) => ({ available: true, value });
const unknown = { available: false, reason: 'unverified' };
test('independent HAP power and water capabilities survive unknown activity/targets and recover after stale data', async (t) => {
  const api = new HomebridgeAPI();
  const scheduler = new FakeScheduler();
  const device = { id: 'synthetic-device', profile: 'boost-i-hp40', sources: ['shared'] };
  let sample = {
    connectivity: 'online',
    measuredAtMs: null,
    waterCelsius: yes(20.5),
    outletCelsius: unknown,
    ambientCelsius: unknown,
    reportedTargetCelsius: unknown,
    mode: unknown,
    power: yes('on'),
    activity: unknown,
    fault: unknown,
    control: unknown,
  };
  let fail = false;
  const writes = [];
  const gateway = {
    discover: async () => ({ devices: [device], complete: true }),
    read: async () => {
      if (fail) throw new Error('synthetic outage');
      return { ...sample, observedAtMs: scheduler.now() };
    },
    validateCommand: AquaTempGateway.prototype.validateCommand,
    write: async (_device, command) => {
      writes.push(command);
      sample.power = yes('off');
    },
  };
  const coordinator = new AccountCoordinator(gateway, { scheduler });
  const power = new api.platformAccessory('Heater Power', api.hap.uuid.generate('power'));
  const water = new api.platformAccessory('Heater Water', api.hap.uuid.generate('water'));
  const bindings = [
    new BasicAccessory(api.hap, power, coordinator, device.id, 'power'),
    new BasicAccessory(api.hap, water, coordinator, device.id, 'water'),
  ];
  const on = power.getService(api.hap.Service.Switch).getCharacteristic(api.hap.Characteristic.On);
  const temp = water
    .getService(api.hap.Service.TemperatureSensor)
    .getCharacteristic(api.hap.Characteristic.CurrentTemperature);
  const unavailable = (error) => error === -70402;
  t.after(() => {
    bindings.forEach((b) => b.close());
    coordinator.close();
  });
  await assert.rejects(on.handleGetRequest(), unavailable);
  coordinator.start();
  await scheduler.flush();
  bindings.forEach((b) => b.update());
  assert.equal(await on.handleGetRequest(), true);
  assert.equal(await temp.handleGetRequest(), 20.5);
  await assert.rejects(on.handleSetRequest(true), unavailable);
  assert.equal(writes.length, 0, 'unknown mode cannot turn on');
  await on.handleSetRequest(false);
  assert.deepEqual(writes, [{ kind: 'target-state', state: 'off' }]);
  assert.equal(await on.handleGetRequest(), false);
  sample.waterCelsius = unknown;
  await scheduler.advance(60_000);
  bindings.forEach((b) => b.update());
  await assert.rejects(temp.handleGetRequest(), unavailable);
  assert.equal(await on.handleGetRequest(), false);
  fail = true;
  await scheduler.advance(180_000);
  bindings.forEach((b) => b.update());
  await assert.rejects(on.handleGetRequest(), unavailable);
  fail = false;
  sample.waterCelsius = yes(21);
  await scheduler.advance(60_000);
  bindings.forEach((b) => b.update());
  assert.equal(await temp.handleGetRequest(), 21);
  assert.equal(await on.handleGetRequest(), false);
  assert.equal(
    power.services.some((s) => s.UUID === api.hap.Service.Thermostat.UUID),
    false,
  );
  bindings.forEach((b) => b.close());
  await assert.rejects(on.handleGetRequest(), unavailable);
});
