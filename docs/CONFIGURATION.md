# Configuration implementation status

`parseConfig` and the Homebridge UI schema now define username/password, optional device IDs, a 30–300 second whole-number poll interval (default 60), and debug (default false). An empty ID list means all discovered identities; duplicates, blanks and malformed types are rejected. Unknown host fields remain ignored so Homebridge child-bridge metadata can coexist with plugin configuration.

Ajv 8.20.0 is an exact development-only dependency used to compare real JSON Schema validation against the runtime parser. The plugin keeps zero runtime dependencies. Both validators count Unicode characters consistently; neither coerces numeric strings, accepts null defaults, or includes supplied values in error messages.

The platform validates configuration during construction. A rejected configuration emits an actionable, value-free message and does not install the launch callback; Homebridge remains running. A clean tarball installation test checks valid startup, restart, rejected configuration without credential leakage, and recovery after fixing the configuration.

The development platform connects to Aqua Temp for discovery, readings and the limited Heat controls described in DEVICE_MODEL.md. The platform observes coordinator snapshots and provides the diagnostic behavior below, including account failures before any device is discovered.

## Optional accessories

`includePowerSwitch` and `includeWaterTemperatureSensor` are independent booleans, both **false by default**. Enable either in the plugin settings and restart the child bridge to add a separate Power switch or inlet Water Temperature sensor for each selected, supported device. The default layout retains only the existing thermostat.

The additional accessories use stable identities and the same polling session; they do not add cloud requests. The water sensor does not depend on the target, mode or compressor activity. Power Off does not depend on a supported target or mode; Power On currently requires the verified Heat contract and fresh, clear fault status. These options do not enable unverified Cool/Auto writes. A stale/offline device still becomes unavailable. Their behavior is covered with real HAP tests; the separate-accessory presentation has not yet been validated in Apple Home on iHost.

Disabling an option and restarting removes that optional accessory. Re-enabling uses the same generated identity, but removal can lose its Apple Home room assignments or automations. Temporary missing telemetry never removes accessories. Credentials and telemetry are not stored in accessory context.

## Diagnostic contract

`Diagnostics.observe` accepts a normalized account snapshot and emits a status/failure transition. Repeated identical failures are suppressed for five minutes. Healthy polls remain quiet in normal mode; recovery emits one message. Invalid credentials, sharing permissions and session contention include fixed troubleshooting hints. Normal and debug fault messages include sample age and retry timing. Account-level errors and recoveries have their own bounded transition record, so a failed initial login is actionable even with zero discovered devices.

`Diagnostics.report` produces a JSON-serializable snapshot with the installed package version, Node and Homebridge versions, account discovery/failure status, anonymous device references, profile/control availability, status, last-success age, failure category and retry delay. It selects allowed fields and enum values instead of recursively redacting raw input. Vendor messages, payloads, nested causes, identifiers, account names and URLs are never serialized. Unknown version formats are reported as unknown. Ages describe local sample acquisition, not a verified vendor measurement timestamp.

References are sequential and stable for one diagnostics instance; they are not derived from device identifiers and are not persisted. Tracking and reports are capped at 1,000 devices per instance. A report includes an omitted-device count when it cannot represent every supplied entry. Extra identities do not displace existing references or generate unbounded log state. This is a diagnostic resource limit, not a device discovery or control limit.

## Getting a report

Enable **Debug diagnostics** in the local Homebridge UI plugin settings, save, and restart the platform (or its child bridge). Search the Homebridge log for **Diagnostic report:**. The JSON after that prefix is the sanitized report to copy into a support issue. A report is emitted after the first discovery result or account failure, then at most once every five minutes while state updates continue. It is a point-in-time snapshot; its ages are measured when emitted. Disable debug when finished.

Normal status/failure and recovery messages remain available with debug off. Enabling debug does not reveal additional account fields or raw errors, and neither mode stores credentials in accessory context. No separate HTTP diagnostics endpoint or credentials-bearing report file is created. Homebridge manages its own log retention; these report lines follow that same lifecycle. Anonymous references restart from `device-1` when the platform restarts.

The UI schema was inspected for required account fields, password formatting, explicit defaults/limits and understandable report instructions. An example generated by the actual diagnostic serializer is in [diagnostic-report.json](../fixtures/diagnostics/diagnostic-report.json). Its input is synthetic domain state, not a captured account. The packed-process test also parses a report from the running plugin and rejects account/device identifiers and secrets in it. This establishes the supplied schema and report contract; it does not claim physical iHost UI or Apple Home validation.

## Local provisioning

Enter credentials through your local Homebridge UI or its persistent local configuration. Keep that configuration outside the source repository; it contains the password in a form the plugin must be able to read. Never place credentials in accessory context, screenshots, issue bodies, command-line arguments or published fixtures. Development probes use the already ignored `.secrets/` mechanism and ordinary tests use synthetic accounts only.

Prefer a separately registered Aqua Temp account with the device shared to it. This was observed to support reads on the owner's heater and avoids deliberately reusing the mobile account; it does not guarantee freedom from vendor session contention. Keep the previous integration disabled before running another integration against the same account/device.
