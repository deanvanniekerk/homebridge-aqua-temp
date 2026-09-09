# Releases

The public package is **`@deanvniekerk/homebridge-aqua-temp-connect`**. Stable versions use `latest`; versions named `X.Y.Z-beta.N` use `beta`. Publication is an explicit maintainer decision. Keep hardware evidence and limitations accurate regardless of release channel; see [validation](VALIDATION.md).

## Publisher configuration

The GitHub workflow uses npm trusted publishing with provenance, without a long-lived npm token:

- npm trusted publisher: owner `deanvanniekerk`, repository `homebridge-aqua-temp`, workflow `release.yml`, environment `npm`, direct `npm publish` allowed.
- GitHub environment `npm`: restricted to `main`, with the maintainer as required reviewer.
- Repository variable `NPM_PUBLISH_ENABLED=true`: enables the publish job. Setting it false disables publication.
- GitHub-hosted runner: Node 22.23.2 and npm 11.5.1; job permissions `contents: read` and `id-token: write`.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup and requirements. Local development and CI tests use npm 10.9.8.

## Prepare and publish

1. Update `package.json` and `package-lock.json` to an unused version. Set `publishConfig.tag` to `latest` for stable versions or `beta` for betas. Update current documentation and release notes.
2. Run `npm run check` and review CI for the exact commit, including minimum/latest Node 22 and emulated ARMv7. Package tests verify contents, clean installation, restart, removal and publication guards.
3. Merge the reviewed changes. Manually run **Publish npm release** on `main`, entering the exact version in `approved_version`.
4. Wait for the workflow's checks, then approve the `npm` environment deployment. The guard requires the exact approved version, public npm access and the matching dist-tag. A push, tag or PR never publishes automatically.
5. Verify the published version, dist-tag and provenance on npm. Create release notes linked to the published commit. Hardware testing remains a separate owner-operated step.

The guard prevents accidental publication; npm permissions and the protected GitHub environment enforce authorization. npm versions are immutable: do not rerun a successful publication expecting to replace its contents. Check the registry after an uncertain result before retrying.

## Rollback

Keep the previous working version or tarball. Users can reinstall it with its matching configuration using the [migration and rollback guide](INSTALLATION.md). Fix regressions in a new version. This package preserves this project's original accessory UUID namespace, but migration from another package association can require pairing again.
