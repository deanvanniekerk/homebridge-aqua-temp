# Aqua Temp Homebridge plugin specification

Date: 2026-09-08. Status: agreed product scope; engineering baseline for implementation. Protocol and deployment findings remain explicit discovery gates.

## 1. Outcome and decisions

Replace an unreliable existing integration with an independently written plugin that lets the owner monitor and control a heat pump from Apple Home without manually restarting the plugin after ordinary network, device, or session failures.

| Decision | Scope |
| --- | --- |
| Initial equipment | AstralPool / Fluidra Waterlinx BOOST-i-INV-HP-40. The supplied nameplate identifies an inverter swimming pool heat pump. |
| Use | At home; scoped as residential pool heating from the nameplate and interview. No domestic hot-water-specific functions. |
| Host | Homebridge in Docker on SONOFF iHost. [Compatibility discovery](COMPATIBILITY.md) records observed ARMv7/runtime/storage details and the selected baseline; the installed image tag/digest remain unavailable. |
| First-release features | Water temperature, target temperature, on/off, and truthful operating status. |
| Connectivity | Aqua Temp cloud is acceptable. A dedicated account with a shared heater is recommended if current session behavior requires it. |
| Quality | Extensive automated local tests, including failure/recovery scenarios; optional real-account checks and documented real-host validation. |
| Distribution | Public independent GitHub repository, MIT license, eventual npm package. |
| Immediate deliverable | This specification and sequenced GitHub issues; implementation follows separately. |

The owner reported that the old plugin runs for a while and then crashes. No crash log has been collected and no cause is established. The old project's session warnings and issue reports are investigation leads, not a diagnosis.

The source photos and screenshot stay outside the repository. Only the non-unique make/model and deployment facts above are needed publicly.

## 2. Boundaries

V1 targets the verified device profile and one configured Aqua Temp account per platform instance. Enumerate owned/shared devices when supported, deduplicate by stable identity, and allow an optional device allowlist. Additional models are supported only after their capability mappings are verified; unknown profiles must not receive speculative commands.

Cooling/auto selection, silent mode, energy/history graphs, Eve extensions, scheduling, local LAN control, Matter integration, and a standalone iHost add-on are outside v1. Existing vendor-side timers and protection logic continue to belong to the device. The plugin does not run its own temperature-control loop or repeatedly force a preferred setting over changes made in the app.

## 3. Discovery gates

### D1: Actual deployment and supported runtime

Record the installed container tag/digest, CPU architecture, Node, Homebridge and Homebridge UI versions, network mode, and persistent storage configuration. Use targeted version output, not a full configuration/environment dump. Verify a compatible ARMv7 container build and plugin dependency installation before claiming iHost support.

The [2026-09-08 compatibility investigation](COMPATIBILITY.md) selects Homebridge 2.4.0 and Node 22.23.2, with strict TypeScript/ESM, as the implementation baseline. Node 22 retains upstream ARMv7 support; Node 24 classifies it as Experimental. The pinned ARMv7 image and dependency candidate passed local emulated installation, typechecking and empty Homebridge startup. The actual iHost still runs Homebridge 1.11.1, Node 22.13.1 and UI 5.11.0, so a coordinated upgrade is required before matching the baseline. Do not silently upgrade the running container or claim that emulation proves physical-host compatibility. Homebridge 1.x support is outside the selected matrix.

### D2: Vendor contract

Independently document authentication, session-expiry signals, device discovery, owned/shared permissions, telemetry, available capabilities, and absolute state-setting commands. Verify endpoint origins, required headers, units, enum semantics, setpoint bounds/step, timestamps and the meaning of command acknowledgments. Determine whether operating/heating status is directly observable. Record what remains unknown; do not invent vendor fields, refresh endpoints or an official SDK.

Use public vendor documentation where available and explicitly authorized observations of the user's own account. Public behavior reports may suggest tests, but are not authoritative protocol definitions. Do not import or translate the previous plugin's implementation. Every synthetic fixture must be labeled synthetic; sanitized observed fixtures must record provenance and omit account/device identifiers and credentials.

