import { isOperatingMode } from './device-model.js';
import { CloudError, isRecord, type CloudErrorCategory } from './cloud-error.js';
import {
  DeviceError,
  type Device,
  type DeviceReadings,
  type DeviceCommand,
} from './device-model.js';
import { bounded, systemScheduler, type Scheduler } from './scheduler.js';
import { CommandError, DeviceCommandQueue } from './command-queue.js';

export interface DeviceGateway {
  /** Resource-owning gateways close their client, including authentication shared by read waiters. */
  close?(): void;
  discover(signal: AbortSignal): Promise<DeviceDiscovery>;
  read(device: Device, signal: AbortSignal): Promise<DeviceReadings>;
  /** Require verified absolute commands, bounds/step and authoritative readback; reject locally otherwise. */
  validateCommand(device: Device, command: DeviceCommand, readings: DeviceReadings): void;
  /** Transport acceptance only. Readback remains necessary to confirm the requested state. */
  write(device: Device, command: DeviceCommand, signal: AbortSignal): Promise<void>;
}

export interface DeviceDiscovery {
  devices: Device[];
  complete: boolean;
  failure?: CloudError;
}

export type DeviceStatus =
  | 'healthy'
  | 'stale'
  | 'offline'
  | 'auth-required'
  | 'permission-denied'
  | 'protocol-error'
  | 'unavailable';
export interface DeviceState {
  readonly device: Device;
  readonly status: DeviceStatus;
  readonly readings: DeviceReadings | undefined;
  readonly lastSuccessMs: number | undefined;
  readonly failure: CloudErrorCategory | 'unsupported' | 'unverified' | 'unconfirmed' | undefined;
}

export interface AccountSnapshot {
  readonly devices: readonly DeviceState[];
  readonly discoveryComplete: boolean;
  readonly failure: CloudErrorCategory | undefined;
  readonly retryAtMs: number;
}

export class AccountCoordinator {
  readonly #gateway: DeviceGateway;
  readonly #scheduler: Scheduler;
  readonly #intervalMs: number;
  readonly #shutdown = new AbortController();
  readonly #states = new Map<string, DeviceState>();
  readonly #commands: DeviceCommandQueue;
  readonly #subscribers = new Set<{ wake: () => void; close: () => void }>();
  #revision = 0;
  #cancelFreshness: (() => void) | undefined;
  #started = false;
  #cancelPoll: (() => void) | undefined;
  #retryAt = 0;
  #polling = false;
  #refreshRequested = false;
  #discoveryComplete = false;
  #failure: CloudErrorCategory | undefined;

