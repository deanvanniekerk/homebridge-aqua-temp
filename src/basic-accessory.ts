import type { API, Characteristic, PlatformAccessory } from 'homebridge';
import type { AccountCoordinator } from './coordinator.js';
import { CloudError } from './cloud-error.js';
import { CommandError } from './command-queue.js';

export type BasicRole = 'power' | 'water';

/** Independent HAP accessories keep verified capabilities usable when the thermostat fails. */
export class BasicAccessory {
  readonly #hap: API['hap'];
  readonly #coordinator: AccountCoordinator | undefined;
  readonly #id: string;
  readonly #role: BasicRole;
  readonly #characteristic: Characteristic;
  #closed = false;

  constructor(
    hap: API['hap'],
    accessory: PlatformAccessory<Record<string, unknown>>,
    coordinator: AccountCoordinator | undefined,
    id: string,
    role: BasicRole,
  ) {
    this.#hap = hap;
    const {
      HAPStatus: { INVALID_VALUE_IN_REQUEST, OPERATION_TIMED_OUT, RESOURCE_BUSY },
    } = hap;
    this.#coordinator = coordinator;
    this.#id = id;
    this.#role = role;
    const serviceType = role === 'power' ? hap.Service.Switch : hap.Service.TemperatureSensor;
    const service =
      accessory.getService(serviceType) ?? accessory.addService(serviceType, accessory.displayName);
    this.#characteristic = service.getCharacteristic(
      role === 'power' ? hap.Characteristic.On : hap.Characteristic.CurrentTemperature,
    );
    this.#characteristic.onGet(() => this.read());
    if (role === 'power')
      this.#characteristic.onSet(async (value) => {
        if (typeof value !== 'boolean') throw new hap.HapStatusError(INVALID_VALUE_IN_REQUEST);
        try {
          this.read();
          if (!this.#coordinator) throw this.unavailable();
          const mode = this.#coordinator.state(id)?.readings?.mode;
          if (value && !mode?.available) throw this.unavailable();
          // Preserve the observed mode; a later app change must fail preflight, not change it back.
          await this.#coordinator.command(id, {
            kind: 'target-state',
            state: value && mode?.available ? mode.value : 'off',
          });
        } catch (error) {
          if (error instanceof CloudError && error.category === 'timeout')
            throw new hap.HapStatusError(OPERATION_TIMED_OUT);
          if (error instanceof CommandError && error.category === 'busy')
            throw new hap.HapStatusError(RESOURCE_BUSY);
          throw this.unavailable();
        }
      });
    this.update();
  }

  update(): void {
    try {
      this.#characteristic.updateValue(this.read());
    } catch {
      this.#characteristic.updateValue(this.unavailable());
    }
  }

  close(): void {
    this.#closed = true;
    this.update();
  }

  private read(): boolean | number {
    const state = this.#closed ? undefined : this.#coordinator?.state(this.#id);
    if (
      !state ||
      state.status !== 'healthy' ||
      state.device.profile !== 'boost-i-hp40' ||
      state.readings?.connectivity !== 'online'
    )
      throw this.unavailable();
    if (this.#role === 'power') {
      if (!state.readings.power.available) throw this.unavailable();
      return state.readings.power.value === 'on';
    }
    const reading = state.readings.waterCelsius;
    if (!reading.available) throw this.unavailable();
    const value = reading.value;
    const { minValue, maxValue, minStep } = this.#characteristic.props;
    if (
      !Number.isFinite(value) ||
      minValue === undefined ||
      maxValue === undefined ||
      minStep === undefined ||
      value < minValue ||
      value > maxValue ||
      Math.abs((value - minValue) / minStep - Math.round((value - minValue) / minStep)) > 1e-8
    )
      throw this.unavailable();
    return value;
  }

  private unavailable() {
    const hap = this.#hap;
    const {
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE },
    } = hap;
    return new hap.HapStatusError(SERVICE_COMMUNICATION_FAILURE);
  }
}
