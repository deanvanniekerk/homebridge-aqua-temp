import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { runHomebridge } from './homebridge-process.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
let workspace;
let archive;
let pack;
before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'aqua-package-'));
  const result = await run('npm', ['pack', '--json', '--pack-destination', workspace], {
    cwd: root,
  });
  [pack] = JSON.parse(result.stdout);
  archive = join(workspace, pack.filename);
});
after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test('distribution contains only reviewed runtime files and refuses publication', async () => {
  assert.deepEqual(pack.files.map((file) => file.path).sort(), [
    'LICENSE',
    'README.md',
    'config.schema.json',
    'dist/cloud-client.js',
    'dist/cloud-error.js',
    'dist/cloud-http.js',
    'dist/cloud-protocol.js',
    'dist/cloud-time.js',
    'dist/command-queue.js',
    'dist/coordinator.js',
    'dist/device-model.js',
    'dist/gateway.js',
    'dist/index.js',
    'dist/platform.js',
    'dist/scheduler.js',
    'dist/settings.js',
    'package.json',
  ]);
  await run('tar', ['-xzf', archive, '-C', workspace]);
  const installed = join(workspace, 'package');
  const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.private, true);
  assert.deepEqual(metadata.dependencies ?? {}, {});
  assert.equal(metadata.name, '@deanvanniekerk/homebridge-aqua-temp');
  const module = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const m = await import('./dist/index.js'); if (typeof m.default !== 'function') process.exit(1);",
    ],
    { cwd: installed },
  );
  assert.equal(module.stderr, '');
  await assert.rejects(run('npm', ['run', 'prepublishOnly'], { cwd: installed }), (error) => {
    assert.match(error.stderr, /Publishing is disabled until release preparation/);
    return true;
  });
});

test(
  'packed plugin loads in a clean production Homebridge host and survives restart',
  { timeout: 180_000 },
  async () => {
    const consumer = join(workspace, 'consumer');
    await mkdir(join(consumer, 'storage'), { recursive: true });
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true }));
    await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--omit=dev',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
        '--engine-strict',
        'homebridge@2.4.0',
        archive,
      ],
      { cwd: consumer, timeout: 120_000 },
    );
    await assert.rejects(access(join(consumer, 'node_modules/typescript')));
    await assert.rejects(access(join(consumer, 'node_modules/eslint')));
    await writeFile(
      join(consumer, 'storage/config.json'),
      JSON.stringify({
        bridge: {
          name: 'Aqua foundation smoke',
          username: '0E:11:22:33:44:66',
          pin: '031-45-154',
          port: 0,
          bind: ['127.0.0.1'],
          advertiser: 'ciao',
        },
        accessories: [],
        platforms: [{ platform: 'AquaTemp', name: 'Aqua Temp' }],
      }),
    );
    await runHomebridge(consumer);
    await runHomebridge(consumer);
  },
);
