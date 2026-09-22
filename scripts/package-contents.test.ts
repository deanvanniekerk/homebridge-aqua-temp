import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

async function runtimeFiles(directory: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await runtimeFiles(directory, path)));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test-support.ts')
    )
      files.push(`dist/${path.replaceAll('\\', '/').replace(/\.ts$/, '.js')}`);
  }
  return files;
}

test('npm package contains every compiled runtime module and excludes development files', {
  timeout: 60_000,
}, async () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const names = new Set(
    (JSON.parse(packed.stdout) as { files: { path: string }[] }[])[0]?.files.map(
      (file) => file.path,
    ),
  );
  for (const path of await runtimeFiles(join(root, 'src'))) assert.ok(names.has(path), path);
  for (const path of [
    'config.schema.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'docs/PROJECT_STRUCTURE.md',
  ])
    assert.ok(names.has(path), path);
  for (const path of names)
    assert.doesNotMatch(
      path,
      /(^|\/)(?:test|fixtures|node_modules|\.secrets)(?:\/|$)|\.test(?:-support)?\.|^src\/|^dist\/.*\.ts$/,
    );
});
