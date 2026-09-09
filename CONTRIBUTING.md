# Contributing

Bug fixes, documentation improvements and evidence-backed device profiles are welcome. Open an issue before a substantial behavior change so the intended scope is clear.

## Develop locally

Use Node from `.node-version` and npm 10.9.8:

```sh
npm ci
npm run check
```

`npm run check` runs formatting, lint, strict TypeScript checks and the test suite. `npm run format` applies formatting. Tests use local fake cloud servers and synthetic credentials; never point them at a real account or Homebridge installation. The package test downloads public dependencies into a temporary consumer and removes it afterward.

For a focused change, run `npm run build` then `node --test test/<file>.test.mjs`. Run the full checks before submitting. Changes to dependencies, runtime engines or integration also need the ARMv7 lane. With a clean committed checkout and a local Docker engine:

```sh
bash scripts/check-armv7.sh
```

This runs the committed snapshot in a disposable, pinned ARMv7 container under emulation. It never mounts real Homebridge storage. Use `npm pack` to build an installable tarball; the [setup guide](docs/INSTALLATION.md) covers manual deployment.

## Design and tests

Keep Homebridge presentation separate from transport, device decoding and account scheduling. See [architecture](docs/ARCHITECTURE.md). Preserve bounded retries, cancellation, fresh command validation and no write replay. Acknowledgment and reported settings do not establish physical actuation.

Add a regression at the boundary that owns the behavior. Prefer the real client/HAP code against local fakes over mocks that only assert their own calls. Keep fixtures small, sanitized and labeled as observed or synthetic. New device profiles need independent evidence for identity, mode values, target bounds and readback; never broaden support based only on similar model names.

Keep runtime dependencies minimal. The current plugin has none. Do not copy another integration's implementation, tests or assets. Contributions are licensed under the repository's MIT license.

## Pull requests

Explain the problem, resulting behavior, tests and any support limits. Keep changes focused; avoid unrelated formatting or historical investigation logs. Update current documentation rather than appending a diary. Git history and issues retain earlier findings.

Do not include credentials, pairing codes, raw payloads or real device identifiers. For bugs, include runtime/plugin versions, model, reproduction steps and a sanitized diagnostic report. Publication is a separate maintainer action described in [releasing](docs/RELEASING.md).
