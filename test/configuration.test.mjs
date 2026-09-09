import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Ajv from 'ajv';
import { parseConfig } from '../dist/configuration.js';

const schema = JSON.parse(
  await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'),
).schema;
const valid = { username: 'synthetic@example.invalid', password: 'synthetic-password' };

test('runtime and UI schema agree on credentials, identity selection, interval and debug boundaries', () => {
  const validate = new Ajv({ strict: false, formats: { password: true } }).compile(schema);
  const cases = [
    [valid, true],
    [
      { ...valid, includeOutletTemperatureSensor: true, includeInletTemperatureSensor: false },
      true,
    ],
    [{ ...valid, includeOutletTemperatureSensor: 'true' }, false],
    [{ ...valid, includeInletTemperatureSensor: 1 }, false],
    [{ ...valid, pollInterval: 30, debug: true, deviceIds: ['one', 'two'] }, true],
    [{ ...valid, pollInterval: 300 }, true],
    [{ ...valid, pollInterval: 29 }, false],
    [{ ...valid, pollInterval: 301 }, false],
    [{ ...valid, pollInterval: 60.5 }, false],
    [{ ...valid, pollInterval: '60' }, false],
    [{ ...valid, debug: 'true' }, false],
    [{ ...valid, deviceIds: ['one', 'one'] }, false],
    [{ ...valid, deviceIds: [''] }, false],
    [{ ...valid, deviceIds: [' space '] }, false],
    [{ ...valid, deviceIds: 'one' }, false],
    [{ ...valid, username: '' }, false],
    [{ ...valid, username: ' ' }, false],
    [{ ...valid, password: '' }, false],
    [{ ...valid, password: ' ' }, false],
    [{ username: valid.username }, false],
    [null, false],
    ...[
      'name',
      'deviceIds',
      'debug',
      'pollInterval',
      'includeOutletTemperatureSensor',
      'includeInletTemperatureSensor',
      'includeAmbientTemperatureSensor',
    ].map((key) => [{ ...valid, [key]: null }, false]),
    [{ ...valid, name: '🌊'.repeat(64) }, true],
    [{ ...valid, name: '🌊'.repeat(65) }, false],
  ];
  for (const [config, expected] of cases) {
    assert.equal(validate(config), expected);
    if (expected) assert.doesNotThrow(() => parseConfig(config));
    else assert.throws(() => parseConfig(config), { name: 'ConfigurationError' });
  }
  const config = parseConfig(valid);
  assert.equal(config.pollInterval, 60);
  assert.equal(config.debug, false);
  assert.equal(config.includeOutletTemperatureSensor, false);
  assert.equal(config.includeInletTemperatureSensor, false);
  assert.equal(config.includeAmbientTemperatureSensor, false);
  assert.equal(validate({ ...valid, includeAmbientTemperatureSensor: true }), true);
  assert.equal(
    parseConfig({ ...valid, includeAmbientTemperatureSensor: true })
      .includeAmbientTemperatureSensor,
    true,
  );
  assert.deepEqual(
    Object.keys(schema.properties)
      .filter((k) => k.startsWith('include'))
      .sort(),
    [
      'includeAmbientTemperatureSensor',
      'includeInletTemperatureSensor',
      'includeOutletTemperatureSensor',
    ],
  );
  assert.deepEqual(config.deviceIds, []);
  assert.equal(config.name, 'Aqua Temp');
});
