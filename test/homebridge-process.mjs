import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message())), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runHomebridge(directory) {
  const child = spawn(
    process.execPath,
    [
      join(directory, 'node_modules/homebridge/bin/homebridge.js'),
      '--strict-plugin-resolution',
      '--no-qrcode',
      '--plugin-path',
      join(directory, 'node_modules/@deanvanniekerk/homebridge-aqua-temp'),
      '--user-storage-path',
      join(directory, 'storage'),
    ],
    { cwd: directory, env: { ...process.env, NODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise((resolve, reject) => {
    const receive = (data) => {
      output += data.toString();
      if (output.length > 1_000_000) reject(new Error('Homebridge output exceeded its bound'));
      if (
        /Homebridge v2\.4\.0.*is running/.test(output) &&
        output.includes('Foundation build: device integration is not implemented.')
      )
        resolve();
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    exited.then(() => reject(new Error(`Homebridge exited before readiness:\n${output}`)), reject);
  });
  try {
    await within(ready, 60_000, () => `Homebridge startup timed out:\n${output}`);
    child.kill('SIGTERM');
    const result = await within(exited, 10_000, () => `Homebridge shutdown timed out:\n${output}`);
    assert.equal(result.code, 0, `Homebridge did not shut down cleanly:\n${output}`);
    assert.doesNotMatch(output, /Error loading plugin|No plugin was found|uncaught|unhandled/i);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}
