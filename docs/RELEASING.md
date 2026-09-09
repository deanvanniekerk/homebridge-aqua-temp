# Releases

## Package identity and readiness

The selected identity is **`@deanvniekerk/homebridge-aqua-temp-connect`**, initially **`0.1.0-beta.1`** on the **`beta`** dist-tag. The owner identified their npm account as `deanvniekerk`; registry metadata lists that account as maintainer of the existing `@deanvniekerk/homebridge-aqua-temp` 1.0.2. The new name returned not found on 2026-09-09. It is intentionally separate from that existing package. Availability is not a reservation or a successful publish authorization check.

The previous development package was installed through a tarball and appeared in Homebridge UI. The renamed artifact is covered by clean local installation tests. Registry search/install of the new identity and end-to-end trusted publishing remain unverified until publication. No npm publication has been executed as part of release preparation.

The package remains beta because no seven-day physical soak is recorded. Issue #10 is closed and owner feedback is positive; that alone is not a sustained-reliability claim. A stable release requires recorded evidence and a reviewed change to the beta-only publication guard and workflow.

## One-time maintainer setup

1. Confirm access using `npm login` and `npm whoami` on your own machine. Do not add an npm token to the repository.
2. For the first package publication, make a separate release decision and publish the reviewed beta interactively with public access. npm's package-level trusted publisher configuration is set in the package's settings; if it is unavailable before the initial package exists, bootstrap interactively. Confirm the exact name/version/dist-tag before accepting any 2FA prompt. Initial interactive publication is not claimed to have CI provenance.
3. Create a GitHub environment named `npm`, restrict it to `main`, and add required reviewers. Set repository variable `NPM_PUBLISH_ENABLED=true` only when publication is authorized and setup is complete.
4. In npm's package settings, add a GitHub trusted publisher: owner `deanvanniekerk`, repository `homebridge-aqua-temp`, workflow filename `release.yml`, environment `npm`. Enable direct `npm publish` for this publisher. The repository URL must match package metadata. Prefer disallowing token-based publication once OIDC is working.

The workflow uses GitHub-hosted runners, Node 22.23.2 and npm 11.5.1, with `contents: read` and job-local `id-token: write`. No publish token is configured. [npm's trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) specifies npm 11.5.1+/Node 22.14+ and describes automatic provenance for public GitHub repositories and packages. Production/development testing continues to use npm 10.9.8.

## Prepare and approve a beta

1. Update `package.json` and `package-lock.json` to an unused `X.Y.Z-beta.N`. Update release notes and current compatibility limits.
2. Run `npm ci`, `npm run check` and the ARMv7 lane. Package tests check contents, import, clean production install, restart, removal and refusal of unapproved/stable publication. Review CI for the exact commit, including minimum/latest Node 22 and emulated ARMv7.
3. Run `npm pack` and inspect its contents and SHA-256. Keep the previous working package for rollback. Do not include private evidence, account data or pairing material.
4. Merge the reviewed change. Make the separate publication decision, then manually run **Publish beta** on `main`, entering the exact approved version. CI runs again; publication requires the `npm` environment and enable variable. A push, tag or PR never publishes automatically. A disabled variable means no publish job runs.
5. Verify the published version/provenance and `beta` tag on npm, and install that exact version from a clean Homebridge UI. Confirm registry discovery, setup and removal before recommending public installation. Record the outcome here or in the release notes.

For the separately approved first interactive publication only:

```sh
npm ci
npm run check
AQUA_TEMP_RELEASE_APPROVED=0.1.0-beta.1 npm publish --access public --tag beta
```

Use the actual approved package version. The guard rejects a different approval value and rejects stable versions. This is an accidental-publication guard, not an authentication boundary; npm account permissions and protected workflow/environment settings provide authorization. Do not invoke publication merely to test the workflow.

## Rollback

npm versions are immutable. Keep a working tarball/version, document any regression and release a new beta. Users can reinstall a prior version and its matching configuration using the [migration and rollback guide](INSTALLATION.md). Changing the package name preserves this project's existing UUID namespace, but Homebridge package association and pairing may still require migration; other plugins' identities are unrelated.
