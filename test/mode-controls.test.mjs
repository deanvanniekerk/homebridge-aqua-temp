import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AquaTempClient } from '../dist/cloud-client.js';
import { AquaTempGateway } from '../dist/gateway.js';
import { AccountCoordinator } from '../dist/coordinator.js';
import { credentials, login, reply, serverFor, success } from './fake-cloud.mjs';

// Synthetic transport exercises recorded mappings, not physical compatibility.
async function setup(t) {
  const state = { Power: '0', Mode: '1', R01: '8', R02: '32', R03: '30' };
  const writes = [];
  const device = { id: 'synthetic-device', profile: 'boost-i-hp40', sources: ['owned'] };
  const server = await serverFor(t, (call, response) => {
    const path = call.path.split('/').at(-1);
    if (path === 'login') return reply(response, login);
    if (path === 'deviceList')
      return reply(
        response,
        success([
          { deviceCode: device.id, model: 'PASRW040-P-BP4II-C', custModel: 'BOOSTi-INV-HP-40' },
        ]),
      );
    if (path === 'getMyAppectDeviceShareDataList') return reply(response, success([]));
    if (path === 'getDeviceStatus')
      return reply(response, success({ status: 'ONLINE', isFault: false }));
    if (path === 'getDataByCode')
      return reply(
        response,
        success([
          ...Object.entries(state).map(([code, value]) => ({
            code,
            value,
            dataType: ['Mode', 'Power'].includes(code) ? 'ENUM' : 'TEMP',
          })),
          { code: 'Set_Temp', value: '32', dataType: 'TEMP' },
          { code: 'T02', value: '20.5', dataType: 'TEMP' },
          { code: 'O07', value: '0', dataType: 'DIGI1' },
        ]),
      );
    if (path === 'control') {
      assert.equal(call.body.param.length, 1, 'never assume batch atomicity');
      const cmd = call.body.param[0];
      writes.push([cmd.protocolCode, cmd.value]);
      if (state.ignore !== cmd.protocolCode) state[cmd.protocolCode] = cmd.value;
      if (cmd.protocolCode === 'Mode' && state.turnOnWithMode) state.Power = '1';
      return reply(response, success(null));
    }
    throw Error('Unexpected request');
  });
  const gateway = new AquaTempGateway(new AquaTempClient(credentials, { origin: server.origin }));
  t.after(() => gateway.close());
  return { state, writes, gateway, device, signal: new AbortController().signal };
}

test('targets bind to their observed mode and use its register without touching power or other targets', async (t) => {
  const h = await setup(t);
  for (const [mode, wireMode, value, register] of [
    ['cool', '0', 8.5, 'R01'],
    ['auto', '2', 30.5, 'R03'],
  ]) {
    h.state.Mode = wireMode;
    await h.gateway.write(h.device, { kind: 'target-temperature', mode, celsius: value }, h.signal);
    const readings = await h.gateway.read(h.device, h.signal);
    assert.equal(readings.reportedTargetCelsius.value, value);
    assert.equal(readings.power.value, 'off');
    assert.deepEqual(h.writes.at(-1), [register, String(value)]);
    await assert.rejects(
      h.gateway.write(
        h.device,
        { kind: 'target-temperature', mode: 'heat', celsius: 32 },
        h.signal,
      ),
    );
  }
  assert.deepEqual(h.writes, [
    ['R01', '8.5'],
    ['R03', '30.5'],
  ]);
  assert.equal(h.state.R02, '32');
});

test('coordinator retains mode-bound intent and confirms selected-mode power and target', async (t) => {
  for (const [mode, wireMode, target] of [
    ['cool', '0', 8.5],
    ['auto', '2', 30.5],
  ]) {
    const h = await setup(t);
    h.state.Mode = wireMode;
    const coordinator = new AccountCoordinator(h.gateway);
    t.after(() => coordinator.close());
    const updates = coordinator.updates(AbortSignal.timeout(2000));
    coordinator.start();
    for await (const snapshot of updates) if (snapshot.devices[0]?.readings) break;
    await coordinator.command(h.device.id, { kind: 'target-temperature', mode, celsius: target });
    await coordinator.command(h.device.id, { kind: 'target-state', state: mode });
    assert.equal(coordinator.state(h.device.id).readings.mode.value, mode);
    assert.equal(coordinator.state(h.device.id).readings.power.value, 'on');
    await coordinator.command(h.device.id, { kind: 'target-state', state: 'off' });
    assert.equal(coordinator.state(h.device.id).readings.power.value, 'off');
    assert.deepEqual(h.writes.slice(-2), [
      ['Power', '1'],
      ['Power', '0'],
    ]);
  }
});

