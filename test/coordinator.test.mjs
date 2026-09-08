import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { AccountCoordinator } from '../dist/coordinator.js';
import { discoverDevices, normalizeReadings } from '../dist/device-model.js';
import { CloudError } from '../dist/cloud-error.js';
import { deferred, FakeScheduler } from './fake-scheduler.mjs';

const [device] = discoverDevices(
  [{ deviceCode: 'synthetic-device', model: 'PASRW040-P-BP4II-C', custModel: 'BOOSTi-INV-HP-40' }],
  [],
).devices;
function sample(time, value = '20.5') {
  return normalizeReadings(
    device,
    { status: 'ONLINE' },
    [{ code: 'T02', dataType: 'TEMP', value }],
    time,
  );
}

test('one account poll remains non-overlapping and schedules from cycle completion', async () => {
  const scheduler = new FakeScheduler();
  const blocked = deferred();
  let reads = 0;
  const gateway = {
    discover: async () => ({ devices: [device], complete: true }),
    read: async () => {
      reads += 1;
      if (reads === 1) return blocked.promise;
      return sample(scheduler.now());
    },
  };
  const coordinator = new AccountCoordinator(gateway, { scheduler });
  coordinator.start();
  coordinator.start();
  await scheduler.flush();
  assert.equal(reads, 1);
  await scheduler.advance(20_000);
  assert.equal(reads, 1);
  blocked.resolve(sample(scheduler.now()));
  await scheduler.flush();
  assert.equal(coordinator.state(device.id).status, 'healthy');
  await scheduler.advance(59_999);
  assert.equal(reads, 1);
  await scheduler.advance(1);
  assert.equal(reads, 2);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('transient failures preserve a sample until exactly three poll intervals and then recover', async () => {
  const scheduler = new FakeScheduler();
  let fail = false;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => {
        if (fail) throw new CloudError('unavailable');
        return sample(scheduler.now());
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  fail = true;
  await scheduler.advance(179_999);
  assert.equal(coordinator.state(device.id).status, 'healthy');
  assert.equal(coordinator.state(device.id).failure, 'unavailable');
  await scheduler.advance(1);
  assert.equal(coordinator.state(device.id).status, 'stale');
  assert.equal(coordinator.state(device.id).readings.waterCelsius.value, 20.5);
  fail = false;
  await scheduler.advance(60_000);
  assert.equal(coordinator.state(device.id).status, 'healthy');
  assert.equal(coordinator.state(device.id).failure, undefined);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('timed-out discovery cannot install late identities or outlive shutdown', async () => {
  const scheduler = new FakeScheduler();
  const discovery = deferred();
  const coordinator = new AccountCoordinator(
    { discover: () => discovery.promise, read: async () => sample(scheduler.now()) },
    { scheduler },
  );
  coordinator.start();
  await scheduler.advance(30_000);
  assert.equal(coordinator.snapshot().failure, 'timeout');
  assert.equal(coordinator.snapshot().discoveryComplete, false);
  coordinator.close();
  discovery.resolve({ devices: [device], complete: true });
  await scheduler.flush();
  assert.deepEqual(coordinator.devices(), []);
  assert.equal(scheduler.tasks.size, 0);
});

test('device failures remain isolated and temporary discovery omissions never remove identities', async () => {
  const scheduler = new FakeScheduler();
  const second = { ...device, id: 'synthetic-second' };
  let discovery = [device, second];
  let failure;
  let offline = false;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: discovery, complete: discovery.length === 2 }),
      read: async (current) => {
        if (current.id === device.id && failure) throw failure;
        if (current.id === device.id && offline)
          return normalizeReadings(device, { status: 'OFFLINE' }, null, scheduler.now());
        return sample(scheduler.now());
      },
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  discovery = [];
  failure = new CloudError('permission-denied');
  await scheduler.advance(60_000);
  assert.equal(coordinator.devices().length, 2);
  assert.equal(coordinator.state(device.id).status, 'permission-denied');
  assert.equal(coordinator.state(second.id).status, 'healthy');
  failure = undefined;
  offline = true;
  await scheduler.advance(60_000);
  assert.equal(coordinator.state(device.id).status, 'offline');
  assert.equal(coordinator.state(second.id).status, 'healthy');
  offline = false;
  await scheduler.advance(60_000);
  assert.equal(coordinator.state(device.id).status, 'healthy');
  coordinator.close();
});

test('account rate limits delay polling without changing the reading freshness deadline', async () => {
  const scheduler = new FakeScheduler();
  let discoveries = 0;
  let limited = false;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => {
        discoveries += 1;
        if (limited) throw new CloudError('rate-limited', 300_000);
        return { devices: [device], complete: true };
      },
      read: async () => sample(scheduler.now()),
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  limited = true;
  await scheduler.advance(60_000);
  assert.equal(discoveries, 2);
  await scheduler.advance(180_000);
  assert.equal(discoveries, 2);
  assert.equal(coordinator.state(device.id).status, 'stale');
  limited = false;
  await scheduler.advance(120_000);
  assert.equal(discoveries, 3);
  assert.equal(coordinator.state(device.id).status, 'healthy');
  coordinator.close();
});

test('partial discovery retains its account error and retry delay while valid devices stay readable', async () => {
  const scheduler = new FakeScheduler();
  let discoveries = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => {
        discoveries += 1;
        return {
          devices: [device],
          complete: false,
          failure: new CloudError('rate-limited', 300_000),
        };
      },
      read: async () => sample(scheduler.now()),
    },
    { scheduler },
  );
  coordinator.start();
  await scheduler.flush();
  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.discoveryComplete, false);
  assert.equal(snapshot.failure, 'rate-limited');
  assert.equal(snapshot.retryAtMs, scheduler.now() + 300_000);
  assert.equal(snapshot.devices[0].status, 'healthy');
  await scheduler.advance(299_999);
  assert.equal(discoveries, 1);
  assert.equal(coordinator.snapshot().devices[0].status, 'stale');
  await scheduler.advance(1);
  assert.equal(discoveries, 2);
  coordinator.close();
});

