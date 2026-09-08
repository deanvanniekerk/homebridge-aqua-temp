import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Diagnostics } from '../dist/diagnostics.js';

const snapshot = (devices = [], retryAtMs = 0, failure = undefined, discoveryComplete = true) => ({
  devices,
  retryAtMs,
  failure,
  discoveryComplete,
});

const secret = 'private@example.invalid/token-SECRET';
function state(overrides = {}) {
  return {
    device: { id: secret, profile: 'boost-i-hp40', sources: ['shared'] },
    status: 'stale',
    lastSuccessMs: 1000,
    failure: 'timeout',
    readings: { control: { available: false, reason: 'unverified' } },
    vendorError: { message: secret, headers: { token: secret }, cause: new Error(secret) },
    ...overrides,
  };
}

test('diagnostic reports select safe facts and anonymize identities without serializing vendor data', () => {
  const diagnostics = new Diagnostics(() => {}, {
    now: () => 181_000,
    pluginVersion: '0.0.0-development.0',
    homebridgeVersion: '2.4.0',
  });
  const report = diagnostics.report(snapshot([state()], 211_000));
  assert.deepEqual(report.devices, [
    {
      reference: 'device-1',
      profile: 'boost-i-hp40',
      status: 'stale',
      controls: 'unverified',
      lastSuccessAgeMs: 180_000,
      failure: 'timeout',
    },
  ]);
  assert.equal(report.retryInMs, 30_000);
  assert.equal(report.runtime.homebridge, '2.4.0');
  assert.equal(report.runtime.node, process.versions.node);
  assert.equal(report.runtime.plugin, '0.0.0-development.0');
  const malformed = diagnostics.report(
    snapshot(
      [
        state({
          status: secret,
          failure: secret,
          lastSuccessMs: NaN,
          device: { id: secret, profile: secret },
          readings: { control: { available: false, reason: secret } },
        }),
      ],
      Infinity,
      secret,
      secret,
    ),
  );
  assert.equal(malformed.account.discoveryComplete, false);
  assert.equal(malformed.devices[0].reference, 'device-1');
  assert.equal(malformed.devices[0].status, 'unavailable');
  assert.equal(malformed.devices[0].lastSuccessAgeMs, null);
  assert.equal(malformed.retryInMs, null);
  assert.doesNotMatch(JSON.stringify([report, malformed]), /private@|SECRET|vendorError|headers/);
});

test('normal and debug logs suppress repeated faults for five minutes and announce recovery once', () => {
  for (const debug of [false, true]) {
    let now = 181_000;
    const messages = [];
    const diagnostics = new Diagnostics(
      (message) => {
        if (!message.startsWith('Diagnostic report: ')) messages.push(message);
      },
      {
        now: () => now,
        pluginVersion: '0.0.0-development.0',
        homebridgeVersion: '2.4.0',
        debug,
      },
    );
    const healthy = state({ status: 'healthy', failure: undefined });
    diagnostics.observe(snapshot([healthy]));
    assert.equal(messages.length, 0);
    const denied = state({ status: 'auth-required', failure: 'invalid-credentials' });
    diagnostics.observe(snapshot([denied], now + 30_000));
    assert.equal(messages.length, 1);
    assert.match(messages[0], /device-1.*auth-required.*invalid-credentials/);
    assert.match(messages[0], /Check credentials/);
    assert.equal(messages[0].includes('last-success-age-ms=180000'), true);
    assert.equal(messages[0].includes('retry-in-ms=30000'), true);
    for (let i = 0; i < 100; i += 1) diagnostics.observe(snapshot([denied]));
    now += 299_999;
    diagnostics.observe(snapshot([denied]));
    assert.equal(messages.length, 1);
    now += 1;
    diagnostics.observe(snapshot([denied]));
    assert.equal(messages.length, 2);
    diagnostics.observe(snapshot([healthy]));
    diagnostics.observe(snapshot([healthy]));
    assert.equal(messages.length, 3);
    assert.match(messages[2], /device-1 recovered/);
    diagnostics.observe(snapshot([state({ failure: secret, status: secret })]));
    assert.doesNotMatch(messages.join('\n'), /private@|SECRET|vendorError|headers/);
  }
});

test('diagnostics cap identity tracking and report omitted entries without recycling references', () => {
  const messages = [];
  const diagnostics = new Diagnostics(
    (message) => {
      if (!message.startsWith('Diagnostic report: ')) messages.push(message);
    },
    {
      now: () => 181_000,
      pluginVersion: secret,
      homebridgeVersion: secret,
    },
  );
  const states = Array.from({ length: 1002 }, (_, index) =>
    state({
      device: { id: `${secret}-${index}`, profile: 'unknown' },
    }),
  );
  for (const item of states) diagnostics.observe(snapshot([item]));
  const report = diagnostics.report(snapshot(states));
  assert.equal(report.devices.length, 1000);
  assert.equal(report.omittedDevices, 2);
  assert.equal(messages.length, 1000);
  assert.equal(diagnostics.report(snapshot([states[0]])).devices[0].reference, 'device-1');
  assert.equal(diagnostics.report(snapshot([states[1001]])).omittedDevices, 1);
  assert.equal(report.runtime.plugin, 'unknown');
  assert.equal(report.runtime.homebridge, 'unknown');
  assert.doesNotMatch(JSON.stringify(report), /private@|SECRET/);
});

test('account failures before discovery are actionable and bounded, with an anonymous debug report', () => {
  let now = 1000;
  const messages = [];
  const diagnostics = new Diagnostics((line) => messages.push(line), {
    now: () => now,
    pluginVersion: '0.0.0-development.0',
    homebridgeVersion: '2.4.0',
    debug: true,
  });
  diagnostics.observe(snapshot([], 0, undefined, false));
  assert.equal(messages.length, 0, 'no misleading startup report before any result');
  const failed = snapshot([], now + 30_000, 'invalid-credentials', false);
  diagnostics.observe(failed);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /Account.*invalid-credentials.*Check credentials/);
  assert.match(messages[0], /retry-in-ms=30000/);
  const report = JSON.parse(messages[1].slice('Diagnostic report: '.length));
  assert.deepEqual(report.account, { discoveryComplete: false, failure: 'invalid-credentials' });
  assert.deepEqual(report.devices, []);
  for (let i = 0; i < 100; i += 1) diagnostics.observe(failed);
  assert.equal(messages.length, 2);
  now += 300_000;
  diagnostics.observe(failed);
  assert.equal(messages.length, 4);
  diagnostics.observe(snapshot());
  diagnostics.observe(snapshot());
  assert.equal(messages.length, 5);
  assert.match(messages[4], /Account recovered/);
  assert.doesNotMatch(messages.join('\n'), /private@|SECRET|synthetic/);
});
