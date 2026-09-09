import { readFileSync } from 'node:fs';

const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const approved = process.env.AQUA_TEMP_RELEASE_APPROVED;
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(metadata.version)) {
  throw new Error(
    'Only beta releases are enabled. Stable publication requires a separate evidence review.',
  );
}
if (approved !== metadata.version) {
  throw new Error(
    'Publication requires a separate release decision: approve the exact package version.',
  );
}
if (
  metadata.private ||
  metadata.publishConfig?.access !== 'public' ||
  metadata.publishConfig?.tag !== 'beta'
) {
  throw new Error('Release metadata must select public access and the beta dist-tag.');
}
console.log(`Release guard passed for ${metadata.name}@${metadata.version}`);
