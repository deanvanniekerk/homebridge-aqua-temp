import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { setTimeout as delay } from 'node:timers/promises';
import { credentials, login, reply, serverFor, success } from './fake-cloud.mjs';

import { runHomebridge } from './homebridge-process.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
let workspace;
let archive;
let pack;
before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'aqua-package-'));
  const result = await run('npm', ['pack', '--json', '--pack-destination', workspace], {
    cwd: root,
  });
  [pack] = JSON.parse(result.stdout);
  archive = join(workspace, pack.filename);
});
after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test('distribution contains only reviewed runtime files and refuses publication', async () => {
  assert.deepEqual(pack.files.map((file) => file.path).sort(), [
    'LICENSE',
    'README.md',
    'config.schema.json',
    'dist/cloud-client.js',
    'dist/cloud-error.js',
    'dist/cloud-http.js',
    'dist/cloud-protocol.js',
    'dist/cloud-time.js',
    'dist/command-queue.js',
    'dist/configuration.js',
    'dist/coordinator.js',
    'dist/device-model.js',
    'dist/diagnostics.js',
    'dist/gateway.js',
    'dist/index.js',
    'dist/platform.js',
    'dist/scheduler.js',
    'dist/settings.js',
    'dist/thermostat.js',
    'package.json',
  ]);
  await run('tar', ['-xzf', archive, '-C', workspace]);
  const installed = join(workspace, 'package');
  const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.private, true);
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.equal(metadata.name, '@deanvanniekerk/homebridge-aqua-temp');
  const module = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const m = await import('./dist/index.js'); if (typeof m.default !== 'function') process.exit(1);",
    ],
    { cwd: installed },
  );
  assert.equal(module.stderr, '');
  await assert.rejects(run('npm', ['run', 'prepublishOnly'], { cwd: installed }), (error) => {
    assert.match(error.stderr, /Publishing is disabled until release preparation/);
    return true;
  });
});

