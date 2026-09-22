import { z } from 'zod';
import { isRecord } from './cloud/cloud-error.js';

export interface AquaTempConfig {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly deviceIds: readonly string[];
  readonly pollInterval: number;
  readonly debug: boolean;
  readonly includeOutletTemperatureSensor: boolean;
  readonly includeInletTemperatureSensor: boolean;
  readonly includeAmbientTemperatureSensor: boolean;
}

type Field =
  | 'configuration'
  | 'name'
  | 'username'
  | 'password'
  | 'deviceIds'
  | 'pollInterval'
  | 'debug'
  | 'includeOutletTemperatureSensor'
  | 'includeInletTemperatureSensor'
  | 'includeAmbientTemperatureSensor';
const messages: Record<Field, string> = {
  configuration: 'Configuration must be an object.',
  name: 'Name must contain 1–64 characters without leading/trailing whitespace or line breaks.',
  username: 'Enter an Aqua Temp username with 1–320 characters and no surrounding whitespace.',
  password: 'Enter a nonblank Aqua Temp password of at most 4096 characters.',
  deviceIds: 'Device IDs must be a list of up to 100 unique, nonblank IDs (256 characters each).',
  pollInterval: 'Poll interval must be a whole number from 30 to 300 seconds.',
  debug: 'Debug must be true or false.',
  includeOutletTemperatureSensor: 'Include outlet temperature sensor must be true or false.',
  includeInletTemperatureSensor: 'Include inlet temperature sensor must be true or false.',
  includeAmbientTemperatureSensor: 'Include ambient temperature sensor must be true or false.',
};
export class ConfigurationError extends Error {
  constructor(readonly field: Field) {
    super(messages[field]);
    this.name = 'ConfigurationError';
  }
}

const cleanText = (maximum: number) =>
  z
    .string()
    .refine((value) => Array.from(value).length <= maximum && /^\S(?:[^\r\n]*\S)?$/.test(value));

const configSchema = z.object({
  name: cleanText(64).default('Aqua Temp'),
  username: cleanText(320),
  password: z.string().refine((value) => Array.from(value).length <= 4096 && /\S/.test(value)),
  deviceIds: z
    .array(cleanText(256))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
  pollInterval: z.number().int().min(30).max(300).default(60),
  debug: z.boolean().default(false),
  includeOutletTemperatureSensor: z.boolean().default(false),
  includeInletTemperatureSensor: z.boolean().default(false),
  includeAmbientTemperatureSensor: z.boolean().default(false),
});

/** Reject before constructing a cloud client; never include rejected values or unknown keys in errors. */
export function parseConfig(input: unknown): AquaTempConfig {
  if (!isRecord(input)) throw new ConfigurationError('configuration');
  const result = configSchema.safeParse(input);
  if (!result.success) {
    const key = result.error.issues[0]?.path[0];
    throw new ConfigurationError(
      typeof key === 'string' && Object.hasOwn(messages, key) ? (key as Field) : 'configuration',
    );
  }
  const config = result.data;
  return Object.freeze({
    includeAmbientTemperatureSensor: config.includeAmbientTemperatureSensor,
    includeOutletTemperatureSensor: config.includeOutletTemperatureSensor,
    includeInletTemperatureSensor: config.includeInletTemperatureSensor,
    name: config.name,
    username: config.username,
    password: config.password,
    deviceIds: Object.freeze(config.deviceIds),
    pollInterval: config.pollInterval,
    debug: config.debug,
  });
}
