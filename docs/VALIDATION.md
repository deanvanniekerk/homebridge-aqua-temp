# Local validation checkpoint

Recorded 2026-09-08 for the unfinished development integration. These results are local engineering evidence, not completion of the physical-control requirements or proof of production stability. No real account, device-setting command, production Homebridge storage or hardware was used by the automated tests.

## Reproduce

Use Node 22.23.2 and npm 10.9.8, then run:

```sh
npm ci --no-audit --no-fund
npm run check
bash scripts/check-armv7.sh
```

The ARM command requires a clean committed checkout. It runs the same checks in a pinned Linux ARMv7 container using emulation; see [development instructions](DEVELOPMENT.md). The native development host is macOS arm64. Homebridge is pinned to 2.4.0 (its supplied HAP is 2.2.2). The plugin has no runtime dependencies. Installed consumer dependencies are resolved from the pinned Homebridge package as described in DEVELOPMENT.md.

## Checked results

At implementation commit `90d46ef`, `npm run check` passed all 73 tests on the native macOS arm64 host and the pinned emulated Linux ARMv7 host, including formatting, lint and typechecking. The complete native test run took about 20 seconds and the emulated run about 121 seconds; the seven-day simulation itself took about 3 and 35 seconds respectively. These are observed timings, not performance requirements. Standards and specification reviews found no actionable defects in this checkpoint. No new PR has been published or CI run claimed for this local stack.

## Evidence by boundary

| Requirement                                                                                   | Evidence                                                                                                                                             | Scope                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication concurrency, expiry, contention and denied access                              | [Cloud transport tests](../test/cloud.test.mjs)                                                                                                      | Real HTTP with shared login, one renewal/read replay, cooldown and account/device permission distinctions.                                                                                               |
| Malformed JSON/envelopes, missing tokens, oversized/incomplete bodies, HTTP-200 vendor errors | [Cloud transport tests](../test/cloud.test.mjs)                                                                                                      | Real HTTP parsing, bounded bodies, safe closed error categories.                                                                                                                                         |
| DNS, TLS and connection failures; timeouts, redirects, 429/5xx and Retry-After                | [Cloud transport tests](../test/cloud.test.mjs)                                                                                                      | DNS failure injected at the resolver boundary; real HTTPS/HTTP request code remains active. TLS negotiation/connection refusal tested on local servers. No real vendor DNS or network outage is induced. |
| Partial/shared/duplicate discovery and normalized telemetry                                   | [Gateway tests](../test/gateway.test.mjs), [device-model tests](../test/device-model.test.mjs)                                                       | Actual client/gateway requests, sanitized observations and labeled synthetic cases.                                                                                                                      |
| Poll scheduling, staleness, isolation, cancellation and bounded subscriptions                 | [Coordinator tests](../test/coordinator.test.mjs)                                                                                                    | Actual coordinator with deterministic scheduler; separate real-gateway shutdown test closes outstanding login work.                                                                                      |
| Queue deadlines, ambiguous results, no replay and late-result reconciliation                  | [Command tests](../test/commands.test.mjs), cloud transport tests                                                                                    | Coordinator uses an explicitly synthetic control contract; transport tests send synthetic absolute wire requests to a local server. These layers do not prove the real device's control mapping.         |
| HAP values, constraints, errors and setter deadlines                                          | [Thermostat tests](../test/thermostat.test.mjs)                                                                                                      | Actual supplied HAP handlers and coordinator; synthetic capability/command contract where physical mappings are missing.                                                                                 |
| Config rejection, initial login denial, normal/debug redaction and reports                    | [Configuration tests](../test/configuration.test.mjs), [diagnostic tests](../test/diagnostics.test.mjs), [platform tests](../test/platform.test.mjs) | Runtime/schema agreement, bounded messages, actual transport/platform failures and explicit field projection.                                                                                            |
| Tarball install, cached identity, cold/warm restart and child bridges                         | [Package tests](../test/package.test.mjs)                                                                                                            | Clean production-only Homebridge install, actual HAP HTTP reads and rejected writes. Test-host-only routing supplies a fake cloud; it is excluded from the distribution.                                 |
| Seven-day repeated fault/recovery schedule                                                    | [Read recovery simulation](../test/recovery-soak.test.mjs)                                                                                           | Actual HTTP client, gateway, coordinator, diagnostics and HAP; two synthetic devices and virtual scheduling.                                                                                             |

## Seven virtual days

The simulation runs at the supported 300-second poll interval for 604,800,000 milliseconds of virtual time, including the initial poll: 2,017 polls. It repeatedly alternates 503 and 429 outages with five-minute Retry-After, malformed shared discovery, empty/duplicate lists, per-device 403, offline state, malformed JSON/telemetry and external temperature changes. The session expires at each virtual day boundary. It checks staleness after three intervals, recovery without restarting, per-device isolation and retained identities.

Observed native result: 11,116 HTTP requests, eight logins (initial plus seven renewals), zero device-setting requests, 5,660 state notifications and 3,587 sanitized log/report lines. Maximum simultaneous server sockets was two; active timer resources peaked at five above the test baseline. The test asserts bounded request/notification/log counts, at most two retained scheduler tasks between polls, one active update subscription, and no remaining plugin timers/subscriptions/sockets after shutdown. The seven-day run completed in roughly three seconds of native wall-clock time; emulation takes longer.

The test retains counters rather than collecting all network bodies or logs. Its failed command attempts are deliberately rejected by the unverified real profile. Accepted and ambiguous command recovery is covered separately at the transport/coordinator seams; successful writes through the real gateway and packed process remain a missing end-to-end gate until the vendor mapping is verified. Zero writes in a read-path simulation is not evidence that valid actuator commands work.

## Clock-correction regression

A real HTTP regression test moves `Date.now()` back one day while leaving the process monotonic clock intact. Before the fix, the newly acquired sample was immediately classified as stale. The gateway and diagnostics now use the same default monotonic epoch clock as the coordinator. The test verifies fresh state and a one-minute diagnostic age under the clock correction. This fixes mixed-clock freshness accounting; it does not infer vendor measurement timestamps.

## Limits and remaining gates

The [device evidence gates](DEVICE_MODEL.md) remain unresolved: writable constraints/step, authoritative target/readback, absolute Off/Heat commands and activity semantics. Consequently, the full core-control goal and dependent issue completion are still unproven. This report does not narrow the intended product to a read-only integration.

Virtual scheduling is not seven days of real-world uptime or a memory-leak proof. The simulation keeps two identities stable; it does not establish unlimited account/device scaling. Real-account session behavior, write authority and physical actuation remain separate from synthetic test outcomes.

Homebridge's child-bridge SIGTERM fallback may produce host exit 143; this is distinguished from ordinary host exit 0 and plugin crashes. HAP's `/accessories` serializer can substitute default values after getter failure, while `/characteristics` returns communication errors. See [adapter limitations](HOMEBRIDGE_ADAPTER.md). Neither accepted host fallback nor local HAP responses prove actual Apple Home presentation or physical iHost shutdown behavior.

The CI workflow declares minimum/latest Node 22 on Linux x64 and pinned emulated ARMv7. Local passing results are not evidence that a new GitHub PR's checks passed; CI and review/babysit must be inspected when completed issue work is published. Docker Desktop execution does not prove mDNS discovery, Apple Home pairing, physical iHost compatibility, or the hardware soak in issue #10.
