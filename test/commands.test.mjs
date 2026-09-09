import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountCoordinator } from '../dist/coordinator.js';
import { CloudError } from '../dist/cloud-error.js';
import { DeviceError } from '../dist/device-model.js';
import { deferred, FakeScheduler } from './fake-scheduler.mjs';

// Synthetic control contract only: these values do not establish vendor capabilities.
const device = { id: 'synthetic-device', profile: 'boost-i-hp40', sources: ['shared'] };
const temperature = (celsius) => ({ kind: 'target-temperature', celsius });
function readings(scheduler, target = 32) {
  return {
    observedAtMs: scheduler.now(),
    connectivity: 'online',
    reportedTargetCelsius: { available: true, value: target },
    power: { available: true, value: 'on' },
    mode: { available: true, value: 'heat' },
    control: { available: true, value: { minimumCelsius: 20, maximumCelsius: 40, stepCelsius: 1 } },
  };
}

test('commands serialize per device and publish confirmed readings rather than optimistic targets', async () => {
  const scheduler = new FakeScheduler();
  const hold = deferred();
  const sent = [];
  let actual = 32;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler, actual),
      validateCommand: () => {},
      write: async (_device, command) => {
        sent.push(command.celsius);
        if (sent.length === 1) await hold.promise;
        actual = command.celsius;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const first = coordinator.command(device.id, temperature(31));
  const intent = temperature(30);
  const second = coordinator.command(device.id, intent);
  intent.celsius = 99;
  await scheduler.flush();
  assert.deepEqual(sent, [31]);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 32);
  hold.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [31, 30]);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 30);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('four admitted commands share an eight-second admission deadline and never replay after timeout', async () => {
  const scheduler = new FakeScheduler();
  const hold = deferred();
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler),
      validateCommand: () => {},
      write: async () => {
        writes += 1;
        await hold.promise;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const outcomes = [];
  const jobs = Array.from({ length: 4 }, (_, index) =>
    coordinator.command(device.id, temperature(31)).then(
      () => {
        outcomes[index] = 'resolved';
      },
      (error) => {
        outcomes[index] = error.category;
      },
    ),
  );
  await assert.rejects(coordinator.command(device.id, temperature(31)), { category: 'busy' });
  await scheduler.advance(7999);
  assert.deepEqual(outcomes, []);
  await scheduler.advance(1);
  await Promise.all(jobs);
  assert.equal(outcomes[0], 'timeout');
  assert.deepEqual(outcomes.slice(1), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(writes, 1);
  hold.resolve();
  await scheduler.flush();
  assert.equal(writes, 1);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('a pre-command poll cannot overwrite confirmed state with an old reading or failure', async () => {
  for (const oldFails of [false, true]) {
    const scheduler = new FakeScheduler();
    const oldPoll = deferred();
    let calls = 0;
    let actual = 32;
    const coordinator = new AccountCoordinator(
      {
        discover: async () => ({ devices: [device], complete: true }),
        read: async () => {
          calls += 1;
          if (calls === 2) return oldPoll.promise;
          return readings(scheduler, actual);
        },
        validateCommand: () => {},
        write: async (_device, command) => {
          actual = command.celsius;
        },
      },
      { scheduler },
    );
    coordinator.start();
    await scheduler.flush();
    await scheduler.advance(60_000);
    await coordinator.command(device.id, temperature(31));
    if (oldFails) oldPoll.reject(new Error('synthetic old network failure'));
    else oldPoll.resolve(readings(scheduler, 32));
    await scheduler.flush();
    assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 31);
    assert.equal(coordinator.state(device.id).failure, undefined);
    actual = 28; // An external app change must be adopted without sending another command.
    await scheduler.advance(60_000);
    assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 28);
    coordinator.close();
  }
});

test('ambiguous delivery discards pending intent and reconciles once through reads without retrying writes', async () => {
  const scheduler = new FakeScheduler();
  const response = deferred();
  let actual = 32;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler, actual),
      validateCommand: () => {},
      write: async (_device, command) => {
        writes += 1;
        actual = command.celsius;
        await response.promise;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const first = assert.rejects(coordinator.command(device.id, temperature(31)), {
    category: 'unavailable',
  });
  const queued = assert.rejects(coordinator.command(device.id, temperature(30)), {
    category: 'cancelled',
  });
  await scheduler.flush();
  response.reject(new CloudError('unavailable', 0, true));
  await Promise.all([first, queued]);
  assert.equal(coordinator.state(device.id).failure, 'unavailable');
  await assert.rejects(coordinator.command(device.id, temperature(29)), {
    category: 'unavailable',
  });
  await scheduler.advance(0);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 31);
  assert.equal(coordinator.state(device.id).failure, undefined);
  assert.equal(writes, 1);
  actual = 28;
  await scheduler.advance(60_000);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 28);
  assert.equal(writes, 1);
  coordinator.close();
});

