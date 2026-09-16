import { readFileSync } from 'node:fs';
import { isRecord } from './cloud-error.js';

export const PLUGIN_NAME = 'homebridge-aqua-temp-connect';
export const PLATFORM_NAME = 'AquaTemp';
// This private UUID seed intentionally survives public npm package renames.
export const ACCESSORY_NAMESPACE = '@deanvanniekerk/homebridge-aqua-temp';

/** Read the installed package metadata; diagnostics validates the public version format. */
export function pluginVersion(): string {
  try {
    const metadata: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    return isRecord(metadata) && typeof metadata.version === 'string'
      ? metadata.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