  constructor(
    gateway: DeviceGateway,
    options: { scheduler?: Scheduler; intervalMs?: number } = {},
  ) {
    this.#gateway = gateway;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#commands = new DeviceCommandQueue(this.#scheduler, this.#shutdown.signal);
    this.#intervalMs = options.intervalMs ?? 60_000;
    if (
      !Number.isFinite(this.#intervalMs) ||
      this.#intervalMs < 30_000 ||
      this.#intervalMs > 300_000
    )
      throw new CloudError('invalid-request');
  }

  start(): void {
    if (this.#started || this.#shutdown.signal.aborted) return;
    this.#started = true;
    void this.poll();
  }

  close(): void {
    if (this.#shutdown.signal.aborted) return;
    this.#shutdown.abort();
    this.#cancelPoll?.();
    this.#cancelPoll = undefined;
    this.#cancelFreshness?.();
    this.#cancelFreshness = undefined;
    for (const subscriber of this.#subscribers) subscriber.close();
    this.#gateway.close?.();
  }

  state(id: string): DeviceState | undefined {
    const state = this.#states.get(id);
    if (!state) return undefined;
    const stale =
      state.status === 'healthy' &&
      state.lastSuccessMs !== undefined &&
      this.#scheduler.now() - state.lastSuccessMs >= 3 * this.#intervalMs;
    return Object.freeze({ ...state, status: stale ? 'stale' : state.status });
  }

  devices(): readonly Device[] {
    return [...this.#states.values()].map((state) => state.device);
  }

  snapshot(): AccountSnapshot {
    return Object.freeze({
      devices: Object.freeze(
        [...this.#states.keys()].map((id) => this.state(id)).filter((state) => state !== undefined),
      ),
      discoveryComplete: this.#discoveryComplete,
      failure: this.#failure,
      retryAtMs: this.#retryAt,
    });
  }

  /** Latest-state stream: slow consumers coalesce updates rather than accumulating snapshots. */
  async *updates(signal?: AbortSignal): AsyncGenerator<AccountSnapshot, void, unknown> {
    const lifecycle = { ended: false };
    const subscriber = {
      wake: () => {},
      close: () => {
        lifecycle.ended = true;
        signal?.removeEventListener('abort', subscriber.close);
        this.#subscribers.delete(subscriber);
        subscriber.wake();
      },
    };
    const closed = () =>
      lifecycle.ended || this.#shutdown.signal.aborted || signal?.aborted === true;
    if (closed()) return;
    if (this.#subscribers.size >= 8) throw new CloudError('invalid-request');
    this.#subscribers.add(subscriber);
    signal?.addEventListener('abort', subscriber.close, { once: true });
    let revision = -1;
    try {
      while (!closed()) {
        if (revision === this.#revision)
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve;
          });
        if (closed()) break;
        revision = this.#revision;
        yield this.snapshot();
      }
    } finally {
      subscriber.close();
    }
  }

  private changed(): void {
    if (this.#shutdown.signal.aborted) return;
    this.#revision += 1;
    for (const subscriber of this.#subscribers) subscriber.wake();
    this.#cancelFreshness?.();
    this.#cancelFreshness = undefined;
    const now = this.#scheduler.now();
    let next = Infinity;
    for (const state of this.#states.values()) {
      if (state.status !== 'healthy' || state.lastSuccessMs === undefined) continue;
      const expires = state.lastSuccessMs + 3 * this.#intervalMs;
      if (expires > now) next = Math.min(next, expires);
    }
    if (Number.isFinite(next))
      this.#cancelFreshness = this.#scheduler.after(next - now, () => {
        this.changed();
      });
  }

  async command(id: string, input: DeviceCommand): Promise<void> {
    const attempt = { dispatched: false };
    try {
      const command = copyCommand(input);
      this.readyForCommand(id, command);
      await this.#commands.run(id, async (signal) => {
        const state = this.readyForCommand(id, command);
        attempt.dispatched = true;
        try {
          await this.#gateway.write(state.device, command, signal);
          signal.throwIfAborted();
          const readings = await this.#gateway.read(state.device, signal);
          signal.throwIfAborted();
          this.acceptReadings(state.device, readings);
          if (!confirms(readings, command)) throw new CommandError('unconfirmed');
        } finally {
          // Cancellation may settle the setter before the underlying operation completes.
          if (signal.aborted) this.refresh();
        }
      });
    } catch (error) {
      const safe =
        error instanceof CloudError || error instanceof DeviceError || error instanceof CommandError
          ? error
          : new CloudError('unavailable');
      if (attempt.dispatched && !this.#shutdown.signal.aborted) this.failed(id, safe);
      throw safe;
    } finally {
      if (attempt.dispatched) this.refresh();
    }
  }

  private refresh(): void {
    if (!this.#started || this.#shutdown.signal.aborted) return;
    this.#refreshRequested = true;
    if (this.#polling) return;
    this.#cancelPoll?.();
    this.#cancelPoll = this.#scheduler.after(
      Math.max(0, this.#retryAt - this.#scheduler.now()),
      () => {
        void this.poll();
      },
    );
  }

  private readyForCommand(id: string, command: DeviceCommand) {
    if (this.#shutdown.signal.aborted) throw new CloudError('cancelled');
    const state = this.state(id);
    if (!state || state.status !== 'healthy' || state.failure !== undefined || !state.readings)
      throw new CloudError('unavailable');
    this.#gateway.validateCommand(state.device, command, state.readings);
    return { ...state, readings: state.readings };
  }

  private acceptReadings(device: Device, readings: DeviceReadings): void {
    this.#states.set(device.id, {
      device: this.#states.get(device.id)?.device ?? device,
      readings,
      status: readings.connectivity === 'offline' ? 'offline' : 'healthy',
      lastSuccessMs:
        readings.connectivity === 'offline'
          ? this.#states.get(device.id)?.lastSuccessMs
          : readings.observedAtMs,
      failure: undefined,
    });
    this.changed();
  }

  private async poll(): Promise<void> {
    this.#polling = true;
    this.#refreshRequested = false;
    const cycleRevisions = new Map(
      this.devices().map((device) => [device.id, this.#commands.revision(device.id)]),
    );
    this.#retryAt = 0;
    const discoveryProgress = { finished: false };
    try {
      await bounded(this.#scheduler, 30_000, this.#shutdown.signal, async (signal) => {
        const discovery = await this.#gateway.discover(signal);
        signal.throwIfAborted();
        discoveryProgress.finished = true;
        this.#discoveryComplete = discovery.complete;
        this.#failure = discovery.failure?.category;
        this.retainRetry(discovery.failure);
        for (const device of discovery.devices) {
          const previous = this.#states.get(device.id);
          this.#states.set(
            device.id,
            previous
              ? { ...previous, device }
              : {
                  device,
                  status: 'unavailable',
                  readings: undefined,
                  lastSuccessMs: undefined,
                  failure: undefined,
                },
          );
        }
        // Temporary omissions never delete a device; continue refreshing known identities.
        for (const state of this.#states.values()) {
          signal.throwIfAborted();
          const revision = this.#commands.revision(state.device.id);
          if (!this.#commands.acceptsPoll(state.device.id, revision)) continue;
          try {
            const readings = await this.#gateway.read(state.device, signal);
            signal.throwIfAborted();
            if (this.#commands.acceptsPoll(state.device.id, revision))
              this.acceptReadings(
                this.#states.get(state.device.id)?.device ?? state.device,
                readings,
              );
          } catch (error) {
            if (!signal.aborted) {
              this.retainRetry(error);
              if (this.#commands.acceptsPoll(state.device.id, revision))
                this.failed(state.device.id, error);
            }
          }
        }
      });
    } catch (error) {
      this.retainRetry(error);
      if (!this.#shutdown.signal.aborted) {
        if (!discoveryProgress.finished) this.#discoveryComplete = false;
        this.#failure = error instanceof CloudError ? error.category : 'invalid-response';
        for (const id of this.#states.keys())
          if (this.#commands.acceptsPoll(id, cycleRevisions.get(id) ?? 0)) this.failed(id, error);
      }
    } finally {
      this.#polling = false;
      this.changed();
      if (!this.#shutdown.signal.aborted)
        this.#cancelPoll = this.#scheduler.after(this.nextPollDelay(), () => {
          void this.poll();
        });
    }
  }

  private nextPollDelay(): number {
    return Math.max(
      this.#refreshRequested ? 0 : this.#intervalMs,
      this.#retryAt - this.#scheduler.now(),
    );
  }

  private failed(id: string, error: unknown): void {
    this.retainRetry(error);
    const state = this.#states.get(id);
    if (!state) return;
    const category =
      error instanceof CloudError || error instanceof DeviceError
        ? error.category
        : error instanceof CommandError && error.category === 'unconfirmed'
          ? 'unconfirmed'
          : 'unavailable';
    const status: DeviceStatus =
      category === 'invalid-credentials'
        ? 'auth-required'
        : category === 'permission-denied'
          ? 'permission-denied'
          : category === 'invalid-response'
            ? 'protocol-error'
            : state.readings?.connectivity === 'offline'
              ? 'offline'
              : state.lastSuccessMs !== undefined
                ? 'healthy'
                : 'unavailable';
    this.#states.set(id, { ...state, status, failure: category });
    this.changed();
  }

  private retainRetry(error: unknown): void {
    if (error instanceof CloudError)
      this.#retryAt = Math.max(this.#retryAt, this.#scheduler.now() + error.retryAfterMs);
  }
}

function copyCommand(input: unknown): DeviceCommand {
  if (isRecord(input)) {
    if (
      input.kind === 'target-temperature' &&
      typeof input.celsius === 'number' &&
      Number.isFinite(input.celsius) &&
      (input.mode === undefined || isOperatingMode(input.mode))
    )
      return Object.freeze({
        kind: input.kind,
        celsius: input.celsius,
        ...(input.mode === undefined ? {} : { mode: input.mode }),
      });
    if (
      input.kind === 'target-state' &&
      (input.state === 'off' || isOperatingMode(input.state)) &&
      (input.allowModeChange === undefined || typeof input.allowModeChange === 'boolean')
    )
      return Object.freeze({
        kind: input.kind,
        state: input.state,
        ...(input.allowModeChange === true ? { allowModeChange: true } : {}),
      });
  }
  throw new CloudError('invalid-request');
}

function confirms(readings: DeviceReadings, command: DeviceCommand): boolean {
  if (readings.connectivity !== 'online') return false;
  if (command.kind === 'target-temperature')
    return (
      readings.mode.available &&
      readings.mode.value === (command.mode ?? 'heat') &&
      readings.reportedTargetCelsius.available &&
      readings.reportedTargetCelsius.value === command.celsius
    );
  return (
    readings.power.available &&
    (command.state === 'off'
      ? readings.power.value === 'off'
      : readings.power.value === 'on' &&
        readings.mode.available &&
        readings.mode.value === command.state)
  );
}
