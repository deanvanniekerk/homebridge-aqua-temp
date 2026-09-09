import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { discoverDevices, normalizeReadings } from '../dist/device-model.js';

async function observed(name) {
  const fixture = JSON.parse(
    await readFile(new URL(`../fixtures/protocol/${name}.json`, import.meta.url), 'utf8'),
  );
  return fixture.response.bodyProjection.objectResult;
}
const owned = await observed('deviceList');
const shared = await observed('shared-device-list');
const telemetry = await observed('telemetry-core');

test('owned and shared observations deduplicate by device code despite different account-scoped IDs', () => {
  const result = discoverDevices(owned, shared);
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].id, 'DEVICE_CODE_1');
  assert.equal(result.devices[0].profile, 'boost-i-hp40');
  assert.deepEqual(result.devices[0].sources, ['owned', 'shared']);
  assert.equal(result.rejectedRecords, 0);
  assert.equal(JSON.stringify(result).includes('SHARED_DEVICE_ID_1'), false);
});

test('observed Heat readings enable bounded controls without guessing compressor activity', () => {
  const [device] = discoverDevices(owned, []).devices;
  const state = normalizeReadings(device, { status: 'ONLINE', isFault: false }, telemetry, 1000);
  assert.deepEqual(state.waterCelsius, { available: true, value: 20.5 });
  assert.deepEqual(state.power, { available: true, value: 'off' });
  assert.deepEqual(state.mode, { available: true, value: 'heat' });
  assert.deepEqual(state.reportedTargetCelsius, { available: true, value: 32 });
  assert.deepEqual(state.activity, { available: false, reason: 'unverified' });
  assert.deepEqual(state.control, {
    available: true,
    value: { minimumCelsius: 15, maximumCelsius: 40, stepCelsius: 0.5 },
  });
  assert.equal(state.observedAtMs, 1000);
  assert.equal(state.measuredAtMs, null);
});

test('invalid and conflicting discovery records cannot silently select a writable profile', () => {
  const result = discoverDevices(
    [
      ...owned,
      null,
      { ...owned[0], deviceCode: 'bad', device_code: 'different' },
      { ...owned[0], deviceCode: '', device_code: '' },
    ],
    [{ ...shared[0], model: 'unknown-model' }],
  );
  assert.equal(result.rejectedRecords, 3);
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].profile, 'unknown');
  assert.throws(() => discoverDevices({}, []), { category: 'invalid-response' });
});

test('invalid temperatures never become zero or the target while valid zero stays available', () => {
  const [device] = discoverDevices(owned, []).devices;
  for (const value of [
    '',
    ' ',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e999',
    '0x10',
    null,
    false,
    20,
    '-274',
  ]) {
    const fields = telemetry.map((entry) => (entry.code === 'T02' ? { ...entry, value } : entry));
    const state = normalizeReadings(device, { status: 'ONLINE' }, fields, 1000);
    assert.deepEqual(state.waterCelsius, { available: false, reason: 'invalid' });
  }
  const fields = telemetry.map((entry) =>
    entry.code === 'T02' ? { ...entry, value: '0.0' } : entry,
  );
  assert.deepEqual(normalizeReadings(device, { status: 'ONLINE' }, fields, 1000).waterCelsius, {
    available: true,
    value: 0,
  });
});

test('missing, duplicate and incorrectly typed sensors remain unavailable independently', () => {
  const [device] = discoverDevices(owned, []).devices;
  const missing = telemetry.filter((entry) => entry.code !== 'T02');
  assert.deepEqual(normalizeReadings(device, { status: 'ONLINE' }, missing, 1000).waterCelsius, {
    available: false,
    reason: 'missing',
  });
  const water = telemetry.find((entry) => entry.code === 'T02');
  for (const fields of [
    [...telemetry, water],
    [...missing, { ...water, dataType: 'ENUM' }],
    [...missing, { ...water, rangeStart: '30', rangeEnd: '40' }],
  ]) {
    const state = normalizeReadings(device, { status: 'ONLINE' }, fields, 1000);
    assert.deepEqual(state.waterCelsius, { available: false, reason: 'invalid' });
    assert.deepEqual(state.power, { available: true, value: 'off' });
  }
});

