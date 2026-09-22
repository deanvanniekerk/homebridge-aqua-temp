# Validation

## Automated coverage

`npm run check` runs Biome, strict production typechecking, the build and Vitest behavioral tests on local fake services. CI covers current Node 22 and Node 24 on Linux x64, plus a pinned Node 22 Linux ARMv7 image under emulation. The ARMv7 lane runs the runtime checks because Biome has no executable for that architecture. macOS arm64 is used for local development. See [contributing](../CONTRIBUTING.md).

| Boundary                                                                 | Tests                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| HTTP/TLS, envelopes, authentication, expiry, contention and retry bounds | `src/cloud/cloud-client.test.ts`                                                                            |
| Discovery, sensor validation, modes and command mapping                  | `src/device/device-model.test.ts`, `src/device/gateway.test.ts`, `src/device/coordinator.mode-controls.test.ts` |
| Freshness, queues, cancellation and late results                         | `src/device/coordinator.test.ts`, `src/device/command-queue.test.ts`                                      |
| HAP controls, optional sensors and cached identities                     | `src/homebridge/thermostat.test.ts`, `src/homebridge/basic-accessory.test.ts`, `src/homebridge/platform.test.ts` |
| Lost-write recovery                                                      | `src/device/coordinator.control-recovery.test.ts`                                                        |
| Configuration and redaction                                              | `src/configuration.test.ts`, `src/device/diagnostics.test.ts`                                             |

CI keeps short behavioral tests and checks the package contains nested compiled modules while excluding development files. Production installation/restart/removal and extended soak coverage are manual release checks. Simulated recovery tests do not establish elapsed hardware uptime or absence of memory leaks.

## Actual-host evidence

Owner-assisted tests on 2026-09-08/09 used the tested BOOSTi-INV-HP-40, Aqua Temp 2.2.2 and an iHost Homebridge Docker installation. They established install/pairing, readings, Heat fractional target readback, app-originated changes, power round trips, individual Cool/Auto mode/target commands and an actual Home Auto single-target round trip. An isolated child-process DNS failure demonstrated stale presentation and same-process recovery; a physical router/WAN outage was not tested.

The maintainer installed the published scoped `0.1.0-beta.1` through Homebridge, paired a new child bridge and reported successful initial testing. The old scoped package's npm trusted publisher and protected GitHub environment are configured. The unscoped package needs its own first publication and package-specific trusted-publisher configuration before Homebridge verification can be requested.

On 2026-09-16, the packed unscoped `1.0.1` candidate was installed with Homebridge 2.4.0 in a clean Node 22.23.2 Linux container. Homebridge started with no plugin configuration and with platform-only configuration; the latter logged that Aqua Temp was not configured and started no cloud monitoring. A second start on the same storage had no port conflict, and SIGTERM produced a clean status-0 exit in 309 ms. The package also had no runtime dependency vulnerabilities. These checks rehearse the corresponding Homebridge verification scenarios but do not replace the review of the published package.

## Remaining hardware coverage

- A seven-day physical run: exact build/runtime, UTC start/end, restart counts, resource observations, incidents and interventions.
- Broader models, full Cool/Auto ranges, active-state classification and backup restore need their own evidence.

Untested-model fallback is covered by synthetic discovery, telemetry, HAP command and optional-sensor tests, including missing/conflicting model metadata. These establish software behavior, not physical compatibility with another model.

Keep only current results here. Raw private observations remain outside the repository; superseded investigations are retained in Git history. Release decisions and package identity are documented in [releasing](RELEASING.md).