test('state updates announce freshness expiry during backoff and end immediately on shutdown', async () => {
  const scheduler = new FakeScheduler();
  let reads = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => {
        reads += 1;
        if (reads > 1) throw new CloudError('rate-limited', 300_000);
        return sample(scheduler.now());
      },
    },
    { scheduler },
  );
  const updates = coordinator.updates();
  assert.deepEqual((await updates.next()).value.devices, []);
  coordinator.start();
  await scheduler.flush();
  assert.equal((await updates.next()).value.devices[0].status, 'healthy');
  await scheduler.advance(60_000);
  const failed = (await updates.next()).value;
  assert.equal(failed.devices[0].failure, 'rate-limited');
  assert.equal(failed.devices[0].status, 'healthy');
  let delivered = false;
  const stale = updates.next().then((result) => {
    delivered = true;
    return result;
  });
  await scheduler.advance(119_999);
  assert.equal(delivered, false);
  await scheduler.advance(1);
  assert.equal((await stale).value.devices[0].status, 'stale');
  assert.equal(reads, 2);
  const pending = updates.next();
  coordinator.close();
  assert.equal((await pending).done, true);
  assert.equal(scheduler.tasks.size, 0);
});

test('slow update consumers receive the latest state and cancellation releases their listeners', async (t) => {
  const scheduler = new FakeScheduler();
  let reads = 0;
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [device], complete: true }),
      read: async () => {
        reads += 1;
        return sample(scheduler.now(), String(20 + reads));
      },
    },
    { scheduler },
  );
  t.after(() => coordinator.close());
  const cancellation = new AbortController();
  const updates = coordinator.updates(cancellation.signal);
  await updates.next();
  coordinator.start();
  await scheduler.advance(300_000);
  assert.equal((await updates.next()).value.devices[0].readings.waterCelsius.value, 26);
  let ended = false;
  const pending = updates.next().then((result) => {
    ended = result.done;
  });
  cancellation.abort();
  await scheduler.flush();
  assert.equal(ended, true);
  await pending;
  assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
  coordinator.close();
  assert.equal(scheduler.tasks.size, 0);
});

test('update subscriptions are bounded and shutdown removes listeners even from paused consumers', async () => {
  const scheduler = new FakeScheduler();
  const coordinator = new AccountCoordinator(
    {
      discover: async () => ({ devices: [], complete: true }),
      read: async () => sample(scheduler.now()),
    },
    { scheduler },
  );
  const cancellation = new AbortController();
  const consumers = Array.from({ length: 8 }, () => coordinator.updates(cancellation.signal));
  await Promise.all(consumers.map((consumer) => consumer.next()));
  const excess = coordinator.updates();
  await assert.rejects(excess.next(), { category: 'invalid-request' });
  await consumers[0].return();
  const replacement = coordinator.updates(cancellation.signal);
  assert.equal((await replacement.next()).done, false);
  assert.equal(getEventListeners(cancellation.signal, 'abort').length, 8);
  coordinator.close();
  assert.equal(getEventListeners(cancellation.signal, 'abort').length, 0);
  for (const consumer of [...consumers, replacement])
    assert.equal((await consumer.next()).done, true);
  assert.equal(scheduler.tasks.size, 0);
});
