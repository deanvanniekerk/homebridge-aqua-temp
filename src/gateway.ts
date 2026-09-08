import { systemScheduler } from './scheduler.js';
import type { AquaTempClient } from './cloud-client.js';
import type { DeviceDiscovery, DeviceGateway } from './coordinator.js';
import { CloudError } from './cloud-error.js';
import {
  DeviceError,
  discoverDevices,
  normalizeReadings,
  telemetrySelectors,
  type Device,
  type DeviceCommand,
  type DeviceReadings,
} from './device-model.js';

interface DiscoverySource {
  records: unknown[];
  failure?: CloudError;
}

/** Own the client lifecycle and translate cloud calls into normalized domain readings. */
export class AquaTempGateway implements DeviceGateway {
  readonly #client: AquaTempClient;
  readonly #now: () => number;

  constructor(client: AquaTempClient, options: { now?: () => number } = {}) {
    this.#client = client;
    this.#now = options.now ?? (() => systemScheduler.now());
  }

  close(): void {
    this.#client.close();
  }

  async discover(signal: AbortSignal): Promise<DeviceDiscovery> {
    const [owned, shared] = await Promise.allSettled([
      this.#client
        .read({ kind: 'owned' }, { signal })
        .then((value): DiscoverySource => ({ records: deviceList(value) })),
      this.sharedDevices(signal),
    ]);
    signal.throwIfAborted();
    const failures = [owned, shared].flatMap((result) =>
      result.status === 'rejected'
        ? [safeFailure(result.reason)]
        : result.value.failure
          ? [result.value.failure]
          : [],
    );
    const terminal = failures.find(
      (error) => error.category === 'invalid-credentials' || error.category === 'permission-denied',
    );
    if (terminal) throw terminal;
    let failure = failures.sort((a, b) => b.retryAfterMs - a.retryAfterMs)[0];
    if (owned.status === 'rejected' && shared.status === 'rejected')
      throw failure ?? new CloudError('invalid-response');
    const result = discoverDevices(
      owned.status === 'fulfilled' ? owned.value.records : [],
      shared.status === 'fulfilled' ? shared.value.records : [],
    );
    if (result.rejectedRecords > 0) failure ??= new CloudError('invalid-response');
    return {
      devices: result.devices,
      complete: failure === undefined,
      ...(failure ? { failure } : {}),
    };
  }

  private async sharedDevices(signal: AbortSignal): Promise<DiscoverySource> {
    const records: unknown[] = [];
    const identities = new Set<string>();
    for (let page = 1; page <= 100; page += 1) {
      try {
        const batch = deviceList(await this.#client.read({ kind: 'shared', page }, { signal }));
        signal.throwIfAborted();
        if (batch.length > 100) throw new CloudError('invalid-response');
        const ids = discoverDevices([], batch).devices.map((device) => device.id);
        if (batch.length === 100 && records.length > 0 && ids.every((id) => identities.has(id)))
          throw new CloudError('invalid-response');
        records.push(...batch);
        for (const id of ids) identities.add(id);
        if (batch.length < 100) return { records };
      } catch (error) {
        if (records.length === 0) throw safeFailure(error);
        return { records, failure: safeFailure(error) };
      }
    }
    return { records, failure: new CloudError('invalid-response') };
  }

  async read(device: Device, signal: AbortSignal): Promise<DeviceReadings> {
    const status = await this.#client.read({ kind: 'status', deviceCode: device.id }, { signal });
    signal.throwIfAborted();
    const statusOnly = normalizeReadings(device, status, [], this.#now());
    if (statusOnly.connectivity === 'offline' || device.profile === 'unknown') return statusOnly;
    const telemetry = await this.#client.read(
      {
        kind: 'telemetry',
        deviceCode: device.id,
        codes: [...telemetrySelectors],
      },
      { signal },
    );
    signal.throwIfAborted();
    return normalizeReadings(device, status, telemetry, this.#now());
  }

  validateCommand(device: Device, _command: DeviceCommand, _readings: DeviceReadings): void {
    throw unverifiedControl(device);
  }

  write(device: Device, _command: DeviceCommand, _signal: AbortSignal): Promise<void> {
    return Promise.reject(unverifiedControl(device));
  }
}

function deviceList(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new CloudError('invalid-response');
  return value;
}

function safeFailure(error: unknown): CloudError {
  return error instanceof CloudError ? error : new CloudError('invalid-response');
}

function unverifiedControl(device: Device): DeviceError {
  return new DeviceError(device.profile === 'unknown' ? 'unsupported' : 'unverified');
}
