# Aqua Temp project structure

This guide adapts the shared Homebridge plugin structure used by `homebridge-atlas` to Aqua Temp's actual responsibilities. Device behavior and protocol decisions remain in [Architecture](ARCHITECTURE.md).

## Repository map

```text
src/
  index.ts                   Homebridge registration entrypoint
  settings.ts                Plugin identity and version
  configuration.ts           Runtime Zod configuration schema and parser
  configuration.test.ts      Runtime and Homebridge UI schema parity
  cloud/                     Vendor protocol, bounded HTTP, authentication and tests
  device/                    Device decoding, gateway, coordination and tests
  homebridge/                Platform lifecycle, HAP accessories and tests
scripts/                     Release checks and package-content test
fixtures/protocol/           Sanitized observations and synthetic variants
docs/                        User and maintainer documentation
config.schema.json           Homebridge settings UI schema
biome.json                   Formatting, lint and import organization
vitest.config.ts             Colocated test discovery and isolation
tsconfig.json                Strict production TypeScript compilation
```

The root of `src/` holds the stable entrypoint, package identity and configuration shared across areas. Keep direct imports between modules; do not add barrel files or thin pass-through classes solely to shorten paths. Add folders only for responsibilities that exist in this plugin. Aqua Temp has no custom settings server.

## Dependencies and ownership

| Area | Owns | May depend on |
| --- | --- | --- |
| `cloud/` | Wire shapes, session rules, bounded HTTP, safe errors and time budgets | Node APIs, Zod and its own modules |
| `device/` | Observed identity and readings, cloud-to-device gateway, command confirmation, scheduling and diagnostics | `cloud/`, Node APIs and Zod |
| `homebridge/` | Accessory lifecycle, stable UUID inputs and HAP presentation | `device/`, cloud error categories and configuration |
| Root entrypoints | Registration, package settings and configuration | Modules needed by those entrypoints |

Cloud modules never import Homebridge. Device state never depends on HAP characteristics. The gateway implements the coordinator's `DeviceGateway` interface, and tests replace the gateway or scheduler at those seams.

## Runtime and package contracts

- `src/index.ts` compiles to `dist/index.js`, the entrypoint Homebridge loads. It only registers the platform.
- The production build uses `rimraf` and `tsc` to preserve the source folder structure under `dist/`. `dist/**/*.js` is included in the npm package so imports from nested modules resolve.
- The parser in `src/configuration.ts` is the runtime authority for untrusted configuration. `config.schema.json` describes the Homebridge UI; update both together.
- Keep `PLUGIN_NAME`, `PLATFORM_NAME`, the private accessory UUID namespace, persisted context and the public configuration fields stable across file moves.
- Tests and `.test-support.ts` helpers are excluded from production compilation and the package. Release scripts remain JavaScript because Node executes them directly during publication.
- Inspect `npm pack --dry-run --json --ignore-scripts` after changing source layout or package files. The package-content test checks nested runtime modules and excludes development files.

## Tests and quality checks

Colocate TypeScript tests beside their owning module as `<module>.test.ts` or `<module>.<behavior>.test.ts`. Put shared fakes beside the area that owns them with a `.test-support.ts` suffix. Vitest imports source modules directly; individual tests need no prior build. Preserve file isolation for tests that replace process-wide transport functions.

```sh
npm ci
npm run test           # Colocated Vitest tests
npm run check          # Biome, strict runtime typecheck, build and tests
npm pack --dry-run --json --ignore-scripts
```

`biome.json` is the formatter and linter configuration. TypeScript checks production code with strict NodeNext settings. Zod validates untrusted configuration, vendor envelopes and bounded record shapes; translate failures into fixed safe error categories without logging raw input. CI runs the same full check on x64. The ARMv7 job runs `npm run check:runtime` because Biome has no ARMv7 executable.

Keep fake cloud traffic and fixture identities synthetic or sanitized. Tests should exercise the owning boundary: cloud client against loopback HTTP, coordination against fake time and gateways, and presentation against real Homebridge/HAP objects. Preserve the no-write-replay, freshness, readback and cached-accessory assertions when moving tests.
