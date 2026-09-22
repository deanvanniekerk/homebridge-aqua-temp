import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { CloudError, isRecord } from './cloud-error.js';

export interface HttpCall {
  origin: string;
  path: string;
  body: unknown;
  token?: string;
  signal: AbortSignal;
  now: () => number;
}

const successEnvelope = z.object({
  error_code: z.string(),
  isReusltSuc: z.boolean(),
  objectResult: z.unknown(),
});

/** JSON POST only, no redirects, no raw errors crossing this boundary. */
export async function post(call: HttpCall): Promise<unknown> {
  let body: string;
  try {
    body = JSON.stringify(call.body);
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error();
  } catch {
    throw new CloudError('invalid-request');
  }
  return new Promise((resolve, reject) => {
    const fail = (error: CloudError) => {
      reject(error);
    };
    try {
      const request = (call.origin.startsWith('https:') ? httpsRequest : httpRequest)(
        new URL(call.path, call.origin),
        {
          method: 'POST',
          signal: call.signal,
          agent: false,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            ...(call.token ? { 'x-token': call.token } : {}),
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            const category =
              status === 401
                ? call.token
                  ? 'session-expired'
                  : 'invalid-credentials'
                : status === 403
                  ? 'permission-denied'
                  : status === 429
                    ? 'rate-limited'
                    : status >= 500 && status <= 599
                      ? 'unavailable'
                      : 'invalid-response';
            fail(new CloudError(category, retryAfter(response.headers['retry-after'], call.now())));
            response.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
              fail(new CloudError('invalid-response'));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on('error', () => {
            fail(new CloudError('unavailable'));
          });
          response.on('end', () => {
            try {
              const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const parsed = successEnvelope.safeParse(value);
              if (!parsed.success || !isRecord(value) || !('objectResult' in value))
                throw new CloudError('invalid-response');
              const envelope = parsed.data;
              if (envelope.error_code === '0' && envelope.isReusltSuc)
                resolve(envelope.objectResult);
              else if (envelope.error_code !== '0' && !envelope.isReusltSuc) {
                fail(
                  new CloudError(
                    envelope.error_code === '-100' ? 'session-expired' : 'vendor-rejected',
                  ),
                );
              } else fail(new CloudError('invalid-response'));
            } catch (error) {
              fail(error instanceof CloudError ? error : new CloudError('invalid-response'));
            }
          });
        },
      );
      request.on('error', () => {
        fail(new CloudError(call.signal.aborted ? 'cancelled' : 'unavailable'));
      });
      request.end(body);
    } catch {
      fail(new CloudError('invalid-request'));
    }
  });
}

function retryAfter(value: string | undefined, now: number): number {
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, Number.MAX_SAFE_INTEGER) : 0;
}