test('Heat target follows owner-observed R02 values even when Set_Temp retains the old target', () => {
  const [device] = discoverDevices(owned, []).devices;
  // Synthetic responses constructed from the original fixture and owner-confirmed app targets.
  for (const target of [32.5, 15, 40, 32]) {
    const fields = telemetry.map((entry) =>
      entry.code === 'R02' ? { ...entry, value: target.toFixed(1) } : entry,
    );
    assert.deepEqual(
      normalizeReadings(device, { status: 'ONLINE' }, fields, 1000).reportedTargetCelsius,
      { available: true, value: target },
    );
  }
  const withoutGeneric = telemetry.filter((entry) => entry.code !== 'Set_Temp');
  assert.deepEqual(
    normalizeReadings(device, { status: 'ONLINE' }, withoutGeneric, 1000).reportedTargetCelsius,
    { available: true, value: 32 },
  );
});

test('missing or invalid Heat target cannot fall back to the stale generic target', () => {
  const [device] = discoverDevices(owned, []).devices;
  const withoutHeat = telemetry.filter((entry) => entry.code !== 'R02');
  assert.deepEqual(
    normalizeReadings(device, { status: 'ONLINE' }, withoutHeat, 1000).reportedTargetCelsius,
    { available: false, reason: 'missing' },
  );
  const heat = telemetry.find((entry) => entry.code === 'R02');
  for (const replacement of [
    [{ ...heat, value: '' }],
    [{ ...heat, value: 'NaN' }],
    [{ ...heat, dataType: 'ENUM' }],
    [heat, heat],
  ]) {
    assert.deepEqual(
      normalizeReadings(device, { status: 'ONLINE' }, [...withoutHeat, ...replacement], 1000)
        .reportedTargetCelsius,
      { available: false, reason: 'invalid' },
    );
  }
});

test('unverified mode/activity never become fabricated Heat or Idle', () => {
  const [device] = discoverDevices(owned, []).devices;
  for (const mode of ['3', 'unknown', 'toString', '__proto__']) {
    const fields = telemetry.map((entry) =>
      entry.code === 'Mode'
        ? { ...entry, value: mode }
        : entry.code === 'Power'
          ? { ...entry, value: '1' }
          : entry,
    );
    const state = normalizeReadings(device, { status: 'ONLINE', isFault: true }, fields, 1000);
    assert.deepEqual(state.mode, { available: false, reason: 'unsupported' });
    assert.deepEqual(state.activity, { available: false, reason: 'unverified' });
    assert.deepEqual(state.reportedTargetCelsius, { available: false, reason: 'unsupported' });
    assert.deepEqual(state.waterCelsius, { available: true, value: 20.5 });
    assert.deepEqual(state.fault, { available: true, value: true });
  }
});

test('offline or unsupported devices do not expose fresh-looking readings or capabilities', () => {
  const [device] = discoverDevices(owned, []).devices;
  const offline = normalizeReadings(device, { status: 'OFFLINE', isFault: false }, null, 1000);
  assert.deepEqual(offline.waterCelsius, { available: false, reason: 'offline' });
  assert.deepEqual(offline.fault, { available: false, reason: 'offline' });
  const unknown = normalizeReadings(
    { ...device, profile: 'unknown' },
    { status: 'ONLINE' },
    telemetry,
    1000,
  );
  assert.deepEqual(unknown.waterCelsius, { available: false, reason: 'unsupported' });
  assert.deepEqual(unknown.control, { available: false, reason: 'unsupported' });
  for (const time of [NaN, Infinity, -1])
    assert.throws(() => normalizeReadings(device, { status: 'ONLINE' }, telemetry, time), {
      category: 'invalid-response',
    });
  assert.throws(() => normalizeReadings(device, { status: 'unexpected' }, telemetry, 1000), {
    category: 'invalid-response',
  });
});

