# Releases

`CHANGELOG.md` is the single source for human-readable release notes. After the first publication
under the unscoped name, an approved GitHub Actions run publishes the npm package with provenance
and creates the matching Git tag and GitHub release from that changelog section. Stable versions
use npm's `latest` tag; versions named `X.Y.Z-beta.N` use `beta`.

The public package is `homebridge-aqua-temp-connect`. The earlier
`@deanvniekerk/homebridge-aqua-temp-connect` package remains available only for rollback and should
be deprecated after the replacement is verified.

## Prepare and publish

1. Choose an unused version. Update `version` in `package.json` and `package-lock.json`, and set the
   matching `publishConfig.tag`.
2. Add a dated `## [VERSION]` section to `CHANGELOG.md`. Do not repeat release notes in the README
   or this procedure.
3. Run `npm run check` and `npm pack --dry-run`. Open and merge the reviewed change only after CI
   passes on Node 22, Node 24 and emulated ARMv7.
4. On `main`, manually run **Publish npm release** with `approved_version` set to the exact package
   version, then approve the protected `npm` environment.
5. Confirm that the workflow completed both `publish` and `github-release`. The latter creates
   `vVERSION`, marks beta versions as prereleases and uses only the matching changelog section as
   its notes.

The workflow validates the semver shape, exact approval, npm access, registry, distribution tag
and matching finished changelog section before publishing. The approval input never changes files
or bumps a version.

## First publication under the unscoped name

npm trusted publishing is configured per package, so the new package must exist before its trusted
publisher can be configured. Version `1.0.1` is the first unscoped release:

1. Before merging, set the repository variable `NPM_PUBLISH_ENABLED=false` so the workflow cannot
   be dispatched accidentally.
2. Merge the reviewed `1.0.1` commit into `main`, check out that exact clean commit, run `npm ci` and
   `npm run check`, and confirm `npm view homebridge-aqua-temp-connect` still reports not found.
3. Sign in to npm with the maintainer account and two-factor authentication, then publish once:

   ```sh
   AQUA_TEMP_RELEASE_APPROVED=1.0.1 npm publish --access public
   ```

4. Verify `homebridge-aqua-temp-connect@1.0.1` from npm and install it on the test Homebridge host.
5. On the new npm package's settings page, configure the trusted publisher:
   - GitHub owner `deanvanniekerk`
   - repository `homebridge-aqua-temp`
   - workflow `release.yml`
   - environment `npm`
   - direct `npm publish` allowed
6. Set `NPM_PUBLISH_ENABLED=true` and keep the GitHub `npm` environment restricted to `main` with
   maintainer approval.
7. Create the one-time GitHub release at the published commit using the `1.0.1` section from
   `CHANGELOG.md`. Later releases are created by the workflow:

   ```sh
   node scripts/release-notes.mjs 1.0.1 > /tmp/aqua-temp-release-notes.md
   gh release create v1.0.1 --target main --title "homebridge-aqua-temp-connect 1.0.1" \
     --notes-file /tmp/aqua-temp-release-notes.md
   ```

8. After the replacement is working in Homebridge, deprecate—not unpublish—the old package:

   ```sh
   npm deprecate '@deanvniekerk/homebridge-aqua-temp-connect@*' \
     'Package moved to homebridge-aqua-temp-connect'
   ```

The first unscoped release will not have an npm provenance attestation because it bootstraps the
package. Every later workflow release uses npm trusted publishing with provenance.

## Publisher configuration

- npm trusted publisher: GitHub owner `deanvanniekerk`, repository `homebridge-aqua-temp`, workflow
  `release.yml`, environment `npm`, with direct `npm publish` allowed.
- GitHub environment `npm`: restricted to `main`, with the maintainer as required reviewer.
- Repository variable `NPM_PUBLISH_ENABLED=true`: enables publication only after the new package's
  trusted publisher is configured.
- GitHub-hosted publish runner: Node 22.23.2 and npm 11.5.1, with `contents: read` and
  `id-token: write`. The subsequent GitHub release job has only `contents: write`.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the registry setup.

## Failure recovery

npm versions are immutable. If publication is uncertain, inspect npm before trying anything else.
If `publish` succeeded but `github-release` failed, use GitHub's **Re-run failed jobs** action so
only the release job runs again; do not start another publication. The GitHub release job is
idempotent when an existing release targets the same commit and rejects a conflicting tag target.

Keep the previous working version or tarball. Users can reinstall it with its matching
configuration using the [migration and rollback guide](INSTALLATION.md). Fix regressions in a new
version. This package preserves the project's original accessory UUID namespace, but migration
from an unrelated package association can still require pairing again.

## Homebridge verification

Request verification only after the unscoped package and its matching GitHub release are public and
the package-name migration has been tested. Use the
[Plugin Verification Request](https://github.com/homebridge/plugins/issues/new/choose) template.
The current automated review checks include:

- a dynamic platform with a valid `config.schema.json` and matching `AquaTemp` alias;
- `homepage`, `bugs.url`, `homebridge-plugin`, `supports-hap` and no install lifecycle scripts;
- engines compatible with Node 22, Node 24 and Homebridge 2.4.0;
- `homebridge` only as a development dependency and no known dependency vulnerabilities;
- a public GitHub repository with issues enabled and a release matching the npm version;
- startup with no plugin config, platform-only config, minimum and full config, plus network-failure
  resilience;
- clean shutdown within 12 seconds and restart without port conflicts; and
- no analytics, unsafe code, privilege escalation or writes outside Homebridge storage.

The plugin makes no analytics calls and writes no runtime files of its own. Diagnostics are
sanitized log output. Hardware evidence and limitations remain in [validation](VALIDATION.md).