Read-only access can establish telemetry but cannot prove write permissions or actuation. A separate, explicitly agreed live command test must specify the device, change and restoration procedure. No live commands are part of this specification task.

If a core feature cannot be implemented faithfully, record the evidence and resolve that product limitation before shipping; do not conceal it with a guessed value.

## 4. Apple Home behavior

Use Homebridge's supplied HAP API and a standard Thermostat service as the proposed Apple Home representation. Validate this choice against the verified device profile and actual Apple Home UI during integration.

| Feature | Required behavior |
| --- | --- |
| Current temperature | Show the verified water sensor reading in Celsius internally; let HomeKit handle display units. Missing, invalid or stale data must not turn into zero or the target temperature. |
| Target temperature | Advertise the intersection of verified device constraints and supported HAP constraints. Reject unsupported values before network traffic; no silent clamping or invented default range. |
| Target state | Expose Off/Heat for the supported heating profile. Define explicit vendor commands for both. Never silently switch a cooling/auto device into heating during discovery or restart. |
| Operating state | Map confirmed device activity to heating or idle/off semantics. A powered device below its target is not sufficient proof that it is heating. Flow faults, defrost, delays and unsupported states must not be misrepresented. |
| Unexpected mode | When the app selects an unexposed mode, keep unambiguous telemetry available and return an appropriate error for unrepresentable mode/state values; log a bounded explanation. Do not fabricate Off or Heat. |
| Unavailable state | Use HAP communication errors for unavailable characteristic reads/writes. Retain last known values internally with age for diagnostics. Apple Home presentation must be checked; do not assume custom fault fields render visibly. |
| External changes | Reconcile app/device changes through polling without overwriting them. |

The plugin must not change power, setpoint or mode merely because it started or recovered connectivity. Setpoint writes must not implicitly turn the unit on unless that coupling is established by the protocol and clearly resolved in the spec before implementation.

Treat vendor command acceptance and observed device state as different facts. A setter may complete on a documented authoritative acknowledgment within the HAP deadline; that does not prove physical heating started. Schedule readback, show confirmed rather than optimistically cached state, and report rejection or an unresolved result. If the API acknowledgment is not authoritative, define a bounded confirmation strategy before enabling writes.

## 5. Reliability contract

The following are initial engineering defaults to verify against vendor behavior. Keep the ordinary settings surface small; adjust the documented constants and tests together if discovery supplies better evidence.

| Parameter | Initial policy |
| --- | --- |
| Polling | One account poll loop; 60-second normal interval, no overlapping cycles. Configurable interval 30–300 seconds, subject to verified vendor limits. |
| Read freshness | Last successful valid sample expires after three configured poll intervals; a vendor-offline response invalidates it immediately. Cold-start cached values remain unavailable until refreshed. |
| HTTP read timeout | 10 seconds, abortable. Bound response size and reject malformed envelopes. |
| HAP setter deadline | At most 8 seconds total, including auth work; lower if required by the tested HAP runtime. Late completion triggers reconciliation, not a second command. |
| Retry delay | Exponential backoff with jitter, starting at 5 seconds and capped at 5 minutes; honor a longer valid Retry-After value. Bound retries within each operation. |
| Authentication | One in-flight login/renewal shared across callers. A recognized expired session permits at most one renewal and one safe read replay per operation. |
| Persistent auth failure | Invalid credentials/denied access enter an actionable paused-auth state until configuration reload or restart; no rapid login loop. Distinguish this from transient session expiry. |
| Session contention | Repeated token invalidation enters cooldown with a dedicated-account hint; do not keep competing with the mobile app. Tune detection from observed behavior. |
| Write queue | Serialize per device; bound queue size and total deadline. Reject excess work as busy. Do not persist commands for replay after restart/outage. |
| Shutdown | Cancel requests/timers, reject pending work, remove listeners, and complete plugin cleanup within 5 seconds. |

Recover from transient transport errors and device outages without restart. A successful fresh response resets transient backoff. Each asynchronous entry point owns its error handling; no unhandled rejections, process exit calls, or global exception handlers that mask broken state.

