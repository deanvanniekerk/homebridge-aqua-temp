import { z } from 'zod';
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

const text = (maximum = 256) =>
  z.string().refine((value) => value.trim().length > 0 && Array.from(value).length <= maximum);
const credentialsSchema = z.object({ username: text(320), password: text(4096) });
const sessionSchema = z.object({
  'x-token': text(8192).regex(/^[\x21-\x7e]+$/),
  userId: text(),
  appId: text(),
});
// Empty placeholders are used to snapshot requests before authentication completes.
const identitySchema = z.object({ userId: z.string(), appId: z.string() });
const readRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owned') }),
  z.object({
    kind: z.literal('shared'),
    page: z.number().int().min(1).refine(Number.isSafeInteger),
  }),
  z.object({ kind: z.literal('status'), deviceCode: text() }),
  z.object({
    kind: z.literal('telemetry'),
    deviceCode: text(),
    codes: z.array(text()).min(1).max(128),
  }),
]);
const commandSchema = z.object({
  deviceCode: text(),
  protocolCode: text(),
  value: text(128),
});
const commandsSchema = z.array(commandSchema).min(1).max(32);

export function credentialsFor(value: Credentials): Credentials {
  const result = credentialsSchema.safeParse(value);
  if (!result.success) throw new CloudError('invalid-request');
  return result.data;
}

export function sessionFrom(value: unknown): Session {
  const result = sessionSchema.safeParse(value);
  if (
    !result.success ||
    (isRecord(value) && 'user_id' in value && value.user_id !== result.data.userId)
  ) {
    throw new CloudError('invalid-response');
  }
  return { token: result.data['x-token'], userId: result.data.userId, appId: result.data.appId };
}

/** Wire shape only; device-profile semantics and result validation belong to the device layer. */
export function readCall(
  request: ReadRequest,
  identity: { userId: string; appId: string },
): { path: string; body: Record<string, unknown> } {
  const parsedRequest = readRequestSchema.safeParse(request);
  const parsedIdentity = identitySchema.safeParse(identity);
  if (!parsedRequest.success || !parsedIdentity.success) throw new CloudError('invalid-request');
  const safeRequest = parsedRequest.data;
  const safeIdentity = parsedIdentity.data;
  const prefix = '/crmservice/api/app/device/';
  switch (safeRequest.kind) {
    case 'owned':
      return { path: `${prefix}deviceList`, body: safeIdentity };
    case 'shared':
      return {
        path: `${prefix}getMyAppectDeviceShareDataList`,
        body: {
          toUser: safeIdentity.userId,
          appId: safeIdentity.appId,
          pageIndex: safeRequest.page,
          pageSize: 100,
        },
      };
    case 'status':
      return {
        path: `${prefix}getDeviceStatus`,
        body: { ...safeIdentity, deviceCode: safeRequest.deviceCode },
      };
    case 'telemetry':
      return {
        path: `${prefix}getDataByCode`,
        body: {
          ...safeIdentity,
          deviceCode: safeRequest.deviceCode,
          protocalCodes: [...safeRequest.codes],
        },
      };
  }
}

export function commandBody(commands: Command[]): { param: Command[] } {
  const result = commandsSchema.safeParse(commands);
  if (!result.success) throw new CloudError('invalid-request');
  return { param: result.data };
}
