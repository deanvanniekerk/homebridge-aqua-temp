import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

/** Lifecycle boundary only. Device discovery and controls await verified implementations. */
export class AquaTempPlatform implements DynamicPlatformPlugin {
  readonly hap: API['hap'];
  private readonly accessories = new Map<string, PlatformAccessory>();

  constructor(log: Logger, _config: PlatformConfig, api: API) {
    this.hap = api.hap;
    api.on('didFinishLaunching', () => {
      log.warn(
        'Foundation build: device integration is not implemented. No heat pump controls are available.',
      );
    });
    api.on('shutdown', () => {
      // Drop references only; never unregister or delete Homebridge's persisted accessories.
      this.accessories.clear();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }
}
