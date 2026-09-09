# Validation

## Automated coverage

`npm run check` runs formatting, lint, strict typechecking and behavioral tests on local fake services. CI covers Node 22.23.2 and latest 22 on Linux x64, plus a pinned Linux ARMv7 image under emulation. macOS arm64 is used for local development. See [contributing](../CONTRIBUTING.md).

| Boundary                                                                 | Tests                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| HTTP/TLS, envelopes, authentication, expiry, contention and retry bounds | `test/cloud.test.mjs`                                                                 |
| Discovery, sensor validation, modes and command mapping                  | `test/device-model.test.mjs`, `test/gateway.test.mjs`, `test/mode-controls.test.mjs`  |
| Freshness, queues, cancellation and late results                         | `test/coordinator.test.mjs`, `test/commands.test.mjs`                                 |
| HAP controls, optional sensors and cached identities                     | `test/thermostat.test.mjs`, `test/basic-accessory.test.mjs`, `test/platform.test.mjs` |
| Configuration and redaction                                              | `test/configuration.test.mjs`, `test/diagnostics.test.mjs`                            |
| Artifact contents, production-only installation, restart and removal     | `test/package.test.mjs`                                                               |
| Seven virtual days with repeated failures and commands                   | `test/recovery-soak.test.mjs`, `test/control-recovery.test.mjs`                       |

Virtual time establishes scheduling/recovery behavior, not elapsed hardware uptime or absence of memory leaks. The packed-host test runs real Homebridge/HAP on loopback against a fake cloud; it does not prove mDNS pairing or physical actuation. Homebridge's `/accessories` metadata can contain fallback values after a getter error; inspect per-characteristic statuses for reliable read results.

## Actual-host evidence

Owner-assisted tests on 2026-09-08/09 used the tested BOOSTi-INV-HP-40, Aqua Temp 2.2.2 and an iHost Homebridge Docker installation. They established install/pairing, readings, Heat fractional target readback, app-originated changes, power round trips, individual Cool/Auto mode/target commands and an actual Home Auto single-target round trip. An isolated child-process DNS failure demonstrated stale presentation and same-process recovery; a physical router/WAN outage was not tested.

The maintainer installed the published `0.1.0-beta.1` through Homebridge, paired a new child bridge and reported successful initial testing. The npm trusted publisher and protected GitHub environment are configured. The stable release's workflow run and registry provenance provide the publication evidence.

## Remaining hardware coverage

- A seven-day physical run: exact build/runtime, UTC start/end, restart counts, resource observations, incidents and interventions.
- Broader models, full Cool/Auto ranges, active-state classification and backup restore need their own evidence.

Untested-model fallback is covered by synthetic discovery, telemetry, HAP command and optional-sensor tests, including missing/conflicting model metadata. These establish software behavior, not physical compatibility with another model.

Keep only current results here. Raw private observations remain outside the repository; superseded investigations are retained in Git history. Release decisions and package identity are documented in [releasing](RELEASING.md).
