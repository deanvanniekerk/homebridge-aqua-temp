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
import { BasicAccessory, type BasicRole } from './basic-accessory.js';
import { PLATFORM_NAME, PLUGIN_NAME, pluginVersion } from './settings.js';
import { Diagnostics } from './diagnostics.js';
import { isRecord } from './cloud-error.js';

type Role = 'thermostat' | BasicRole;
type Accessory = PlatformAccessory<Record<string, unknown>>;

/** Owns Homebridge lifecycle and stable identity; cloud scheduling belongs to the coordinator. */
export class AquaTempPlatform implements DynamicPlatformPlugin {
  readonly #api: API;
  readonly #log: Logger;
  readonly #accessories = new Map<
    string,
    { accessory: Accessory; presentation: Thermostat | BasicAccessory }
  >();
  readonly #shutdown = new AbortController();
  readonly #diagnostics: Diagnostics | undefined;
  readonly #config: AquaTempConfig | undefined;
  readonly #coordinator: AccountCoordinator | undefined;
  #started = false;
  readonly #presentationFailures = new Set<string>();

  constructor(log: Logger, config: PlatformConfig, api: API) {
    this.#api = api;
    this.#log = log;
    api.on('shutdown', () => {
      this.#shutdown.abort();
      this.#coordinator?.close();
      for (const entry of this.#accessories.values()) entry.presentation.close();
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
    const role: Role =
      isRecord(context) && (context.role === 'power' || context.role === 'water')
        ? context.role
        : 'thermostat';
    accessory.context = {
      deviceId: id,
      displayUnits: units,
      ...(role === 'thermostat' ? {} : { role }),
    };
    const verifiedId = id && this.uuid(id, role) === accessory.UUID ? id : '';
    const presentation =
      role === 'thermostat'
        ? new Thermostat(this.#api.hap, accessory, this.#coordinator, verifiedId, () => {
            this.#api.updatePlatformAccessories([accessory]);
          })
        : new BasicAccessory(this.#api.hap, accessory, this.#coordinator, verifiedId, role);
    this.#accessories.set(accessory.UUID, { accessory, presentation });
  }

  private uuid(id: string, role: Role = 'thermostat'): string {
    const suffix = role === 'thermostat' ? '' : `:${role}`;
    return this.#api.hap.uuid.generate(`${PLUGIN_NAME}:device:${id}${suffix}`);
  }

  private selected(id: string): boolean {
    return (
      this.#config !== undefined &&
      (this.#config.deviceIds.length === 0 || this.#config.deviceIds.includes(id))
    );
  }

  private enabled(role: Role): boolean {
    return (
      role === 'thermostat' ||
      (role === 'power' && this.#config?.includePowerSwitch === true) ||
      (role === 'water' && this.#config?.includeWaterTemperatureSensor === true)
    );
  }

  private removeExcluded(): void {
    if (!this.#config) return;
    for (const [uuid, entry] of this.#accessories) {
      const id = entry.accessory.context.deviceId;
      const role = entry.accessory.context.role;
      const kind = role === 'power' || role === 'water' ? role : 'thermostat';
      if (typeof id !== 'string' || !id || this.uuid(id, kind) !== uuid) continue;
      if (this.selected(id) && this.enabled(kind)) continue;
      this.#api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [entry.accessory]);
      entry.presentation.close();
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
        for (const entry of this.#accessories.values()) entry.presentation.close();
      }
    }
  }

  private synchronize(snapshot: AccountSnapshot): void {
    this.#diagnostics?.observe(snapshot);
    for (const state of snapshot.devices) {
      if (!this.selected(state.device.id) || state.device.profile !== 'boost-i-hp40') continue;
      for (const role of ['thermostat', 'power', 'water'] as const) {
        if (!this.enabled(role)) continue;
        const uuid = this.uuid(state.device.id, role);
        if (this.#accessories.has(uuid)) continue;
        try {
          const suffix = role === 'power' ? ' Power' : role === 'water' ? ' Water Temperature' : '';
          const accessory = new this.#api.platformAccessory(
            `${this.#config?.name ?? 'Aqua Temp'}${suffix}`,
            uuid,
          );
          accessory.context = {
            deviceId: state.device.id,
            ...(role === 'thermostat' ? {} : { role }),
          };
          const C = this.#api.hap.Characteristic;
          accessory
            .getService(this.#api.hap.Service.AccessoryInformation)
            ?.setCharacteristic(C.Manufacturer, 'AstralPool / Fluidra')
            .setCharacteristic(C.Model, 'BOOSTi-INV-HP-40')
            .setCharacteristic(C.SerialNumber, uuid);
          this.configureAccessory(accessory);
          this.#api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.#presentationFailures.delete(uuid);
        } catch {
          const entry = this.#accessories.get(uuid);
          if (entry) {
            // Homebridge inserts into its cache before attaching to HAP. Remove the
            // exact attempted object so retry cannot be silently skipped as a duplicate.
            try {
              this.#api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
                entry.accessory,
              ]);
            } catch {
              /* The host removes the cache entry even if HAP attachment never happened. */
            }
          }
          try {
            entry?.presentation.close();
          } catch {
            /* A failed capability must not stop siblings. */
          }
          this.#accessories.delete(uuid);
          this.presentationFailed(uuid);
        }
      }
    }
    // Cached accessories omitted by discovery remain present and unavailable until refreshed.
    for (const [uuid, entry] of this.#accessories) {
      try {
        entry.presentation.update();
        this.#presentationFailures.delete(uuid);
      } catch {
        this.presentationFailed(uuid);
      }
    }
  }
  private presentationFailed(uuid: string): void {
    if (this.#presentationFailures.has(uuid)) return;
    this.#presentationFailures.add(uuid);
    this.#log.warn(
      'Accessory capability temporarily unavailable; other capabilities continue. Retrying on the next update.',
    );
  }
}
