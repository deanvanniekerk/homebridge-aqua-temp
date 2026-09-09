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

### App-selected Cool, power retained Off

The owner selected Cool in Aqua Temp without changing the target and reported that the device remained Off with **Target Temp 0°C**. At 2026-09-09 07:10:14.081 UTC, the existing-client capture reported Online, fault false, Power=0, Power_State=0, Mode=0, Set_Temp=0.0, R01=0.0, R02=32.0 and R03=30.0; water T02=20.0 and compressor frequency O07=0 were unchanged. This establishes the observed Cool selection as Mode=0 and confirms that a displayed zero is a real app/API observation, not a missing-data placeholder. The mode change did not turn the unit on in this trial.

R01 continued to report metadata range 8–35°C despite containing 0°C. Neither writable acceptance of zero nor the full Cool target contract is established. R01 is a candidate Cool target because it agrees with the app and Set_Temp, but a separate controlled target change is still needed to identify its behavior independently. Readable reported values and writable constraints must be modeled separately; this observation must not lead to silent clamping to 8°C or to substituting the Heat target of 32°C. No API command or target change was sent during this comparison.

### App-selected Auto, power retained Off

The owner selected Auto without changing the target and reported that the device remained Off with target 30°C. At 2026-09-09 07:13:19.415 UTC, the existing-client capture reported Online, fault false, Power=0, Power_State=0, Mode=2, Set_Temp=30.0, R03=30.0, R02=32.0, R01=0.0 and O07=0. R03 metadata remained 8–40°C. This establishes the observed Auto selection as Mode=2; the app mode change did not turn the unit on in this trial.

Together with the Heat and Cool comparisons, the observed selection mapping for this device is Cool=0, Heat=1 and Auto=2. Set_Temp followed the app-displayed target across all three selections. R03 is a candidate Auto target, pending a separate controlled target change; its writable limits, increments and API write behavior are not yet verified. The app shows one target, but HomeKit Auto presentation and threshold semantics still require evaluation. No API command or target change was sent during this comparison.

### Restoration to Heat

The owner selected Heat and confirmed the app target automatically returned to 32°C without adjustment. At 2026-09-09 07:18:28.862 UTC, the capture confirmed Online, fault false, Power=0, Mode=1, Set_Temp=32.0, R02=32.0 and O07=0. R01 remained 0.0 and R03 remained 30.0. This completes the app-driven Heat → Cool → Auto → Heat comparison with power Off throughout the captured states and the original Heat target restored. The next manual check will distinguish the candidate Auto target from coincidentally matching values by changing it one app increment while Off.

### Auto target changed by one app increment

The owner selected Auto and tapped + once from its stored 30°C target, reporting 30.5°C. At 2026-09-09 07:20:32.487 UTC, the existing-client capture confirmed Online, fault false, Power=0, Power_State=0, Mode=2, Set_Temp=30.5, R03=30.5 and O07=0. R02 remained 32.0 and R01 remained 0.0. The controlled change identifies R03 as the observed Auto target field and establishes a 0.5°C app increment at this value. Set_Temp followed the selected target. No API command was sent by the test observer; API write behavior, full Auto bounds and increment behavior across that range remain unverified. Restoration of Auto's stored target to 30°C is the next owner-assisted step.

The owner then tapped − once and confirmed the app returned to 30°C. At 07:23:42.701 UTC, R03 was restored to 30.0 with Mode=2, Power=0, O07=0, Online and fault false; R02 remained 32.0 and R01 remained 0.0. However, Set_Temp still reported 30.5 in that same sample. This establishes that the target fields can disagree after an app change; the display alias must not override the verified mode-specific target or cause unrelated capabilities to fail. Convergence timing is not established by this sample.

The first observation window was preserved privately as `issue-10-modes/observations-round-1.json` on iHost. Only the Aqua Temp child bridge was intentionally restarted to renew the observer's twenty-minute lifetime for the next owner-assisted Cool check. Its new baseline at 07:25:17.505 UTC confirmed Auto, Off, R03=30.0 and the same Set_Temp=30.5 discrepancy. The observer still sends no commands and must be removed when manual capture is finished.

### Cool target changed by one app increment

The owner selected Cool and tapped + once from its stored 0°C target, reporting 0.5°C. A sample at 07:26:19.393 UTC first showed Mode=0 with R01=0.0 and Set_Temp=0.0. At 07:27:21.564 UTC, the capture showed R01=0.5 and Set_Temp=0.5 with Mode=0, Power=0, Power_State=0, O07=0, Online and fault false. R02 remained 32.0 and R03 remained 30.0. This controlled change identifies R01 as the observed Cool target field and establishes a 0.5°C app increment at this value. The app-driven setting was reflected by the API despite the previously reported R01 metadata range of 8–35°C. That metadata cannot be treated as an established acceptance boundary; the full supported range and safe operating meaning of these low targets remain unknown. No API command was sent by the observer. Restoration of Cool's stored target to 0°C is pending the next owner-assisted step.

### Cool decrement jumped to the reported minimum

When asked to tap − once from 0.5°C, the owner reported that the app target jumped to 8°C rather than returning to 0°C. At 07:29:25.157 UTC, the capture confirmed R01=8.0, Mode=0, Power=0, O07=0, Online and fault false. R01 metadata remained 8–35°C, R08 remained 8.0, R09 remained 35.0, R02 remained 32.0 and R03 remained 30.0. Set_Temp was still 0.5, another observed disagreement between the display alias and the mode-specific target.

The jump is consistent with minimum enforcement on decrement, but these observations cannot establish whether the app, cloud or device applies that rule. The preceding 0 → 0.5 increment and subsequent 0.5 → 8 decrement are asymmetric; neither proves that zero is a supported normal operating target. The original Cool target of zero was **not restored**. No corrective API write was attempted to force it below the reported minimum. The next restoration step is to select Heat with its preserved 32°C target, retaining power Off; Cool's stored target will remain 8°C unless separately changed. This behavior must be documented and represented without silently rewriting out-of-range readings or assuming all app buttons enforce identical bounds.
