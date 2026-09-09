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

export async function runHomebridge(
  directory,
  expectedMessage = 'Aqua Temp monitoring started.',
  options = {},
) {
  const child = spawn(
    process.execPath,
    [
      ...(options.preload ? ['--import', options.preload] : []),
      join(directory, 'node_modules/homebridge/bin/homebridge.js'),
      '--insecure',
      '--strict-plugin-resolution',
      '--no-qrcode',
      '--plugin-path',
      join(directory, 'node_modules/@deanvniekerk/homebridge-aqua-temp-connect'),
      '--user-storage-path',
      join(directory, options.storage ?? 'storage'),
    ],
    {
      cwd: directory,
      env: { ...process.env, NODE_PATH: '', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
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
        (output.match(/Homebridge v2\.4\.0.*is running/g)?.length ?? 0) >= (options.bridges ?? 1) &&
        output.includes(expectedMessage)
      )
        resolve();
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    exited.then(() => reject(new Error(`Homebridge exited before readiness:\n${output}`)), reject);
  });
  try {
    await within(ready, 60_000, () => `Homebridge startup timed out:\n${output}`);
    if (options.exercise)
      await within(
        options.exercise(() => output),
        15_000,
        () => `Homebridge exercise timed out:\n${output}`,
      );
    child.kill('SIGTERM');
    const result = await within(exited, 10_000, () => `Homebridge shutdown timed out:\n${output}`);
    // Homebridge 2.4.0's CLI and child bridge both retain a five-second SIGTERM
    // fallback exit(128 + 15); the parent can reach it while waiting for its child IPC.
    const expectedCodes = options.bridges > 1 ? [0, 143] : [0];
    assert.ok(
      expectedCodes.includes(result.code),
      `Unexpected Homebridge exit code ${result.code}:\n${output}`,
    );
    if (options.bridges > 1) assert.match(output, /shutting down child bridge process/);
    assert.doesNotMatch(output, /ended unexpectedly|restart attempt|SIGKILL/);
    assert.doesNotMatch(output, /Error loading plugin|No plugin was found|uncaught|unhandled/i);
    assert.ok(output.includes(expectedMessage), `Missing expected platform message:\n${output}`);
    return output;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}