test('a write that completes after its deadline triggers another read but cannot settle the setter late', async () => {
  const scheduler = new FakeScheduler();
  const late = deferred();
  let actual = 32;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler, actual),
      validateCommand: () => {},
      write: async () => {
        writes += 1;
        await late.promise;
        actual = 31;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const setter = assert.rejects(coordinator.command(device.id, temperature(31)), {
    category: 'timeout',
  });
  await scheduler.advance(8000);
  await setter;
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 32);
  await scheduler.advance(7000);
  late.resolve();
  await scheduler.flush();
  await scheduler.advance(0);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 31);
  assert.equal(writes, 1);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('time in the queue consumes the setter budget even when the preceding command succeeds', async () => {
  const scheduler = new FakeScheduler();
  const firstResponse = deferred();
  const secondResponse = deferred();
  let target = 32;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler, target),
      validateCommand: () => {},
      write: async (_device, command) => {
        writes += 1;
        await (writes === 1 ? firstResponse.promise : secondResponse.promise);
        target = command.celsius;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const first = coordinator.command(device.id, temperature(31));
  const second = assert.rejects(coordinator.command(device.id, temperature(30)), {
    category: 'timeout',
  });
  await scheduler.advance(6000);
  firstResponse.resolve();
  await first;
  await scheduler.flush();
  assert.equal(writes, 2);
  await scheduler.advance(2000);
  await second;
  coordinator.close();
  secondResponse.resolve();
  await scheduler.flush();
  assert.equal(scheduler.tasks.size, 0);
});

test('a blocked device does not block another and shutdown settles all pending commands without late reads', async () => {
  const scheduler = new FakeScheduler();
  const secondDevice = { ...device, id: 'synthetic-second' };
  const hold = deferred();
  let readCount = 0;
  let target = 32;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device, secondDevice], complete: true }),
      read: async () => {
        readCount += 1;
        return readings(scheduler, target);
      },
      validateCommand: () => {},
      write: async (current, command) => {
        if (current.id === device.id) await hold.promise;
        else target = command.celsius;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const pending = [31, 30].map((value) =>
    assert.rejects(coordinator.command(device.id, temperature(value)), { category: 'cancelled' }),
  );
  await coordinator.command(secondDevice.id, temperature(29));
  assert.equal(coordinator.state(secondDevice.id).readings.reportedTargetCelsius.value, 29);
  coordinator.close();
  await Promise.all(pending);
  const before = readCount;
  hold.resolve();
  await scheduler.flush();
  await scheduler.advance(300_000);
  assert.equal(readCount, before);
  assert.equal(scheduler.tasks.size, 0);
  await assert.rejects(coordinator.command(secondDevice.id, temperature(28)), {
    category: 'cancelled',
  });
});

test('unverified commands fail locally and transport acceptance without matching readback is unconfirmed', async () => {
  const scheduler = new FakeScheduler();
  let verified = false;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler),
      validateCommand: () => {
        if (!verified) throw new DeviceError('unverified');
      },
      write: async () => {
        writes += 1;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  await assert.rejects(coordinator.command(device.id, temperature(31)), { category: 'unverified' });
  await assert.rejects(coordinator.command(device.id, temperature(NaN)), {
    category: 'invalid-request',
  });
  assert.equal(writes, 0);
  verified = true;
  await assert.rejects(coordinator.command(device.id, temperature(31)), {
    category: 'unconfirmed',
  });
  assert.equal(writes, 1);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 32);
  assert.equal(coordinator.state(device.id).failure, 'unconfirmed');
  coordinator.close();
});

