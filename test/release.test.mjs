import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('package metadata exposes Aqua Temp as separate plugin-search keywords', async () => {
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const keywords = new Set(metadata.keywords.map((keyword) => keyword.toLowerCase()));

  assert.equal(keywords.has('homebridge-plugin'), true);
  assert.equal(keywords.has('aqua'), true);
  assert.equal(keywords.has('temp'), true);
});

test('release guard requires approval, matching metadata and finished release notes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'aqua-temp-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  for (const script of ['check-release.mjs', 'release-notes.mjs']) {
    await copyFile(new URL(`../scripts/${script}`, import.meta.url), join(root, 'scripts', script));
  }

  async function check(
    version,
    tag,
    approved,
    overrides = {},
    notesVersion = version,
    notes = '### Changed\n\n- Finished release note.',
  ) {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'homebridge-aqua-temp-connect',
        version,
        publishConfig: {
          access: 'public',
          registry: 'https://registry.npmjs.org/',
          tag,
        },
        ...overrides,
      }),
    );
    await writeFile(
      join(root, 'CHANGELOG.md'),
      `# Changelog\n\n## [${notesVersion}] - 2026-09-16\n\n${notes}\n`,
    );
    const env = { ...process.env };
    delete env.AQUA_TEMP_RELEASE_APPROVED;
    if (approved !== undefined) env.AQUA_TEMP_RELEASE_APPROVED = approved;
    return spawnSync(process.execPath, [join(root, 'scripts/check-release.mjs')], {
      env,
      encoding: 'utf8',
      timeout: 5_000,
    }).status;
  }

  for (const [version, tag] of [
    ['1.0.1-beta.1', 'beta'],
    ['1.0.1', 'latest'],
  ]) {
    assert.equal(await check(version, tag, version), 0);
    assert.notEqual(await check(version, tag, undefined), 0);
    assert.notEqual(await check(version, tag, 'different-version'), 0);
  }
  assert.notEqual(await check('1.0.1-beta.1', 'latest', '1.0.1-beta.1'), 0);
  assert.notEqual(await check('1.0.1', 'beta', '1.0.1'), 0);
  assert.notEqual(await check('01.0.1', 'latest', '01.0.1'), 0);
  assert.notEqual(await check('1.0.1-rc.1', 'latest', '1.0.1-rc.1'), 0);
  assert.notEqual(await check('1.0.1', 'latest', '1.0.1', {}, '1.0.2'), 0);
  assert.notEqual(await check('1.0.1', 'latest', '1.0.1', {}, '1.0.1', 'TBD'), 0);
  assert.notEqual(await check('1.0.1', 'latest', '1.0.1', { private: true }), 0);
  assert.notEqual(
    await check('1.0.1', 'latest', '1.0.1', {
      publishConfig: {
        access: 'restricted',
        registry: 'https://registry.npmjs.org/',
        tag: 'latest',
      },
    }),
    0,
  );
  assert.notEqual(
    await check('1.0.1', 'latest', '1.0.1', {
      publishConfig: {
        access: 'public',
        registry: 'https://example.invalid/',
        tag: 'latest',
      },
    }),
    0,
  );

  await writeFile(
    join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [1.0.2] - 2026-09-16\n\n### Fixed\n\n- New fix.\n\n## [1.0.1] - 2026-09-16\n\n### Changed\n\n- Stable release.\n',
  );
  const extracted = spawnSync(
    process.execPath,
    [join(root, 'scripts/release-notes.mjs'), '1.0.2'],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(extracted.status, 0);
  assert.equal(extracted.stdout, '### Fixed\n\n- New fix.\n');
});