Reads may be retried within their budget. Writes with uncertain delivery are never blindly retried. Use verified absolute-setting semantics and readback; apply retries only where idempotence or unequivocal non-execution is established. Poll results started before a write must not overwrite a newer confirmed revision; protect reconciliation against out-of-order responses.

Distinguish device-offline, transient cloud/network failure, authentication required, permission denied, invalid protocol data and unsupported capabilities. A failure for one device must not invalidate healthy devices or delete accessories. Discovery failures and temporary omissions never trigger automatic accessory removal; explicit configuration exclusion/removal may do so through documented lifecycle handling.

Recommend deployment as a Homebridge child bridge for process isolation. This reduces the effect of a bug but does not replace the recovery requirements.

## 6. Implementation structure and standards

Use strict TypeScript, ESM and the official dynamic-platform lifecycle. Use the HAP types/constructors from `api.hap`, restore cached accessories through `configureAccessory`, and register stable accessory identities through Homebridge APIs. Namespace UUIDs from stable vendor device IDs, never names or list positions. Do not copy the old plugin's identities or claim existing Apple Home automations will survive migration.

Keep responsibilities separated into a small number of substantive modules:

1. **Cloud client:** Own HTTP transport, authentication, vendor envelope validation and typed errors. No HomeKit dependencies. Prefer supported Node HTTP/fetch facilities and few runtime dependencies; avoid native dependencies unless justified and tested on iHost.
2. **Device profile:** Translate verified vendor data into units, capabilities, readings and commands. Keep vendor field names and enum interpretation here, away from HomeKit handlers.
3. **Coordinator:** Own scheduling, freshness, per-device state, write serialization and reconciliation. Inject clock/transport boundaries for deterministic tests.
4. **Homebridge adapter:** Own configuration/lifecycle, accessory identity and characteristic mapping. Consume domain state; do not perform independent login or polling from each getter.

These are responsibility boundaries, not a mandate for a class per file or a generic plugin framework. Do not build an extensibility system before a second verified device requires it. Validate untrusted network/configuration data at entry points; keep internal types precise, avoid unchecked casts and broad `any`, and document error/retry semantics at module interfaces.

Use reproducible dependency installation, a lockfile, formatting/linting, type checking, a build, meaningful tests and package-content checks in CI. Test public behavior and failure boundaries rather than mocking every method or fixing an arbitrary coverage target. Choose supported tool versions during foundation work and document their compatibility rationale.

## 7. Configuration and diagnostics

Provide a Homebridge UI schema with account username/password, optional device IDs, poll interval and debug toggle; align schema and runtime validation. Validate required fields, duplicate IDs and numeric limits before starting requests. Account secrets are local configuration, never accessory context, logs, generated fixtures or package contents. Debug mode obeys the same redaction rules as normal logs.

Log transitions and actionable error categories, not every successful poll. Rate-limit repeated messages; emit a single useful recovery message. A sanitized diagnostic report should contain plugin/runtime versions, anonymous per-device references, profile/capability status, last-success age, failure category and retry timing. Do not dump request URLs with secrets, request bodies, headers, tokens, email addresses or raw vendor errors.

Development/live diagnostics accept credentials through a git-ignored local secret file or environment mechanism without command-line arguments or shell tracing. Prefer a dedicated shared account when supported. Normal CI never accesses the real account. Generated public evidence must be reviewed and sanitized before committing.

## 8. Verification and release gates

### Automated local verification

Use a deterministic fake cloud server and injected clock to test the actual HTTP/client/coordinator boundaries. Include malformed JSON, valid JSON with wrong shapes, missing tokens, vendor error envelopes under HTTP 200, expiry during concurrent requests, 401/403/429/5xx, DNS/TLS failures, timeouts, partial discovery, empty/shared/duplicate lists, stale readings, device offline/recovery, out-of-order responses, failed and ambiguous writes, repeated app changes, and shutdown during requests.

