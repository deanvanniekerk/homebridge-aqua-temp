# Development foundation

This package is an original dynamic-platform foundation for issue #3. It registers `AquaTemp`, retains restored accessory references, receives Homebridge launch/shutdown events, and takes HAP from `api.hap`. It does not contact Aqua Temp, discover devices, expose controls, or configure existing hardware. Accessory binding and stale-state handling belong to the later adapter work.

## Selected tools

Versions checked on 2026-09-08; direct development dependencies are exact and transitive versions are committed in `package-lock.json`.

| Component                   | Selection                                  | Rationale                                                                                  |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Node                        | 22.23.2 minimum, Node 22 only (`^22.23.2`) | [Verified runtime baseline](COMPATIBILITY.md); ARMv7 support                               |
| npm                         | 10.9.8                                     | Bundled with the selected official Node release; lockfile v3 and `npm ci`                  |
| Homebridge                  | 2.4.0 development host; engine `^2.4.0`    | Current stable selected in runtime discovery; supplies the runtime HAP implementation      |
| TypeScript                  | 6.0.3                                      | Newest stable compiler in the current typescript-eslint supported range (`>=4.8.4 <6.1.0`) |
| ESLint / typescript-eslint  | 10.10.0 / 8.70.0                           | Current stable compatible lint pair; strict type-aware rules for source                    |
| ESLint base rules / globals | @eslint/js 10.0.1 / globals 17.12.0        | Matching ESLint major and current Node globals declarations                                |
| Prettier                    | 3.9.6                                      | Stable formatter; existing reviewed spec/compatibility/roadmap formatting is preserved     |
| Node typings                | 22.20.1                                    | Matches the runtime major                                                                  |
| Test runner                 | Built-in `node:test`                       | No transpiler or test-framework runtime dependency                                         |

TypeScript 7.0.2 passed the earlier standalone compatibility probe, but the [current linter support matrix](https://typescript-eslint.io/users/dependency-versions/) excludes it. This foundation selects 6.0.3 rather than ignoring peer constraints. Revisit the compiler when the linter supports it. `skipLibCheck` avoids errors within Homebridge/Matter declaration files under `exactOptionalPropertyTypes`; strict checks, exact optional properties and unchecked-index protection still apply to our source. No upstream types are patched.

The plugin has **zero runtime dependencies**. Homebridge is a development/test dependency, not a bundled HAP implementation. No native addon or direct vendor SDK is introduced.

## Commands

Use Node from `.node-version` and npm 10.9.8. The npm engine check rejects unsupported Node majors.

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

`npm run check` runs formatting, lint, typecheck and tests together. Tests invoke `npm pack`, whose prepack hook rebuilds `dist` from scratch. `npm run format` applies formatting. `npm pack` creates a development tarball; it does not publish it.

Tests may download public npm dependencies for an isolated consumer host. They use only synthetic Homebridge configuration in temporary directories, bind HAP to loopback on an ephemeral port, and never read the real account or Homebridge configuration. Two package-level contracts are checked:

1. The tarball contains exactly the reviewed runtime files; it imports from outside the repository without dependencies, and its publication guard fails. Source, tests, captures, credentials, maps and tooling are excluded by the explicit package allowlist.
2. A fresh production-only consumer installs the tarball with Homebridge 2.4.0, loads the registered platform in a real process, reaches startup and shuts down cleanly, then repeats with the same storage. TypeScript/ESLint are absent. This is a package/lifecycle contract, not a physical-host, accessory-cache or Apple Home pairing test.

The root lockfile fixes development dependency resolution. The isolated consumer pins Homebridge 2.4.0 but resolves its production dependency ranges independently, exercising installation as a consumer would; it is not a second locked development environment.

CI runs the full checks on Ubuntu x64 at minimum/latest Node 22 and in the pinned ARMv7 image. The latest-22 lane catches later patch changes while the minimum lane remains fixed. Run ARMv7 verification locally with Docker Desktop ARM emulation (or a local Linux Docker engine with ARM binfmt support):

```sh
bash scripts/check-armv7.sh
```

This requires a clean committed checkout and a local Unix-socket Docker context. It sends only `git archive HEAD` into a disposable container: ignored secrets/captures, node_modules and the working tree are not mounted. No production volumes or published ports are used. ARM emulation does not prove performance, mDNS or reliability on physical iHost. The existing iHost upgrade remains separate work.

## Identity, packaging and publication

Provisional identity: `@deanvanniekerk/homebridge-aqua-temp`, version `0.0.0-development.0`. GitHub ownership does not prove npm scope ownership. The platform alias is `AquaTemp`; use it only for development smoke runs until device integration is implemented.

The package allowlist includes compiled JavaScript and `config.schema.json`; npm also includes package metadata, README and LICENSE. Build output is disposable and not committed. The schema offers only a display name: account configuration is deferred to issue #8, so do not supply real credentials to this foundation.

Publication is disabled by `private: true` and an explicit failing `prepublishOnly` hook. CI has read-only repository permissions and no publish/release workflow. Removing these guards and verifying scope rights belong to issue #11; no npm release is part of this work.

Issue #2 was closed at the owner's request with unresolved protocol gates. Its [preserved discovery evidence](https://github.com/deanvanniekerk/homebridge-aqua-temp/blob/issue-2-aqua-temp-protocol/docs/PROTOCOL.md) does not approve compressor, full mode or live-control mappings. Closing that issue does not permit invented device behavior in later implementation.

## API references

- [Homebridge dynamic platform lifecycle](https://developers.homebridge.io/homebridge/interfaces/DynamicPlatformPlugin.html)
- [Homebridge-provided API and HAP](https://developers.homebridge.io/homebridge/interfaces/API.html)

These references define host contracts; neither the old Aqua Temp implementation nor template implementation code was copied.
