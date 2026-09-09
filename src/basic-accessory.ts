import type { API, Characteristic, PlatformAccessory } from 'homebridge';
import type { AccountCoordinator } from './coordinator.js';

export type BasicRole = 'inlet' | 'outlet' | 'ambient';
const fields = {
  inlet: 'waterCelsius',
  outlet: 'outletCelsius',
  ambient: 'ambientCelsius',
} as const;

/** Independent read-only temperature sensors share the coordinator polling session. */
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
    this.#coordinator = coordinator;
    this.#id = id;
    this.#role = role;
    const serviceType = hap.Service.TemperatureSensor;
    const service =
      accessory.getService(serviceType) ?? accessory.addService(serviceType, accessory.displayName);
    this.#characteristic = service.getCharacteristic(hap.Characteristic.CurrentTemperature);
    this.#characteristic.onGet(() => this.read());
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

  private read(): number {
    const state = this.#closed ? undefined : this.#coordinator?.state(this.#id);
    if (
      !state ||
      state.status !== 'healthy' ||
      state.device.profile !== 'boost-i-hp40' ||
      state.readings?.connectivity !== 'online'
    )
      throw this.unavailable();
    const reading = state.readings[fields[this.#role]];
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
