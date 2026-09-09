# Mode support and graceful fallback

Scope expanded by the owner on 2026-09-09. This is an implementation plan and evidence checklist; Cool/Auto are not implemented or verified yet. The installed development plugin still supports only the existing Heat profile. The seven-day soak is deferred until the expanded behavior is settled and an exact build is selected.

## Product requirements

- Support Heat, Cool and Auto for profiles whose mode, target and command behavior is verified. A visible app button establishes a UI option, not its wire value, writable constraints or effect on power.
- Separate requested power, selected mode, measured temperatures, target constraints, observed activity and fault knowledge. Missing activity must not suppress a verified power/temperature capability.
- Keep polling and other devices working when one device, field or presentation fails. Bound diagnostic repetition and recover automatically when valid data returns.
- Never map an unknown model to a known writable profile, invent readings, silently switch modes, silently clamp targets or turn unavailable data into zero.
- Preserve accessory identity and user automations through transient unsupported states. Do not repeatedly add/remove services as telemetry varies.
- Validate fallback in Apple Home, including startup, mode transitions, unknown activity, unsupported mode, stale/offline data and recovery. Retain the distinctions between a transport failure and a capability the plugin cannot represent.

## Protocol evidence needed

1. With the device Off, capture Heat baseline, app-selected Cool, app-selected Auto and restoration to Heat. Record power and the app-displayed target at each step.
2. Identify each mode’s target field by a small owner-coordinated app change and restoration. Confirm whether Auto has one target or distinct thresholds; observe mode-specific app bounds and increments without inferring them from decimal formatting alone.
3. Separately coordinate absolute API mode writes and readback, checking their effect on power and stored targets. Do not assume batch atomicity or replay an uncertain write. Define how a Home mode selection transitions mode and power when multiple vendor operations are required.
4. Check actual selected-mode/activity presentation on the device and Home. Do not deliberately induce defrost or fault conditions to complete scope.

## Presentation constraints and decision still required

Homebridge’s standard Thermostat target-state enum supports Off, Heat, Cool and Auto. Its current-activity enum only supports Off, Heat and Cool; there is no unknown activity value. See the [Homebridge current-activity definition](https://developers.homebridge.io/HAP-NodeJS/classes/_definitions.Characteristics.CurrentHeatingCoolingState.html). Actual macOS Home observation in #10 showed that an error for that required activity field can make the whole thermostat tile unavailable while other HAP reads still succeed.

The implementation must evaluate a capability-based presentation, including independently usable standard power/temperature accessories if a complete thermostat cannot be represented truthfully. Such a fallback may change the visible Home layout and needs actual Home verification; it is not yet selected or shipped. Retaining the previous activity forever, substituting Idle for unknown activity, or removing a required characteristic is not an accepted resolution. Cool/Auto target semantics must be established before choosing the final standard Home representation, especially if Auto uses a single vendor setpoint rather than Home’s threshold model.

## Read-only observation preparation

A temporary observer in `.local/mode-research/` adds selected parameter codes to the installed gateway’s existing telemetry request and uses the same authenticated client. It performs no command writes, additional logins or extra polling cycles. Output retains only allowlisted parameter codes, numeric-or-empty values, selected datatype/range metadata and timestamps; it excludes identifiers, credentials and raw vendor responses. The original gateway is backed up privately on the host. The observer is gated by a removable flag and a twenty-minute lifetime, preserves a baseline and at most twenty later samples, and contains file-output errors so observation cannot stop normal polling. It is excluded from the distributable package and must be removed after the manual observation work.

A local test passed disabled-by-default behavior, additional selectors, rejection of synthetic secrets, preservation of numeric readings and DIGI1 metadata, bounded retention and flag-based disabling. These checks validate the observer only; they establish no Cool/Auto mapping or public device support.

### Initial Heat baseline

At 2026-09-09 07:05:04.645 UTC, the temporary observer’s first installed-client sample reported Online, generic fault false, Power=0, Power_State=0, Mode=1, R02=32.0°C, Set_Temp=32.0°C, T02=20.0°C and O07=0 with datatype DIGI1. This matches the established inactive Heat baseline. Mode metadata reported range 0–2 but does not assign the remaining values to Cool/Auto.

Additional observations were R01=0.0 with metadata range 8–35°C, R03=30.0 with metadata range 8–40°C, R08=8.0, R09=35.0, R10=15.0 and R11=40.0. These are candidate parameters, not verified Cool/Auto targets or writable limits. In particular, R01’s value falls outside its metadata range in this Heat sample, so it cannot simply become a validated Cool target by assumption. Owner-assisted app mode comparisons are the next required evidence.

The observation import is temporarily installed in the development gateway on iHost and the baseline was read through the existing session. One intentional child restart loaded it. Original gateway SHA-256 is `714830ae2d283df98c00c916bf801bb8fcd0c1a114e0a47e701c6faef0517551`; the private backup and observer are under the host’s `issue-10-modes` directory. A removable `enabled` flag and twenty-minute process lifetime bound observation. No production Cool/Auto support or fallback behavior has been enabled yet. The temporary transfer server was stopped after the verified transfer.