test('only a clear fault status and zero compressor frequency establish inactive operation', () => {
  const [device] = discoverDevices(owned, []).devices;
  const stopped = { code: 'O07', dataType: null, value: '0', rangeStart: '0', rangeEnd: '120' };
  const normalize = (frequency, fault = false) =>
    normalizeReadings(
      device,
      { status: 'ONLINE', isFault: fault },
      [...telemetry, frequency],
      1000,
    );
  // DIGI1 is the datatype observed through the installed iHost plugin on 2026-09-09.
  for (const dataType of [null, 'DIGI1']) {
    assert.deepEqual(normalize({ ...stopped, dataType }).activity, {
      available: true,
      value: 'idle',
    });
  }
  for (const dataType of ['TEMP', 'ENUM', 'DIGI2', '', 0])
    assert.equal(normalize({ ...stopped, dataType }).activity.available, false);
  for (const value of ['52', '', '-1', 'NaN'])
    assert.equal(normalize({ ...stopped, value }).activity.available, false);
  assert.equal(normalize(stopped, true).activity.available, false);
  const unknownFault = normalizeReadings(
    device,
    { status: 'ONLINE' },
    [...telemetry, stopped],
    1000,
  );
  assert.equal(unknownFault.activity.available, false);
  const duplicate = normalizeReadings(
    device,
    { status: 'ONLINE', isFault: false },
    [...telemetry, stopped, stopped],
    1000,
  );
  assert.equal(duplicate.activity.available, false);
});

test('app-observed Cool and Auto targets stay independent of stale aliases and write capability', () => {
  const [device] = discoverDevices(owned, []).devices;
  // Values recorded during the 2026-09-09 owner-operated app round trip.
  for (const [wireMode, expectedMode, target, alias] of [
    ['0', 'cool', 0, 0],
    ['0', 'cool', 0.5, 0.5],
    ['0', 'cool', 8, 0.5],
    ['2', 'auto', 30.5, 30.5],
    ['2', 'auto', 30, 30.5],
  ]) {
    const fields = telemetry.filter(
      (row) => !['Mode', 'R01', 'R03', 'Set_Temp'].includes(row.code),
    );
    fields.push(
      { code: 'Mode', dataType: 'ENUM', value: wireMode },
      {
        code: 'R01',
        dataType: 'TEMP',
        value: String(expectedMode === 'cool' ? target : 8),
        rangeStart: '8',
        rangeEnd: '35',
      },
      {
        code: 'R03',
        dataType: 'TEMP',
        value: String(expectedMode === 'auto' ? target : 30),
        rangeStart: '8',
        rangeEnd: '40',
      },
      { code: 'Set_Temp', dataType: 'TEMP', value: String(alias) },
      { code: 'O07', dataType: 'DIGI1', value: '0' },
    );
    const state = normalizeReadings(device, { status: 'ONLINE', isFault: false }, fields, 1000);
    assert.deepEqual(state.mode, { available: true, value: expectedMode });
    assert.deepEqual(state.reportedTargetCelsius, { available: true, value: target });
    assert.equal(
      state.control.available,
      false,
      'reading evidence does not enable unverified writes',
    );
    assert.deepEqual(state.activity, { available: true, value: 'idle' });
    assert.deepEqual(state.power, { available: true, value: 'off' });
  }
});

test('malformed optional rows and stored out-of-range targets do not erase usable readings', () => {
  const [device] = discoverDevices(owned, []).devices;
  const fields = telemetry.map((row) => (row.code === 'R02' ? { ...row, value: '14.5' } : row));
  const state = normalizeReadings(
    device,
    { status: 'ONLINE' },
    [...fields, null, { value: 'bad optional row' }, { code: 'T03', dataType: 'TEMP', value: '' }],
    1000,
  );
  assert.deepEqual(state.power, { available: true, value: 'off' });
  assert.deepEqual(state.waterCelsius, { available: true, value: 20.5 });
  assert.deepEqual(state.reportedTargetCelsius, { available: true, value: 14.5 });
  assert.equal(state.outletCelsius.available, false);
  assert.equal(
    state.control.available,
    false,
    'out-of-range target is readable but cannot enable writes',
  );
});
