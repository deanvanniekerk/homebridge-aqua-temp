import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

// Test-host transport routing only. This file is excluded from the npm distribution.
// Requests still traverse the real client, HTTP serialization, gateway and coordinator.
// Production TLS is covered separately by cloud.test.mjs.
export function redirectCloud(origin) {
  const destination = new URL(origin);
  if (destination.protocol !== 'http:' || destination.hostname !== '127.0.0.1') {
    throw new Error('Fake cloud must bind to IPv4 loopback.');
  }
  const original = https.request;
  https.request = (url, options, callback) => {
    if (!(url instanceof URL) || url.origin !== 'https://cloud.linked-go.com:449') {
      throw new Error('Unexpected HTTPS destination in isolated fake-cloud host.');
    }
    return http.request(new URL(url.pathname + url.search, destination), options, callback);
  };
  syncBuiltinESMExports();
  return () => {
    https.request = original;
    syncBuiltinESMExports();
  };
}
if (process.env.AQUA_TEST_ORIGIN) redirectCloud(process.env.AQUA_TEST_ORIGIN);
