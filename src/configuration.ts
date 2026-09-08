import { isRecord } from './cloud-error.js';

export interface AquaTempConfig {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly deviceIds: readonly string[];
  readonly pollInterval: number;
  readonly debug: boolean;
}

type Field =
  'configuration' | 'name' | 'username' | 'password' | 'deviceIds' | 'pollInterval' | 'debug';
const messages: Record<Field, string> = {
  configuration: 'Configuration must be an object.',
  name: 'Name must contain 1–64 characters without leading/trailing whitespace or line breaks.',
  username: 'Enter an Aqua Temp username with 1–320 characters and no surrounding whitespace.',
  password: 'Enter a nonblank Aqua Temp password of at most 4096 characters.',
  deviceIds: 'Device IDs must be a list of up to 100 unique, nonblank IDs (256 characters each).',
  pollInterval: 'Poll interval must be a whole number from 30 to 300 seconds.',
  debug: 'Debug must be true or false.',
};
export class ConfigurationError extends Error {
  constructor(readonly field: Field) {
    super(messages[field]);
    this.name = 'ConfigurationError';
  }
}

function cleanText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length <= maximum &&
    /^\S(?:[^\r\n]*\S)?$/.test(value)
  );
}

/** Reject before constructing a cloud client; never include rejected values or unknown keys in errors. */
export function parseConfig(input: unknown): AquaTempConfig {
  if (!isRecord(input)) throw new ConfigurationError('configuration');
  const name: unknown = input.name === undefined ? 'Aqua Temp' : input.name;
  if (!cleanText(name, 64)) throw new ConfigurationError('name');
  if (!cleanText(input.username, 320)) throw new ConfigurationError('username');
  if (
    typeof input.password !== 'string' ||
    Array.from(input.password).length > 4096 ||
    !/\S/.test(input.password)
  )
    throw new ConfigurationError('password');
  const deviceIds: unknown = input.deviceIds === undefined ? [] : input.deviceIds;
  if (
    !Array.isArray(deviceIds) ||
    deviceIds.length > 100 ||
    !deviceIds.every((id: unknown) => cleanText(id, 256)) ||
    new Set(deviceIds).size !== deviceIds.length
  )
    throw new ConfigurationError('deviceIds');
  const pollInterval: unknown = input.pollInterval === undefined ? 60 : input.pollInterval;
  if (
    typeof pollInterval !== 'number' ||
    !Number.isInteger(pollInterval) ||
    pollInterval < 30 ||
    pollInterval > 300
  )
    throw new ConfigurationError('pollInterval');
  const debug: unknown = input.debug === undefined ? false : input.debug;
  if (typeof debug !== 'boolean') throw new ConfigurationError('debug');
  return Object.freeze({
    name,
    username: input.username,
    password: input.password,
    deviceIds: Object.freeze(
      deviceIds.filter((id: unknown): id is string => typeof id === 'string'),
    ),
    pollInterval,
    debug,
  });
}