Assert bounded request/login counts, no overlapping poll cycles, no stale-command replay, deterministic deadlines, correct freshness/error propagation, stable accessory identity, secret redaction and cleanup. Simulate at least seven days of polling with repeated faults and verify bounded timers/listeners/queues. Virtual time is a scheduling test, not proof of seven days of real-world stability or absence of memory leaks.

Load the built npm tarball into a real supported Homebridge process backed by the fake server. Exercise cold/warm restart, cached accessory restore, child-bridge lifecycle and characteristic reads/writes. Run a Linux container/package smoke test for the declared target architecture. macOS Docker limitations mean local container startup alone is not evidence of Apple Home mDNS discovery.

### Optional real-account and actual-host validation

An opt-in read-only probe can validate login, discovery and parsing without touching settings. Before a live command test, agree a reversible action, capture the original setting, confirm the app/device result and report restoration outcome. Avoid leaving the old and new plugins competing over the same account/device during tests.

For stable-release readiness, collect actual iHost evidence for install, pairing, readings, permitted writes, restart and a controlled connectivity outage. Target a seven-day unattended soak with zero plugin-caused restarts or required manual recoveries, bounded request rates and no sustained resource growth. Record start/end versions, resource observations, incidents and recovery results. If this optional owner-assisted phase is unavailable, ship only a clearly labeled prerelease; do not claim hardware validation or proven long-run reliability.

### Packaging and migration

Choose a distinct npm package identity because the unscoped reference name is already used. Candidate: `@deanvanniekerk/homebridge-aqua-temp`, subject to npm scope ownership and Homebridge discovery/installation verification. A registry lookup returning not found does not prove publish rights. GitHub and npm names may differ.

Ship compiled files, configuration schema, README and license through an explicit package allowlist. Verify install from the tarball without repository files or development dependencies. Publish through an authenticated, least-privilege release workflow; prefer npm trusted publishing/provenance where supported. No npm publication is authorized by the planning task itself.

Document backup, disabling the old plugin, configuring the account and device selection, child-bridge pairing, re-creating affected Apple Home automations, verification, and rollback to the old plugin/configuration. Do not clear unrelated Homebridge accessory caches. Record verified compatibility rather than promising all Aqua Temp devices work.

## 9. Evidence and limitations

Sources checked 2026-09-08; recheck moving version references during implementation.

- Owner interview and supplied equipment images: scope, make/model, Docker deployment. Raw files are intentionally private.
- [Homebridge 2.4.0 release](https://github.com/homebridge/homebridge/releases/tag/v2.4.0): current stable baseline at research time.
- [Official template package metadata](https://raw.githubusercontent.com/homebridge/homebridge-plugin-template/latest/package.json): current TypeScript/ESM and runtime conventions; no template implementation copied.
- [Dynamic platform API](https://developers.homebridge.io/homebridge/interfaces/DynamicPlatformPlugin.html) and [Homebridge API](https://developers.homebridge.io/homebridge/interfaces/API.html): lifecycle and accessory integration.
- [Official Docker image](https://github.com/homebridge/docker-homebridge): advertised ARM32v7 images, host networking and persistent storage. Installed image compatibility is unverified.
- [Child bridges](https://github.com/homebridge/homebridge/wiki/Child-Bridges): supported process isolation and separate pairing.
- [Node release status](https://nodejs.org/en/about/previous-releases): runtime lifecycle reference.
- [SONOFF iHost hardware discussion](https://sonoff.tech/en-de/blogs/news/how-to-run-home-assistant-over-sonoff-ihost): 32-bit platform context.
- [Reference plugin README](https://github.com/hjuhlin/homebridge-aqua-temp#readme), [session report #17](https://github.com/hjuhlin/homebridge-aqua-temp/issues/17), [startup report #14](https://github.com/hjuhlin/homebridge-aqua-temp/issues/14), and [shared-control report #16](https://github.com/hjuhlin/homebridge-aqua-temp/issues/16): historical behavior reports only.

No vendor API calls, hardware tests, crash diagnosis, or plugin implementation have been performed as part of this planning deliverable.
