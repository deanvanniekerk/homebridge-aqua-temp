import { createServer } from 'node:http';
import { once } from 'node:events';

// All responses and identities in this file are synthetic, not captured traffic.
export const success = (objectResult) => ({ error_code: '0', isReusltSuc: true, objectResult });
export const login = success({
  'x-token': 'synthetic-token',
  userId: 'synthetic-user',
  appId: '14',
});
export const credentials = {
  username: 'synthetic@example.invalid',
  password: 'synthetic-password',
};

export async function serverFor(t, handle) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const call = { path: req.url, token: req.headers['x-token'], body: JSON.parse(body) };
    calls.push(call);
    await handle(call, res, calls);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}

export function reply(res, body, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
