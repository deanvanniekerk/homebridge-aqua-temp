import { isRecord } from './cloud-error.js';

export type OperatingMode = 'heat' | 'cool' | 'auto';
export type DeviceProfile = 'boost-i-hp40' | 'unknown';
export interface Device {
  readonly id: string;
  readonly profile: DeviceProfile;
  readonly sources: readonly ('owned' | 'shared')[];
}

export type DeviceCommand =
  | { readonly kind: 'target-temperature'; readonly celsius: number; readonly mode?: OperatingMode }
  | {
      readonly kind: 'target-state';
      readonly state: 'off' | OperatingMode;
      readonly allowModeChange?: boolean;
    };

export type UnavailableReason =
  'missing' | 'invalid' | 'conflict' | 'offline' | 'unsupported' | 'unverified';
export type Reading<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false; readonly reason: UnavailableReason };
export interface DeviceReadings {
  readonly observedAtMs: number;
  readonly measuredAtMs: null;
  readonly connectivity: 'online' | 'offline';
  readonly waterCelsius: Reading<number>;
  readonly outletCelsius: Reading<number>;
  readonly ambientCelsius: Reading<number>;
  readonly reportedTargetCelsius: Reading<number>;
  readonly power: Reading<'on' | 'off'>;
  readonly mode: Reading<OperatingMode>;
  readonly fault: Reading<boolean>;
  readonly activity: Reading<'heating' | 'idle' | 'defrost' | 'flow-fault'>;
  readonly control: Reading<{
    minimumCelsius: number;
    maximumCelsius: number;
    stepCelsius: number;
  }>;
}

export const telemetrySelectors = Object.freeze([
  'Power',
  'Mode',
  'R01',
  'R02',
  'R03',
  'T02',
  'T03',
  'T05',
  'O07',
]);
const available = <T>(value: T): Reading<T> => Object.freeze({ available: true, value });
const unavailable = (reason: UnavailableReason): Reading<never> =>
  Object.freeze({ available: false, reason });
const modeProfiles = new Map<
  OperatingMode,
  {
    wire: string;
    target: string;
    minimumCelsius: number;
    maximumCelsius: number;
    stepCelsius: number;
  }
>([
  ['heat', { wire: '1', target: 'R02', minimumCelsius: 15, maximumCelsius: 40, stepCelsius: 0.5 }],
  ['cool', { wire: '0', target: 'R01', minimumCelsius: 8, maximumCelsius: 35, stepCelsius: 0.5 }],
  ['auto', { wire: '2', target: 'R03', minimumCelsius: 8, maximumCelsius: 40, stepCelsius: 0.5 }],
]);
export function isOperatingMode(value: unknown): value is OperatingMode {
  return typeof value === 'string' && modeProfiles.has(value as OperatingMode);
}

/** Absolute writes for the observed profile; targets are bound to a selected mode. */
export function encodeCommand(
  device: Device,
  command: DeviceCommand,
): { protocolCode: string; value: string } {
  if (device.profile !== 'boost-i-hp40') throw new DeviceError('unsupported');
  if (command.kind === 'target-state') {
    const state: unknown = command.state;
    if (state === 'off' || isOperatingMode(state))
      return { protocolCode: 'Power', value: state === 'off' ? '0' : '1' };
  }
  if (command.kind === 'target-temperature') {
    const value = command.celsius;
    const control = modeProfiles.get(command.mode ?? 'heat');
    if (
      control &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= control.minimumCelsius &&
      value <= control.maximumCelsius &&
      Number.isInteger(value / control.stepCelsius)
    )
      return { protocolCode: control.target, value: String(value) };
  }
  throw new DeviceError('unsupported');
}

/** Mode selection is only used after the gateway has established that power is Off. */
export function encodeMode(
  device: Device,
  mode: OperatingMode,
): { protocolCode: string; value: string } {
  const profile = modeProfiles.get(mode);
  if (device.profile !== 'boost-i-hp40' || !profile) throw new DeviceError('unsupported');
  return { protocolCode: 'Mode', value: profile.wire };
}

export class DeviceError extends Error {
  constructor(readonly category: 'invalid-response' | 'unsupported' | 'unverified') {
    super(
      {
        'invalid-response': 'Device data does not match the supported protocol.',
        unsupported: 'This device does not have a supported profile for the requested operation.',
        unverified: 'The device contract for this operation has not been verified.',
      }[category],
    );
    this.name = 'DeviceError';
  }
}

function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value
  );
}

/** Account-scoped deviceId/shareId and names are deliberately excluded from identity. */
export function discoverDevices(
  owned: unknown,
  shared: unknown,
): { devices: Device[]; rejectedRecords: number } {
  if (!Array.isArray(owned) || !Array.isArray(shared) || owned.length + shared.length > 10_000) {
    throw new DeviceError('invalid-response');
  }
  const devices = new Map<string, Device>();
  let rejectedRecords = 0;
  const lists: [unknown[], 'owned' | 'shared'][] = [
    [owned, 'owned'],
    [shared, 'shared'],
  ];
  for (const [list, source] of lists) {
    for (const value of list) {
      if (!isRecord(value)) {
        rejectedRecords += 1;
        continue;
      }
      const id: unknown = value.deviceCode ?? value.device_code;
      if (
        !identifier(id) ||
        ('deviceCode' in value && 'device_code' in value && value.deviceCode !== value.device_code)
      ) {
        rejectedRecords += 1;
        continue;
      }
      const profile =
        value.model === 'PASRW040-P-BP4II-C' && value.custModel === 'BOOSTi-INV-HP-40'
          ? 'boost-i-hp40'
          : 'unknown';
      const previous = devices.get(id);
      devices.set(
        id,
        Object.freeze({
          id,
          profile: previous && previous.profile !== profile ? 'unknown' : profile,
          sources: Object.freeze([...new Set([...(previous?.sources ?? []), source])]),
        }),
      );
    }
  }
  return { devices: [...devices.values()], rejectedRecords };
}