test('Heat requires both on and heating mode, while Off is confirmed by power alone', async () => {
  for (const target of ['heat', 'off']) {
    const scheduler = new FakeScheduler();
    let powered = 'on';
    const coordinator = new AccountCoordinator(
      {
        discover: async () => ({ devices: [device], complete: true }),
        read: async () => ({
          ...readings(scheduler),
          power: { available: true, value: powered },
          mode: { available: false, reason: 'unsupported' },
        }),
        validateCommand: () => {},
        write: async () => {
          powered = target === 'heat' ? 'on' : 'off';
        },
      },
      { scheduler },
    );
    coordinator.start();
    await scheduler.flush();
    const operation = coordinator.command(device.id, { kind: 'target-state', state: target });
    if (target === 'heat') await assert.rejects(operation, { category: 'unconfirmed' });
    else await operation;
    coordinator.close();
  }
});

test('an obsolete poll still applies account Retry-After without overwriting confirmed device state', async () => {
  const scheduler = new FakeScheduler();
  const oldPoll = deferred();
  let readCount = 0;
  let discoveries = 0;
  let actual = 32;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => {
        discoveries += 1;
        return { devices: [device], complete: true };
      },
      read: async () => {
        readCount += 1;
        return readCount === 2 ? oldPoll.promise : readings(scheduler, actual);
      },
      validateCommand: () => {},
      write: async (_device, command) => {
        actual = command.celsius;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  await scheduler.advance(60_000);
  await coordinator.command(device.id, temperature(31));
  oldPoll.reject(new CloudError('rate-limited', 300_000));
  await scheduler.flush();
  assert.equal(coordinator.state(device.id).failure, undefined);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 31);
  await scheduler.advance(299_999);
  assert.equal(discoveries, 2);
  await scheduler.advance(1);
  assert.equal(discoveries, 3);
  coordinator.close();
});

test('a timed-out operation retains its dispatch lock until the underlying gateway settles', async () => {
  const scheduler = new FakeScheduler();
  const late = deferred();
  let actual = 32;
  let writes = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => readings(scheduler, actual),
      validateCommand: () => {},
      write: async (_device, command) => {
        writes += 1;
        if (writes === 1) await late.promise;
        actual = command.celsius;
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const first = assert.rejects(coordinator.command(device.id, temperature(31)), {
    category: 'timeout',
  });
  await scheduler.advance(8000);
  await first;
  assert.equal(coordinator.state(device.id).failure, undefined); // Recovery read completed.
  await assert.rejects(coordinator.command(device.id, temperature(30)), { category: 'busy' });
  assert.equal(writes, 1);
  late.resolve();
  await scheduler.flush();
  await scheduler.advance(0);
  await coordinator.command(device.id, temperature(30));
  assert.equal(writes, 2);
  assert.equal(coordinator.state(device.id).readings.reportedTargetCelsius.value, 30);
  coordinator.close();
});

test('Cool or Auto readback cannot confirm a Heat command even when power or target matches', async () => {
  for (const mode of ['cool', 'auto'])
    for (const command of [temperature(32), { kind: 'target-state', state: 'heat' }]) {
      const scheduler = new FakeScheduler();
      let selected = 'heat';
      let writes = 0;
      const coordinator = new AccountCoordinator(
        {
          discover: async () => ({ devices: [device], complete: true }),
          read: async () => ({
            ...readings(scheduler),
            mode: { available: true, value: selected },
          }),
          validateCommand: () => {},
          write: async () => {
            writes += 1;
            selected = mode;
          },
        },
        { scheduler },
      );
      coordinator.start();
      await scheduler.flush();
      await assert.rejects(coordinator.command(device.id, command), { category: 'unconfirmed' });
      assert.equal(writes, 1, 'uncertain write is not replayed');
      assert.equal(coordinator.state(device.id).readings.mode.value, mode);
      coordinator.close();
    }
});
