import type { API, Characteristic, PlatformAccessory } from 'homebridge';
import type { AccountCoordinator } from './coordinator.js';
import type { DeviceCommand, Reading } from './device-model.js';
import { CloudError } from './cloud-error.js';
import { CommandError } from './command-queue.js';

type Range = { minValue: number; maxValue: number; minStep: number };

function onGrid(value: number, origin: number, step: number): boolean {
  const ticks = (value - origin) / step;
  return Number.isFinite(ticks) && Math.abs(ticks - Math.round(ticks)) < 1e-8;
}

/** HAP presentation only: all freshness, commands and vendor interpretation belong upstream. */
export class Thermostat {
  readonly #hap: API['hap'];
  readonly #status;
  readonly #accessory: PlatformAccessory<Record<string, unknown>>;
  readonly #coordinator: AccountCoordinator | undefined;
  readonly #id: string;
  readonly #bindings: { characteristic: Characteristic; read: () => number }[] = [];
  readonly #target: Characteristic;
  readonly #targetState: Characteristic;
  readonly #hapTargetRange: Range;
  readonly #pairedWrite: Characteristic['props']['perms'][number];
  readonly #targetPermissions: Characteristic['props']['perms'];
  #closed = false;

  constructor(
    hap: API['hap'],
    accessory: PlatformAccessory<Record<string, unknown>>,
    coordinator: AccountCoordinator | undefined,
    id: string,
    save: () => void,
  ) {
    this.#hap = hap;
    const {
      HAPStatus: {
        SERVICE_COMMUNICATION_FAILURE,
        INVALID_VALUE_IN_REQUEST,
        OPERATION_TIMED_OUT,
        RESOURCE_BUSY,
      },
    } = hap;
    this.#status = {
      unavailable: SERVICE_COMMUNICATION_FAILURE,
      invalid: INVALID_VALUE_IN_REQUEST,
      timeout: OPERATION_TIMED_OUT,
      busy: RESOURCE_BUSY,
    };
    this.#accessory = accessory;
    this.#coordinator = coordinator;
    this.#id = id;
    const C = hap.Characteristic;
    const {
      Perms: { PAIRED_WRITE },
    } = hap;
    this.#pairedWrite = PAIRED_WRITE;
    const service =
      accessory.getService(hap.Service.Thermostat) ??
      accessory.addService(hap.Service.Thermostat, accessory.displayName);
    const defaults = new C.TargetTemperature().props;
    this.#targetPermissions = [...defaults.perms];
    // The supported HAP runtime defines these bounds. A changed runtime must fail closed.
    if (
      defaults.minValue === undefined ||
      defaults.maxValue === undefined ||
      defaults.minStep === undefined
    )
      throw new Error('HAP target-temperature constraints are unavailable.');
    this.#hapTargetRange = {
      minValue: defaults.minValue,
      maxValue: defaults.maxValue,
      minStep: defaults.minStep,
    };
    const current = service.getCharacteristic(C.CurrentTemperature);
    this.bind(current, () => {
      const value = this.value(this.readings().waterCelsius);
      const { minValue, maxValue, minStep } = current.props;
      if (
        minValue === undefined ||
        maxValue === undefined ||
        minStep === undefined ||
        value < minValue ||
        value > maxValue ||
        !onGrid(value, minValue, minStep)
      )
        throw this.unavailable();
      return value;
    });
    this.#target = service.getCharacteristic(C.TargetTemperature);
    this.bind(this.#target, () => {
      const value = this.value(this.readings().reportedTargetCelsius);
      const range = this.range();
      if (!range || !this.includes(range, value)) throw this.unavailable();
      return value;
    });
    this.#target.onSet(async (value) => {
      const range = this.range();
      if (!range) throw this.unavailable();
      if (typeof value !== 'number' || !this.includes(range, value)) throw this.invalid();
      await this.command({ kind: 'target-temperature', celsius: value });
    });
    this.#targetState = service.getCharacteristic(C.TargetHeatingCoolingState).setProps({
      perms: [...new C.TargetHeatingCoolingState().props.perms],
      validValues: [C.TargetHeatingCoolingState.OFF, C.TargetHeatingCoolingState.HEAT],
    });
    this.bind(this.#targetState, () => {
      const readings = this.readings();
      if (this.value(readings.power) === 'off') return C.TargetHeatingCoolingState.OFF;
      if (this.value(readings.mode) !== 'heat') throw this.unavailable();
      return C.TargetHeatingCoolingState.HEAT;
    });
    this.#targetState.onSet(async (value) => {
      if (value !== C.TargetHeatingCoolingState.OFF && value !== C.TargetHeatingCoolingState.HEAT)
        throw this.invalid();
      if (value !== C.TargetHeatingCoolingState.OFF && !this.range()) throw this.unavailable();
      await this.command({
        kind: 'target-state',
        state: value === C.TargetHeatingCoolingState.OFF ? 'off' : 'heat',
      });
    });
    this.bind(service.getCharacteristic(C.CurrentHeatingCoolingState), () => {
      const readings = this.readings();
      if (readings.fault.available && readings.fault.value) throw this.unavailable();
      const activity = this.value(readings.activity);
      if (activity === 'idle') return C.CurrentHeatingCoolingState.OFF;
      if (activity === 'heating' && this.value(readings.power) === 'on') {
        if (this.value(readings.mode) !== 'heat') throw this.unavailable();
        return C.CurrentHeatingCoolingState.HEAT;
      }
      throw this.unavailable();
    });
    const units = service.getCharacteristic(C.TemperatureDisplayUnits);
    this.bind(units, () =>
      accessory.context.displayUnits === C.TemperatureDisplayUnits.FAHRENHEIT
        ? C.TemperatureDisplayUnits.FAHRENHEIT
        : C.TemperatureDisplayUnits.CELSIUS,
    );
    units.onSet((value) => {
      if (this.#closed) throw this.unavailable();
      if (
        value !== C.TemperatureDisplayUnits.CELSIUS &&
        value !== C.TemperatureDisplayUnits.FAHRENHEIT
      )
        throw this.invalid();
      this.#accessory.context.displayUnits = value;
      save();
    });
    this.update();
  }

  update(): void {
    const range = this.range();
    const perms = this.#targetPermissions.filter(
      (permission) => range || permission !== this.#pairedWrite,
    );
    const { minValue, maxValue, minStep } = this.#target.props;
    if (
      minValue !== range?.minValue ||
      maxValue !== range?.maxValue ||
      minStep !== range?.minStep ||
      this.#target.props.perms.some((permission) => permission === this.#pairedWrite) !==
        Boolean(range)
    ) {
      // Invalidate the old/default value before narrowing bounds: HAP would otherwise
      // clamp it and emit an invented target before we publish the verified reading.
      this.#target.updateValue(this.unavailable());
      this.#target.setProps({
        minValue: range?.minValue ?? null,
        maxValue: range?.maxValue ?? null,
        minStep: range?.minStep ?? null,
        perms,
      });
    }
    for (const { characteristic, read } of this.#bindings) {
      try {
        characteristic.updateValue(read());
      } catch {
        characteristic.updateValue(this.unavailable());
      }
    }
  }

  close(): void {
    this.#closed = true;
    this.update();
  }

  private bind(characteristic: Characteristic, read: () => number): void {
    const guarded = () => {
      if (this.#closed) throw this.unavailable();
      return read();
    };
    characteristic.onGet(guarded);
    this.#bindings.push({ characteristic, read: guarded });
  }

  private readings() {
    const state = this.#closed ? undefined : this.#coordinator?.state(this.#id);
    if (
      !state ||
      state.status !== 'healthy' ||
      state.device.profile !== 'boost-i-hp40' ||
      state.readings?.connectivity !== 'online'
    )
      throw this.unavailable();
    return state.readings;
  }

  private value<T>(reading: Reading<T>): T {
    if (!reading.available) throw this.unavailable();
    return reading.value;
  }

  private range(): Range | undefined {
    let control;
    try {
      control = this.value(this.readings().control);
    } catch {
      return undefined;
    }
    const { minimumCelsius: low, maximumCelsius: high, stepCelsius: step } = control;
    if (![low, high, step].every(Number.isFinite) || low > high || step <= 0) return undefined;
    const hap = this.#hapTargetRange;
    const count = Math.floor((hap.maxValue - hap.minValue) / hap.minStep + 1e-8);
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) return undefined;
    // Enumerate the bounded HAP lattice, intersecting it with the verified device lattice.
    const values: number[] = [];
    for (let index = 0; index <= count; index += 1) {
      const value = Number((hap.minValue + index * hap.minStep).toFixed(8));
      if (value >= low && value <= high && onGrid(value, low, step)) values.push(value);
    }
    const first = values[0],
      second = values[1],
      last = values.at(-1);
    if (first === undefined || second === undefined || last === undefined) return undefined;
    const increment = Number((second - first).toFixed(8));
    if (values.some((value, index) => Math.abs(value - first - index * increment) > 1e-8))
      return undefined;
    return { minValue: first, maxValue: last, minStep: increment };
  }

  private includes(range: Range, value: number): boolean {
    return (
      Number.isFinite(value) &&
      value >= range.minValue &&
      value <= range.maxValue &&
      onGrid(value, range.minValue, range.minStep)
    );
  }

  private async command(command: DeviceCommand): Promise<void> {
    try {
      this.readings();
      if (!this.#coordinator) throw this.unavailable();
      await this.#coordinator.command(this.#id, command);
    } catch (error) {
      if (error instanceof CloudError && error.category === 'timeout')
        throw new this.#hap.HapStatusError(this.#status.timeout);
      if (error instanceof CommandError && error.category === 'busy')
        throw new this.#hap.HapStatusError(this.#status.busy);
      throw this.unavailable();
    }
  }

  private unavailable() {
    const hap = this.#hap;
    return new hap.HapStatusError(this.#status.unavailable);
  }
  private invalid() {
    const hap = this.#hap;
    return new hap.HapStatusError(this.#status.invalid);
  }
}
