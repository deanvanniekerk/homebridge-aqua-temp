import { readFileSync } from 'node:fs';
import { isRecord } from './cloud-error.js';

export const PLUGIN_NAME = '@deanvniekerk/homebridge-aqua-temp-connect';
export const PLATFORM_NAME = 'AquaTemp';
// Freeze the original identity namespace across package renames.
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
