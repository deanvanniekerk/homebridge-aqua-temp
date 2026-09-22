# Contributing

Bug fixes, documentation improvements and evidence-backed device profiles are welcome. Open an issue before a substantial behavior change so the intended scope is clear.

## Develop locally

Use a supported Node 22 or Node 24 release and npm 10.9.8. `.node-version` pins the project's Node 22 development baseline:

```sh
npm ci
npm run check
```

`npm run check` runs Biome, strict production TypeScript checks, the build and Vitest. `npm run format` applies Biome formatting. Tests use local fake cloud servers and synthetic credentials; never point them at a real account or Homebridge installation.

For a focused change, run `npx vitest run src/<area>/<file>.test.ts`. Run the full checks before submitting. Keep individual cases below 1,000 ms in the CI timing reports; production installation and extended soak checks are manual release tasks. Changes to dependencies, runtime engines or integration also need the ARMv7 lane. With a clean committed checkout and a local Docker engine:

```sh
bash scripts/check-armv7.sh
```

This runs the committed snapshot in a disposable, pinned ARMv7 container under emulation. It never mounts real Homebridge storage. Use `npm pack` to build an installable tarball; the [setup guide](docs/INSTALLATION.md) covers manual deployment.

## Design and tests

Keep Homebridge presentation separate from transport, device decoding and account scheduling. See [architecture](docs/ARCHITECTURE.md). Preserve bounded retries, cancellation, fresh command validation and no write replay. Acknowledgment and reported settings do not establish physical actuation.

Add a regression at the boundary that owns the behavior. Prefer the real client/HAP code against local fakes over mocks that only assert their own calls. Keep fixtures small, sanitized and labeled as observed or synthetic. Untested models are attempted using the existing protocol mappings and logged as unverified. Changes to mode values, target bounds or readback need independent evidence; similar model names alone do not establish compatibility.

Keep runtime dependencies minimal; Zod validates untrusted configuration and vendor data. Do not copy another integration's device behavior or assets. Contributions are licensed under the repository's MIT license.

## Pull requests

Explain the problem, resulting behavior, tests and any support limits. Keep changes focused; avoid unrelated formatting or historical investigation logs. Update current documentation rather than appending a diary. Git history and issues retain earlier findings.

Do not include credentials, pairing codes, raw payloads or real device identifiers. For bugs, include runtime/plugin versions, model, reproduction steps and a sanitized diagnostic report. Publication is a separate maintainer action described in [releasing](docs/RELEASING.md).
