import { systemScheduler } from './scheduler.js';
import type { AccountSnapshot, DeviceState } from './coordinator.js';

interface DiagnosticOptions {
  now?: () => number;
  pluginVersion: string;
  homebridgeVersion: string;
  debug?: boolean;
}

const maximumDevices = 1000;

const statuses = new Set([
  'healthy',
  'stale',
  'offline',
  'auth-required',
  'permission-denied',
  'protocol-error',
  'unavailable',
]);
const failures = new Set([
  'invalid-credentials',
  'permission-denied',
  'session-expired',
  'session-contention',
  'rate-limited',
  'unavailable',
  'invalid-response',
  'vendor-rejected',
  'timeout',
  'cancelled',
  'invalid-request',
  'unsupported',
  'unverified',
  'unconfirmed',
]);
const reasons = new Set(['missing', 'invalid', 'conflict', 'offline', 'unsupported', 'unverified']);
const hints: Readonly<Record<string, string>> = {
  'invalid-credentials': 'Check credentials and reload configuration.',
  'permission-denied': 'Check account or device sharing permissions.',
  'session-contention': 'Consider a dedicated shared account; waiting for cooldown.',
  'invalid-response': 'The response does not match the supported protocol.',
  unverified: 'Device control mapping has not been verified.',
  unconfirmed: 'The requested state was not confirmed; waiting for fresh readings.',
};

function flag(value: unknown): boolean {
  return value === true;
}

function version(value: string): string {
  return /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:development|alpha|beta|rc)\.\d{1,6})?$/.test(value)
    ? value
    : 'unknown';
}

function elapsed(later: number, earlier: number | undefined): number | null {
  return earlier !== undefined && Number.isFinite(later) && Number.isFinite(earlier)
    ? Math.max(0, Math.round(later - earlier))
    : null;
}

/** Projects domain state onto an allowlist; never stringify an input object or error. */
export class Diagnostics {
  readonly #now: () => number;
  readonly #runtime;
  readonly #references = new Map<string, string>();
  readonly #logged = new Map<string, { signature: string; at: number; fault: boolean }>();
  readonly #write: (message: string) => void;
  readonly #debug: boolean;
  #lastReportMs = -Infinity;

  constructor(write: (message: string) => void, options: DiagnosticOptions) {
    this.#write = write;
    this.#debug = options.debug === true;
    this.#now = options.now ?? (() => systemScheduler.now());
    this.#runtime = Object.freeze({
      plugin: version(options.pluginVersion),
      node: version(process.versions.node),
      homebridge: version(options.homebridgeVersion),
    });
  }

  observe(snapshot: AccountSnapshot): void {
    const now = this.#now();
    const report = this.report(snapshot);
    const account = report.account;
    // An initial empty snapshot is neither failure nor recovery evidence.
    if (account.failure !== null || account.discoveryComplete) {
      this.transition(
        'Account',
        account.discoveryComplete ? 'discovered' : 'discovery-incomplete',
        account.failure,
        null,
        report.retryInMs,
        now,
      );
    }
    for (const item of report.devices) {
      this.transition(
        item.reference,
        item.status,
        item.failure,
        item.lastSuccessAgeMs,
        report.retryInMs,
        now,
      );
    }
    if (
      this.#debug &&
      (account.discoveryComplete || account.failure !== null) &&
      now - this.#lastReportMs >= 300_000
    ) {
      this.#lastReportMs = now;
      this.#write(`Diagnostic report: ${JSON.stringify(report)}`);
    }
  }

  report(snapshot: AccountSnapshot) {
    const now = this.#now();
    const devices = snapshot.devices
      .slice(0, maximumDevices)
      .map((state) => this.project(state, now))
      .filter((item) => item !== undefined);
    return {
      runtime: this.#runtime,
      account: {
        discoveryComplete: flag(snapshot.discoveryComplete),
        failure: this.safeFailure(snapshot.failure),
      },
      retryInMs: elapsed(snapshot.retryAtMs, now),
      devices,
      omittedDevices: snapshot.devices.length - devices.length,
    };
  }

  private transition(
    reference: string,
    status: string,
    failure: string | null,
    age: number | null,
    retry: number | null,
    now: number,
  ): void {
    const signature = `${status}/${failure ?? 'none'}`;
    const previous = this.#logged.get(reference);
    const fault = (status !== 'healthy' && status !== 'discovered') || failure !== null;
    if (!fault) {
      this.#logged.set(reference, { signature, at: now, fault });
      if (previous?.fault)
        this.#write(
          `${reference} recovered; ${reference === 'Account' ? 'discovery completed.' : 'fresh readings available.'}`,
        );
      return;
    }
    if (previous?.signature === signature && now - previous.at < 300_000) return;
    this.#logged.set(reference, { signature, at: now, fault });
    const hint = failure === null ? '' : (hints[failure] ?? '');
    this.#write(
      `${reference}: ${status}; ${failure ?? 'no cloud failure'}. ${hint} last-success-age-ms=${String(age ?? 'unknown')} retry-in-ms=${String(retry ?? 'unknown')}`,
    );
  }

  private safeFailure(failure: string | undefined): string | null {
    return failure === undefined ? null : failures.has(failure) ? failure : 'unavailable';
  }

  private project(state: DeviceState, now: number) {
    let reference = this.#references.get(state.device.id);
    if (!reference) {
      if (this.#references.size >= maximumDevices) return undefined;
      reference = `device-${String(this.#references.size + 1)}`;
      this.#references.set(state.device.id, reference);
    }
    const control = state.readings?.control;
    return {
      reference,
      profile: state.device.profile === 'boost-i-hp40' ? 'boost-i-hp40' : 'unknown',
      status: statuses.has(state.status) ? state.status : 'unavailable',
      controls:
        control?.available === true
          ? 'available'
          : control?.available === false && reasons.has(control.reason)
            ? control.reason
            : 'unavailable',
      lastSuccessAgeMs: elapsed(now, state.lastSuccessMs),
      failure: this.safeFailure(state.failure),
    };
  }
}
