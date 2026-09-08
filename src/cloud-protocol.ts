import { CloudError, isRecord } from './cloud-error.js';

export interface Credentials {
  username: string;
  password: string;
}
export interface Session {
  token: string;
  userId: string;
  appId: string;
}
export interface Command {
  deviceCode: string;
  protocolCode: string;
  value: string;
}
export type ReadRequest =
  | { kind: 'owned' }
  | { kind: 'shared'; page: number }
  | { kind: 'status'; deviceCode: string }
  | { kind: 'telemetry'; deviceCode: string; codes: string[] };

const vendorOrigin = 'https://cloud.linked-go.com:449';
export function originFor(value = vendorOrigin): string {
  try {
    const url = new URL(value);
    if (
      value !== url.origin ||
      (value !== vendorOrigin &&
        !(
          ['http:', 'https:'].includes(url.protocol) &&
          ['127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error();
    return value;
  } catch {
    throw new CloudError('invalid-request');
  }
}

function text(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

export function credentialsFor(value: Credentials): Credentials {
  if (!isRecord(value) || !text(value.username, 320) || !text(value.password, 4096))
    throw new CloudError('invalid-request');
  return { username: value.username, password: value.password };
}

export function sessionFrom(value: unknown): Session {
  if (
    !isRecord(value) ||
    !text(value['x-token'], 8192) ||
    !/^[\x21-\x7e]+$/.test(value['x-token']) ||
    !text(value.userId) ||
    !text(value.appId) ||
    ('user_id' in value && value.user_id !== value.userId)
  ) {
    throw new CloudError('invalid-response');
  }
  return { token: value['x-token'], userId: value.userId, appId: value.appId };
}

/** Wire shape only: device-profile semantics and result validation belong to issue #5. */
export function readCall(
  request: ReadRequest,
  identity: { userId: string; appId: string },
): { path: string; body: Record<string, unknown> } {
  if (!isRecord(request)) throw new CloudError('invalid-request');
  const prefix = '/crmservice/api/app/device/';
  switch (request.kind) {
    case 'owned':
      return { path: prefix + 'deviceList', body: identity };
    case 'shared':
      if (!Number.isSafeInteger(request.page) || request.page < 1) break;
      return {
        path: prefix + 'getMyAppectDeviceShareDataList',
        body: {
          toUser: identity.userId,
          appId: identity.appId,
          pageIndex: request.page,
          pageSize: 100,
        },
      };
    case 'status':
      if (!text(request.deviceCode)) break;
      return {
        path: prefix + 'getDeviceStatus',
        body: { ...identity, deviceCode: request.deviceCode },
      };
    case 'telemetry':
      if (
        !text(request.deviceCode) ||
        !Array.isArray(request.codes) ||
        request.codes.length < 1 ||
        request.codes.length > 128 ||
        !request.codes.every((code) => text(code))
      )
        break;
      return {
        path: prefix + 'getDataByCode',
        body: { ...identity, deviceCode: request.deviceCode, protocalCodes: [...request.codes] },
      };
  }
  throw new CloudError('invalid-request');
}

export function commandBody(commands: Command[]): { param: Command[] } {
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 32)
    throw new CloudError('invalid-request');
  return {
    param: commands.map((command) => {
      if (
        !isRecord(command) ||
        !text(command.deviceCode) ||
        !text(command.protocolCode) ||
        !text(command.value, 128)
      ) {
        throw new CloudError('invalid-request');
      }
      return {
        deviceCode: command.deviceCode,
        protocolCode: command.protocolCode,
        value: command.value,
      };
    }),
  };
}
