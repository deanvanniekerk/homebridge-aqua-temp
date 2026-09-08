export type CloudErrorCategory =
  | 'invalid-credentials'
  | 'permission-denied'
  | 'session-expired'
  | 'session-contention'
  | 'rate-limited'
  | 'unavailable'
  | 'invalid-response'
  | 'vendor-rejected'
  | 'timeout'
  | 'cancelled'
  | 'invalid-request';

const messages: Record<CloudErrorCategory, string> = {
  'invalid-credentials': 'Authentication rejected. Check credentials and reload configuration.',
  'permission-denied': 'Access denied. Check account or device permissions.',
  'session-expired': 'The cloud session is no longer valid.',
  'session-contention':
    'Repeated session invalidation. Consider a dedicated shared account; cooling down.',
  'rate-limited': 'The cloud service requested a delay.',
  unavailable: 'The cloud service is temporarily unavailable.',
  'invalid-response': 'The cloud response does not match the supported protocol.',
  'vendor-rejected': 'The cloud service rejected the operation with an unrecognized vendor error.',
  timeout: 'The cloud operation exceeded its time budget.',
  cancelled: 'The cloud operation was cancelled.',
  'invalid-request': 'The cloud request or client configuration is invalid.',
};

/** Safe to log: no vendor text, URL, payload, token, or original error cause is retained. */
export class CloudError extends Error {
  constructor(
    readonly category: CloudErrorCategory,
    readonly retryAfterMs = 0,
    readonly deliveryUncertain = false,
  ) {
    super(messages[category]);
    this.name = 'CloudError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