function decimal(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function parameters(input: unknown): Map<string, unknown> {
  if (!Array.isArray(input) || input.length > 1024) throw new DeviceError('invalid-response');
  const result = new Map<string, unknown>();
  for (const value of input) {
    // Unidentifiable optional rows cannot invalidate unrelated, explicitly requested fields.
    if (!isRecord(value) || !identifier(value.code)) continue;
    // Duplicate selectors cannot establish which value is current, even if equal.
    result.set(value.code, result.has(value.code) ? null : value);
  }
  return result;
}

function temperature(
  values: Map<string, unknown>,
  code: string,
  enforceRange = true,
): Reading<number> {
  if (!values.has(code)) return unavailable('missing');
  const field = values.get(code);
  if (!isRecord(field) || field.dataType !== 'TEMP') return unavailable('invalid');
  const value = decimal(field.value);
  if (value === undefined || value < -273.15) return unavailable('invalid');
  const lower = decimal(field.rangeStart);
  const upper = decimal(field.rangeEnd);
  if (
    enforceRange &&
    ((field.rangeStart !== undefined && field.rangeStart !== '') ||
      (field.rangeEnd !== undefined && field.rangeEnd !== ''))
  ) {
    if (
      lower === undefined ||
      upper === undefined ||
      lower > upper ||
      value < lower ||
      value > upper
    )
      return unavailable('invalid');
  }
  return available(value);
}

function enumeration(values: Map<string, unknown>, code: string): Reading<string> {
  if (!values.has(code)) return unavailable('missing');
  const field = values.get(code);
  if (!isRecord(field) || field.dataType !== 'ENUM' || !identifier(field.value))
    return unavailable('invalid');
  return available(field.value);
}

/** Local acquisition time is explicit; no measurement timestamp was established by discovery. */
export function normalizeReadings(
  device: Device,
  status: unknown,
  input: unknown,
  observedAtMs: number,
): DeviceReadings {
  if (
    !Number.isFinite(observedAtMs) ||
    observedAtMs < 0 ||
    !isRecord(status) ||
    (status.status !== 'ONLINE' && status.status !== 'OFFLINE')
  )
    throw new DeviceError('invalid-response');
  const connectivity = status.status === 'ONLINE' ? 'online' : 'offline';
  const blocked = unavailable(connectivity === 'offline' ? 'offline' : 'unsupported');
  const empty: DeviceReadings = {
    observedAtMs,
    measuredAtMs: null,
    connectivity,
    waterCelsius: blocked,
    outletCelsius: blocked,
    ambientCelsius: blocked,
    reportedTargetCelsius: blocked,
    power: blocked,
    mode: blocked,
    fault: blocked,
    activity: blocked,
    control: unavailable(device.profile === 'unknown' ? 'unsupported' : 'unverified'),
  };
  if (connectivity === 'offline' || device.profile === 'unknown') return Object.freeze(empty);
  const values = parameters(input);
  const rawPower = enumeration(values, 'Power');
  const power: Reading<'on' | 'off'> = !rawPower.available
    ? rawPower
    : rawPower.value === '0'
      ? available('off')
      : rawPower.value === '1'
        ? available('on')
        : unavailable('unsupported');
  const rawMode = enumeration(values, 'Mode');
  const selected = rawMode.available
    ? [...modeProfiles].find(([, profile]) => profile.wire === rawMode.value)?.[0]
    : undefined;
  const mode: Reading<OperatingMode> = !rawMode.available
    ? rawMode
    : selected
      ? available(selected)
      : unavailable('unsupported');
  // The app retains one target per mode; Set_Temp can lag behind those fields.
  // Report out-of-range stored targets faithfully; write constraints are separate.
  const profile = mode.available ? modeProfiles.get(mode.value) : undefined;
  const control = profile && {
    minimumCelsius: profile.minimumCelsius,
    maximumCelsius: profile.maximumCelsius,
    stepCelsius: profile.stepCelsius,
  };
  const reportedTargetCelsius = profile
    ? temperature(values, profile.target, false)
    : unavailable('unsupported');
  const rawFault: unknown = status.isFault ?? status.is_fault;
  const fault =
    typeof rawFault !== 'boolean'
      ? unavailable('missing')
      : 'isFault' in status && 'is_fault' in status && status.isFault !== status.is_fault
        ? unavailable('conflict')
        : available(rawFault);
  const frequency = values.get('O07');
  // Zero corroborates the observed inactive baseline. Positive frequency cannot
  // distinguish useful heating from defrost/protection, so remains unavailable.
  const stopped =
    isRecord(frequency) &&
    (frequency.dataType == null || frequency.dataType === 'DIGI1') &&
    decimal(frequency.value) === 0;
  return Object.freeze({
    ...empty,
    waterCelsius: temperature(values, 'T02'),
    outletCelsius: temperature(values, 'T03'),
    ambientCelsius: temperature(values, 'T05'),
    reportedTargetCelsius,
    power,
    mode,
    fault,
    activity:
      mode.available && power.available && fault.available && !fault.value && stopped
        ? available('idle' as const)
        : unavailable('unverified'),
    control:
      mode.available &&
      control &&
      power.available &&
      reportedTargetCelsius.available &&
      reportedTargetCelsius.value >= control.minimumCelsius &&
      reportedTargetCelsius.value <= control.maximumCelsius &&
      Number.isInteger(reportedTargetCelsius.value / control.stepCelsius)
        ? available(control)
        : unavailable('unsupported'),
  });
}