test('explicit mode selection confirms Mode while Off before issuing Power, and does not replay refused writes', async (t) => {
  for (const [mode, wire] of [
    ['cool', '0'],
    ['auto', '2'],
  ]) {
    const h = await setup(t);
    await h.gateway.write(
      h.device,
      { kind: 'target-state', state: mode, allowModeChange: true },
      h.signal,
    );
    assert.deepEqual(h.writes, [
      ['Mode', wire],
      ['Power', '1'],
    ]);
    assert.equal(h.state.R02, '32');
    assert.equal(h.state.R01, '8');
    assert.equal(h.state.R03, '30');
    await assert.rejects(
      h.gateway.write(
        h.device,
        { kind: 'target-state', state: 'heat', allowModeChange: true },
        h.signal,
      ),
    );
    assert.equal(h.writes.length, 2, 'mode changes while On are not supported');
  }
  for (const failure of ['ignored', 'invalid-target', 'external-power']) {
    const h = await setup(t);
    if (failure === 'ignored') h.state.ignore = 'Mode';
    if (failure === 'invalid-target') h.state.R01 = '0';
    if (failure === 'external-power') h.state.turnOnWithMode = true;
    await assert.rejects(
      h.gateway.write(
        h.device,
        { kind: 'target-state', state: 'cool', allowModeChange: true },
        h.signal,
      ),
    );
    assert.deepEqual(h.writes, [['Mode', '0']]);
  }
  const h = await setup(t);
  await assert.rejects(
    h.gateway.write(h.device, { kind: 'target-state', state: 'cool' }, h.signal),
  );
  assert.deepEqual(h.writes, [], 'ordinary power switches cannot change mode');
});

test('real HAP handlers expose all modes, bind targets, and retain out-of-range values', async (t) => {
  const { HomebridgeAPI } = await import('../node_modules/homebridge/dist/api.js');
  const { Thermostat } = await import('../dist/thermostat.js');
  const h = await setup(t);
  const coordinator = new AccountCoordinator(h.gateway);
  const updates = coordinator.updates(AbortSignal.timeout(2000));
  coordinator.start();
  for await (const snapshot of updates) if (snapshot.devices[0]?.readings) break;
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory('Modes', api.hap.uuid.generate('modes'));
  const thermostat = new Thermostat(api.hap, accessory, coordinator, h.device.id, () => {});
  t.after(() => {
    thermostat.close();
    coordinator.close();
  });
  const C = api.hap.Characteristic;
  const service = accessory.getService(api.hap.Service.Thermostat);
  const state = service.getCharacteristic(C.TargetHeatingCoolingState);
  const target = service.getCharacteristic(C.TargetTemperature);
  assert.deepEqual(state.props.validValues, [0, 1, 2, 3]);
  await state.handleSetRequest(C.TargetHeatingCoolingState.AUTO);
  thermostat.update();
  assert.equal(await state.handleGetRequest(), 3);
  assert.equal(await target.handleGetRequest(), 30);
  await target.handleSetRequest(30.5);
  assert.deepEqual(h.writes.at(-1), ['R03', '30.5']);
  await state.handleSetRequest(C.TargetHeatingCoolingState.OFF);
  await state.handleSetRequest(C.TargetHeatingCoolingState.COOL);
  thermostat.update();
  assert.equal(await state.handleGetRequest(), 2);
  await assert.rejects(target.handleGetRequest(), (error) => error === -70402);
  assert.equal(h.state.R01, '8', 'unrepresentable values are not written or silently clamped');
  await target.handleSetRequest(10.5);
  assert.deepEqual(h.writes.at(-1), ['R01', '10.5']);
  assert.equal(h.state.R02, '32');
  assert.equal(h.state.R03, '30.5');
});
