import assert from 'node:assert/strict';
import { onTestFinished, test } from 'vitest';
import { HomebridgeAPI } from '../../node_modules/homebridge/dist/api.js';
import { AquaTempClient } from '../cloud/cloud-client.js';
import { credentials, login, reply, serverFor, success } from '../cloud/fake-cloud.test-support.js';
import { Thermostat } from '../homebridge/thermostat.js';
import { AccountCoordinator } from './coordinator.js';
import { FakeScheduler } from './fake-scheduler.test-support.js';
import { AquaTempGateway } from './gateway.js';

test('a lost write acknowledgment reconciles the applied target, then adopts a later app target without replay', async (t) => {
  const scheduler = new FakeScheduler();
  const device = {
    deviceCode: 'synthetic-recovery',
    model: 'PASRW040-P-BP4II-C',
    custModel: 'BOOSTi-INV-HP-40',
  };
  let target = '32';
  let writes = 0;
  const server = await serverFor(t, (call, response) => {
    const path = call.path.split('/').at(-1);
    if (path === 'control') {
      writes += 1;
      assert.deepEqual(call.body.param, [
        { deviceCode: device.deviceCode, protocolCode: 'R02', value: '31.5' },
      ]);
      target = '31.5';
      response.destroy(); // The device applied the command, but the reply never reaches the client.
      return;
    }
    const result = {
      deviceList: [device],
      getMyAppectDeviceShareDataList: [],
      getDeviceStatus: { status: 'ONLINE', isFault: false },
      getDataByCode: [
        { code: 'T02', dataType: 'TEMP', value: '21' },
        { code: 'R02', dataType: 'TEMP', value: target },
        { code: 'Set_Temp', dataType: 'TEMP', value: '32' },
        { code: 'Power', dataType: 'ENUM', value: '0' },
        { code: 'Mode', dataType: 'ENUM', value: '1' },
        { code: 'O07', dataType: null, value: '0' },
      ],
    }[path];
    reply(response, path === 'login' ? login : success(result));
  });
  const client = new AquaTempClient(credentials, {
    origin: server.origin,
    clock: {
      now: scheduler.now,
      random: () => 0,
      sleep: () => {
        throw new Error('Reconciliation must respect the scheduled backoff');
      },
    },
  });
  const coordinator = new AccountCoordinator(new AquaTempGateway(client, { now: scheduler.now }), {
    scheduler,
  });
  const api = new HomebridgeAPI();
  const accessory = new api.platformAccessory(
    'Synthetic heater',
    api.hap.uuid.generate(device.deviceCode),
  );
  const thermostat = new Thermostat(api.hap, accessory, coordinator, device.deviceCode, () => {});
  onTestFinished(() => {
    thermostat.close();
    coordinator.close();
  });
  const characteristic = accessory
    .getService(api.hap.Service.Thermostat)
    .getCharacteristic(api.hap.Characteristic.TargetTemperature);
  async function observe(expected) {
    for await (const snapshot of coordinator.updates(AbortSignal.timeout(2000))) {
      if (
        snapshot.devices[0]?.readings?.reportedTargetCelsius.value === expected &&
        snapshot.devices[0].failure === undefined
      )
        break;
    }
    await scheduler.flush();
    thermostat.update();
    assert.equal(await characteristic.handleGetRequest(), expected);
  }
  coordinator.start();
  await observe(32);
  await assert.rejects(characteristic.handleSetRequest(31.5), (error) => error === -70402);
  assert.equal(
    await characteristic.handleGetRequest(),
    32,
    'no optimistic state after the lost reply',
  );
  await scheduler.advance(5000);
  await observe(31.5);
  assert.equal(writes, 1);
  target = '30.5'; // A later independent change made through the vendor app.
  await scheduler.advance(60_000);
  await observe(30.5);
  assert.equal(writes, 1, 'both recoveries use reads only');
});
