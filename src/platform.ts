import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { ConfigurationError, parseConfig, type AquaTempConfig } from './configuration.js';
import { AquaTempClient } from './cloud-client.js';
import { AccountCoordinator, type AccountSnapshot } from './coordinator.js';
import { AquaTempGateway } from './gateway.js';
import { Thermostat } from './thermostat.js';
import { PLATFORM_NAME, PLUGIN_NAME, pluginVersion } from './settings.js';
import { Diagnostics } from './diagnostics.js';
import { isRecord } from './cloud-error.js';

type Accessory = PlatformAccessory<Record<string, unknown>>;

/** Owns Homebridge lifecycle and stable identity; cloud scheduling belongs to the coordinator. */
export class AquaTempPlatform implements DynamicPlatformPlugin {
  readonly #api: API;
  readonly #log: Logger;
  readonly #accessories = new Map<string, { accessory: Accessory; thermostat: Thermostat }>();
  readonly #shutdown = new AbortController();
  readonly #diagnostics: Diagnostics | undefined;
  readonly #config: AquaTempConfig | undefined;
  readonly #coordinator: AccountCoordinator | undefined;
  #started = false;

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.#api = api;
    this.#log = log;
    api.on('shutdown', () => {
      this.#shutdown.abort();
      this.#coordinator?.close();
      for (const entry of this.#accessories.values()) entry.thermostat.close();
      this.#accessories.clear();
    });
    try {
      this.#config = parseConfig(config);
      this.#diagnostics = new Diagnostics(
        (message) => {
          log.info(message);
        },
        {
          pluginVersion: pluginVersion(),
          homebridgeVersion: api.serverVersion,
          debug: this.#config.debug,
        },
      );
      this.#coordinator = new AccountCoordinator(
        new AquaTempGateway(new AquaTempClient(this.#config)),
        { intervalMs: this.#config.pollInterval * 1000 },
      );
    } catch (error) {
      const message =
        error instanceof ConfigurationError ? error.message : 'Unable to initialize the platform.';
      log.error(`Configuration rejected: ${message}`);
      return;
    }
    api.on('didFinishLaunching', () => {
      if (this.#started || this.#shutdown.signal.aborted) return;
      this.#started = true;
      void this.consume();
    });
  }

  configureAccessory(accessory: Accessory): void {
    if (this.#shutdown.signal.aborted || this.#accessories.has(accessory.UUID)) return;
    // Persist identity and local display preferences only, never telemetry or account credentials.
    const context: unknown = accessory.context;
    const id = isRecord(context) && typeof context.deviceId === 'string' ? context.deviceId : '';
    const units = isRecord(context) && context.displayUnits === 1 ? 1 : 0;
    accessory.context = { deviceId: id, displayUnits: units };
    this.#accessories.set(accessory.UUID, {
      accessory,
      thermostat: new Thermostat(
        this.#api.hap,
        accessory,
        this.#coordinator,
        id && this.uuid(id) === accessory.UUID ? id : '',
        () => {
          this.#api.updatePlatformAccessories([accessory]);
        },
      ),
    });
  }

  private uuid(id: string): string {
    return this.#api.hap.uuid.generate(`${PLUGIN_NAME}:device:${id}`);
  }

  private selected(id: string): boolean {
    return (
      this.#config !== undefined &&
      (this.#config.deviceIds.length === 0 || this.#config.deviceIds.includes(id))
    );
  }

  private removeExcluded(): void {
    if (!this.#config || this.#config.deviceIds.length === 0) return;
    for (const [uuid, entry] of this.#accessories) {
      const id = entry.accessory.context.deviceId;
      if (typeof id !== 'string' || !id || this.uuid(id) !== uuid || this.selected(id)) continue;
      this.#api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [entry.accessory]);
      entry.thermostat.close();
      this.#accessories.delete(uuid);
    }
  }

  private async consume(): Promise<void> {
    try {
      if (!this.#coordinator) return;
      this.removeExcluded();
      this.#coordinator.start();
      this.#log.info('Aqua Temp monitoring started.');
      for await (const snapshot of this.#coordinator.updates(this.#shutdown.signal))
        this.synchronize(snapshot);
    } catch {
      if (!this.#shutdown.signal.aborted) {
        this.#log.error('Accessory updates stopped unexpectedly. Restart the platform to retry.');
        this.#shutdown.abort();
        this.#coordinator?.close();
        for (const entry of this.#accessories.values()) entry.thermostat.close();
      }
    }
  }

  private synchronize(snapshot: AccountSnapshot): void {
    this.#diagnostics?.observe(snapshot);
    for (const state of snapshot.devices) {
      if (!this.selected(state.device.id) || state.device.profile !== 'boost-i-hp40') continue;
      const uuid = this.uuid(state.device.id);
      if (this.#accessories.has(uuid)) continue;
      const accessory = new this.#api.platformAccessory(this.#config?.name ?? 'Aqua Temp', uuid);
      accessory.context = { deviceId: state.device.id };
      const C = this.#api.hap.Characteristic;
      accessory
        .getService(this.#api.hap.Service.AccessoryInformation)
        ?.setCharacteristic(C.Manufacturer, 'AstralPool / Fluidra')
        .setCharacteristic(C.Model, 'BOOSTi-INV-HP-40')
        .setCharacteristic(C.SerialNumber, uuid);
      this.configureAccessory(accessory);
      this.#api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    // Cached accessories omitted by discovery remain present and unavailable until refreshed.
    for (const entry of this.#accessories.values()) entry.thermostat.update();
  }
}