test(
  'packed plugin loads in a clean production Homebridge host and survives restart',
  { timeout: 180_000 },
  async (t) => {
    let targetValue = '32',
      power = '0',
      ignoreWrite = false;
    let expectedWrites = 0;
    const server = await serverFor(t, (call, response) => {
      const path = call.path.split('/').at(-1);
      const device = {
        deviceCode: 'synthetic-device',
        model: 'PASRW040-P-BP4II-C',
        custModel: 'BOOSTi-INV-HP-40',
      };
      if (path === 'control') {
        const command = call.body.param[0];
        if (!ignoreWrite) {
          if (command.protocolCode === 'R02') targetValue = command.value;
          else if (command.protocolCode === 'Power') power = command.value;
          else throw new Error('Unexpected mode write');
        }
        return reply(response, success(null));
      }
      const result = {
        deviceList: [device],
        getMyAppectDeviceShareDataList: [device],
        getDeviceStatus: { status: 'ONLINE', isFault: false },
        getDataByCode: [
          { code: 'T02', dataType: 'TEMP', value: '20.5' },
          { code: 'R02', dataType: 'TEMP', value: targetValue },
          { code: 'Set_Temp', dataType: 'TEMP', value: '32' },
          { code: 'Power', dataType: 'ENUM', value: power },
          { code: 'Mode', dataType: 'ENUM', value: '1' },
          { code: 'O07', dataType: null, value: '0' },
        ],
      }[path];
      reply(response, path === 'login' ? login : success(result));
    });
    const processOptions = {
      preload: fileURLToPath(new URL('./redirect-cloud.mjs', import.meta.url)),
      env: { AQUA_TEST_ORIGIN: server.origin },
    };
    const consumer = join(workspace, 'consumer');
    await mkdir(join(consumer, 'storage'), { recursive: true });
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true }));
    await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--omit=dev',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
        '--engine-strict',
        'homebridge@2.4.0',
        archive,
      ],
      { cwd: consumer, timeout: 120_000 },
    );
    await assert.rejects(access(join(consumer, 'node_modules/typescript')));
    await assert.rejects(access(join(consumer, 'node_modules/eslint')));
    const config = {
      bridge: {
        name: 'Aqua foundation smoke',
        username: '0E:11:22:33:44:66',
        pin: '031-45-154',
        port: 0,
        bind: ['127.0.0.1'],
        advertiser: 'ciao',
      },
      accessories: [],
      platforms: [
        {
          platform: 'AquaTemp',
          name: 'Aqua Temp',
          ...credentials,
          debug: true,
        },
      ],
    };
    const configPath = join(consumer, 'storage/config.json');
    await writeFile(configPath, JSON.stringify(config));
    let identity;
    const exercise = async (output) => {
      const match = [...output().matchAll(/Homebridge v2\.4\.0.*is running on port (\d+)/g)].at(-1);
      assert.ok(match, output());
      const origin = `http://127.0.0.1:${match[1]}`;
      let water;
      const deadline = Date.now() + 5_000;
      while (!water) {
        const response = await fetch(`${origin}/accessories`);
        assert.equal(response.status, 200);
        const body = await response.json();
        for (const accessory of body.accessories) {
          const service = accessory.services.find((item) => item.type === '4A');
          const current = service?.characteristics.find((item) => item.type === '11');
          const target = service?.characteristics.find((item) => item.type === '35');
          // HAP snapshots metadata before awaiting getters. Startup discovery can
          // therefore contain fresh readings with the previous read-only props.
          if (current?.value === 20.5 && target?.perms.includes('pw'))
            water = { aid: accessory.aid, iid: current.iid, service };
        }
        if (Date.now() >= deadline)
          throw new Error(`No fresh thermostat in Homebridge: ${JSON.stringify(body)}`);
        if (!water) await delay(20);
      }
      const nextIdentity = { aid: water.aid, iid: water.iid };
      if (identity) assert.deepEqual(nextIdentity, identity);
      identity = nextIdentity;
      const target = water.service.characteristics.find((item) => item.type === '35');
      const read = await fetch(
        `${origin}/characteristics?id=${water.aid}.${water.iid},${water.aid}.${target.iid}`,
      );
      assert.equal(read.status, 200);
      const values = (await read.json()).characteristics;
      assert.equal(values.find((item) => item.iid === water.iid).value, 20.5);
      assert.equal(values.find((item) => item.iid === target.iid).value, 32);
      assert.equal(
        server.calls.filter((call) => call.path.endsWith('/control')).length,
        expectedWrites,
        'startup/restart sends no commands',
      );
      assert.equal(target.minValue, 15);
      assert.equal(target.maxValue, 38, 'HomeKit/device range intersection');
      assert.equal(target.minStep, 0.5);
      const state = water.service.characteristics.find((item) => item.type === '33');
      const activity = water.service.characteristics.find((item) => item.type === 'F');
      assert.equal(activity.value, 0);
      async function writeValue(characteristic, value, succeeds = true) {
        const response = await fetch(`${origin}/characteristics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/hap+json', authorization: config.bridge.pin },
          body: JSON.stringify({
            characteristics: [{ aid: water.aid, iid: characteristic.iid, value }],
          }),
        });
        if (succeeds) assert.equal(response.status, 204);
        else {
          assert.equal(response.status, 207);
          assert.equal((await response.json()).characteristics[0].status, -70402);
        }
      }
      await writeValue(target, 32.5);
      await writeValue(state, 1);
      const confirmed = await fetch(
        `${origin}/characteristics?id=${water.aid}.${target.iid},${water.aid}.${state.iid}`,
      );
      assert.deepEqual(
        (await confirmed.json()).characteristics.map((item) => item.value),
        [32.5, 1],
      );
      await writeValue(state, 0);
      await writeValue(target, 32);
      ignoreWrite = true;
      await writeValue(target, 31, false);
      ignoreWrite = false;
      const unchanged = await fetch(`${origin}/characteristics?id=${water.aid}.${target.iid}`);
      assert.equal(
        (await unchanged.json()).characteristics[0].value,
        32,
        'accepted but unconfirmed write never becomes reported state',
      );
      expectedWrites += 5;
      assert.equal(
        server.calls.filter((call) => call.path.endsWith('/control')).length,
        expectedWrites,
        'each setter sends one absolute write',
      );
    };
    const diagnosticOutput = await runHomebridge(consumer, undefined, {
      ...processOptions,
      exercise,
    });
    const reportLines = diagnosticOutput
      .split('\n')
      .filter((line) => line.includes('Diagnostic report: '));
    assert.equal(reportLines.length, 1);
    const report = JSON.parse(reportLines[0].split('Diagnostic report: ')[1]);
    assert.equal(report.runtime.plugin, '0.0.0-development.0');
    assert.equal(report.devices[0].reference, 'device-1');
    assert.equal(report.devices[0].controls, 'available');
    assert.doesNotMatch(JSON.stringify(report), /synthetic|@|token|deviceCode|deviceId/);

    await runHomebridge(consumer, undefined, { ...processOptions, exercise });
    const beforeInvalid = server.calls.length;
    config.platforms[0].pollInterval = 'synthetic-secret-invalid-interval';
    await writeFile(configPath, JSON.stringify(config));
    const rejectedOutput = await runHomebridge(
      consumer,
      'Configuration rejected: Poll interval',
      processOptions,
    );
    assert.equal(server.calls.length, beforeInvalid);
    assert.doesNotMatch(rejectedOutput, /synthetic@example|synthetic-password|synthetic-secret/);
    assert.doesNotMatch(rejectedOutput, /Aqua Temp monitoring started/);
    delete config.platforms[0].pollInterval;
    await writeFile(configPath, JSON.stringify(config));
    await runHomebridge(consumer, undefined, { ...processOptions, exercise });
    config.platforms[0]._bridge = { username: '0E:11:22:33:44:77', port: 0 };
    await mkdir(join(consumer, 'child-storage'));
    await writeFile(join(consumer, 'child-storage/config.json'), JSON.stringify(config));
    identity = undefined; // Child bridges have a separate HAP identity namespace.
    const childOptions = { ...processOptions, exercise, bridges: 2, storage: 'child-storage' };
    await runHomebridge(consumer, undefined, childOptions);
    await runHomebridge(consumer, undefined, childOptions);
    assert.equal(server.calls.filter((call) => call.path.endsWith('/login')).length, 5);
    assert.equal(expectedWrites, 25);
    assert.equal(
      server.calls.filter((call) => call.path.endsWith('/control')).length,
      expectedWrites,
    );
    assert.ok(
      server.calls.every((call) =>
        [
          'login',
          'deviceList',
          'getMyAppectDeviceShareDataList',
          'getDeviceStatus',
          'getDataByCode',
          'control',
        ].includes(call.path.split('/').at(-1)),
      ),
    );
  },
);
