# Device-model implementation status

The model implements a limited Heat control profile for the exact observed unit. Readings, command constraints and unknown states are explicit. This is development/prerelease support, not vendor certification or a claim to decode every operating state.

Discovery uses `deviceCode` (or an agreeing `device_code` alias) as identity, preserving the exact string. The same device code was observed through owned and shared discovery. Account-scoped IDs, owner names, shared permissions and product placeholders cannot select writable capabilities. Duplicate identity with conflicting profile metadata becomes unsupported; malformed records are counted without exposing them. A malformed list fails the discovery boundary rather than pretending no devices exist. Identity stability after physical device replacement or vendor renaming remains a hardware validation concern.

The exact observed model pair `PASRW040-P-BP4II-C` / `BOOSTi-INV-HP-40` selects the established reading mappings: T02 inlet water, T03 outlet and T05 ambient in Celsius; Power 0/1 is requested app Off/On; Mode 1 is Heat. A fault flag is a generic reported fault, never a guessed flow fault or defrost state. Missing, malformed, duplicate and inconsistent fields remain unavailable. There is no temperature-to-activity inference.

`observedAtMs` is caller-supplied acquisition time; `measuredAtMs` remains null because discovery obtained no verified device timestamp. Freshness policy belongs to the coordinator. Offline responses immediately invalidate current readings. Celsius fields must be decimal finite strings with TEMP metadata; supplied sensor ranges are validated but never promoted to writable bounds. Blank sensor ranges are accepted as in the observed inlet response. Values below absolute zero are invalid. Further HAP limits belong to the adapter.

R02 is exposed as `reportedTargetCelsius` only while the reported mode is Heat. Owner-confirmed app changes at 32.5°C, 15°C and 40°C followed R02 while Set_Temp retained 32°C; restoration also followed R02. The decoder therefore no longer requires agreement with Set_Temp or requests it during normal polling. Missing, invalid or duplicate R02 readings remain unavailable, with no generic-target fallback. This is a reported target reading, not a guarantee of physical heating or a completed write-confirmation contract. The supported control subset and its evidence limits are defined below.

## Additional app and cloud comparison

On 2026-09-08 the owner supplied Aqua Temp version 2.2.2 and a device screen showing Online, Heat, a 32°C target, 22°C inlet, 23.5°C outlet, 22°C ambient and compressor Standby. A subsequent bounded read-only cloud observation confirmed Online, Heat, a 32°C reported target and 22°C inlet; it reported Power=0 (Off). The app's blue power icon alone does not establish the requested power state. This comparison supports cloud reachability while the requested power is Off; it does not identify an activity parameter or establish command behavior. No setting writes were made during this comparison. Screenshots and device/account identifiers remain private.

## Owner-authorized power round trip

Following separate owner approval on 2026-09-08, a bounded experiment used the original cloud client against the single discovered supported device. It required an Online/Off/Heat/32°C baseline, sent one absolute `Power="1"` command, read back state, then sent one absolute `Power="0"` command and checked restoration. Both commands used POST `/crmservice/api/app/device/control` with `param: [{ deviceCode: <private identity>, protocolCode: "Power", value: "1" | "0" }]`. No mode or temperature command was sent, and neither power command was replayed.

| Observation                                     | Connectivity | Requested power | Mode | Reported target |
| ----------------------------------------------- | ------------ | --------------- | ---- | --------------- |
| Baseline                                        | Online       | Off             | Heat | 32°C            |
| First read after accepted On command            | Online       | On              | Heat | 32°C            |
| First read after accepted restoring Off command | Online       | Off             | Heat | 32°C            |

Each post-command observation had a ten-second deadline; both matched on the first read. Restoration was also scheduled for an uncertain On response, but that failure path was not exercised. The normalizer at the time required agreement between Set_Temp and R02, so both agreed throughout these observations. This establishes the observed absolute power-write behavior and unchanged target in this one Heat-mode round trip. It does not establish physical compressor actuation, a general vendor convergence guarantee, behavior in other modes, or delayed target side effects. Final cloud-confirmed state was Online/Off/Heat/32°C.

## Owner-assisted manual target round trip

On 2026-09-08, after an Online/Off/Heat/32°C baseline, the owner tapped the app's target + button once and reported 32.5°C. A read-only cloud sample at 18:13:15.168Z returned Power=0, Power_State=0, Mode=1, R02=32.5 and Set_Temp=32.0. R10=15.0 and R11=40.0 were also observed, but their values do not independently establish writable bounds. The conservative target normalizer at the time reported a conflict between the two target fields; the later decoder correction uses R02 directly in Heat mode.

The owner then tapped minus once and confirmed restoration. The read-only cloud sample at 18:14:32.008Z confirmed Online, Power=0, Power_State=0, Mode=1, R02=32.0 and Set_Temp=32.0. The manual 32→32.5→32°C round trip is complete, with power Off throughout the observed samples.

This establishes a 0.5°C app increment/decrement at these adjacent values and shows R02 following the owner-confirmed change and restoration while Set_Temp held the preceding target in the intermediate sample. It does not establish the full writable range, a global increment rule or a convergence deadline. No API write was made during this test.

## Owner-assisted running and shutdown observations

The owner switched the unit On at the unchanged Heat/32°C target and subsequently reported that the homepage still displayed Standby. A read-only cloud observation at 2026-09-08T18:21:02.753Z returned Online, Power=1, Power_State=1, Mode=1, Set_Temp=32.0, R02=32.0 and no generic reported fault. O07 (app-labelled compressor output frequency) was 52; O08 (compressor current) was 3.2; T28 (target frequency) was 52. Inlet T02 was 21.0°C and outlet T03 was 22.5°C. O01 and S03 remained empty. T26 was also 52, but its bit/field semantics remain unknown; no mapping is inferred from its matching value.

The owner subsequently reported the homepage compressor status as 61%, then switched the unit Off. The next cloud observation at 18:23:35.729Z showed requested Power=0 while Power_State=1, O07=52, O08=3.2 and T28=52 still held running values. Mode remained 1 and both target fields remained 32.0. These fields are not an atomic state snapshot, and requested Off must not be treated as proof of immediate compressor stop.

At 18:24:32.892Z, a subsequent read showed Power=0, Power_State=0, O07=0, O08=0.1 and T28=0, with Online/Heat/32°C and no generic reported fault. The same values were observed at 18:24:44.608Z. Off and the inactive telemetry baseline were therefore restored. The gap between samples does not establish the actual shutdown delay or a universal settling deadline.

This establishes an owner-observed running episode and nonzero compressor-frequency/current telemetry after manual On, followed by a return to the inactive baseline after manual Off. The 61% report and 52Hz samples are not simultaneous enough to establish a percentage conversion formula; the frequency is not a percentage. No defrost, flow fault or protection condition was induced or decoded, and no heating/defrost distinction is established by these samples. No API commands were sent during this manual test.

## Owner-assisted Heat target limits

The owner reduced the target with the app's minus control until the app allowed no lower value and reported 15°C. A read-only sample at 2026-09-08T18:58:06.211Z confirmed Online, Power=0, Power_State=0, Mode=1, O07=0, R02=15.0 and Set_Temp=32.0. R10=15.0 and R11=40.0 were also returned. This independently corroborates the app's 15°C lower Heat target limit and again shows R02 following the app while Set_Temp retains 32°C.

The owner then increased the target to the highest app-allowed value and reported 40°C. At 19:00:12.308Z a read-only sample confirmed Online, Power=0, Power_State=0, Mode=1, O07=0, R02=40.0, Set_Temp=32.0, R10=15.0 and R11=40.0. The observed Heat target range is therefore 15–40°C for this unit's current configuration, supported by owner-observed app limits and corresponding R02 values, not just unlabelled range metadata. The earlier adjacent-value test established a 0.5°C app increment/decrement. These observations do not establish bounds for other modes or configurations, or prove every possible fractional API write. The owner then restored 32°C; a subsequent read-only check confirmed Online, power Off, Heat mode and an agreed 32°C target under the original normalizer. The limit test is complete. No API writes were made during the limit tests.

## Supported control subset and limitations

The owner requested completion of issues #5, #7 and #9 within reason, explicitly accepting a functioning but limited plugin and documented unknowns. This delivery enables the following subset without additional live device writes:

- Exact model pair only, while valid telemetry reports Heat (`Mode=1`), power and an R02 target. Unknown profiles and modes cannot receive commands.
- Heat target commands write only absolute `R02` values from 15–40°C on a 0.5°C grid. The app limits and adjacent half-degree steps were observed. Earlier API experiments accepted integer R02 writes and showed persistent 31→32°C readback. Combining that decimal-string wire contract with the app's half-degree grid is an engineering assumption: a fractional API write has not been confirmed on the physical device. It is tested against the fake cloud and must match R02 readback before the setter succeeds. No claim is made that every grid point was physically tested.
- Off/Heat commands write only `Power=0` or `Power=1`. Heat means enabling an already-Heat device. No Mode command is implemented, and the plugin cannot switch a Cool/Auto device to Heat. Select Heat in Aqua Temp first. Both absolute power values have the owner-authorized API round-trip evidence above.
- Every dispatch re-reads status/telemetry within the original eight-second command deadline. A changed mode, offline state or invalid core reading prevents the write. On and target changes require an explicitly clear generic fault flag; a supported Off request remains available during a reported fault.
- After one transport-accepted write, the coordinator reads state once within that same deadline. Targets require the actual R02 value; power requires the requested state (and Heat mode for On). Mismatch, timeout or uncertain acknowledgment is an error, never an optimistic success. Later ordinary polling adopts any delayed result without replaying the command. This intentionally bounded policy can report failure for a slow command that eventually applies; it is not a vendor convergence guarantee.
- O07=0 (observed datatype `DIGI1`, or legacy nullish metadata) with valid Heat/power fields and an explicitly clear fault flag is the observed inactive baseline and maps to idle. Positive, absent, malformed or duplicate frequency remains unavailable. Positive frequency does not distinguish heating from defrost, and requested Off does not prove a stopped compressor. No compressor percentage, defrost, flow polarity or protection encoding is inferred.

Cloud telemetry fields are not atomic. A mode can still change after preflight; this API supplies no conditional-write primitive. Commands therefore never include an implicit mode write. Readback confirms reported settings, not physical heat production, future side effects or every firmware variant. Missing core fields may disable controls until a valid sample returns. Generic fault information is not a flow/defrost diagnosis.

Physical validation is tracked in #10. Installation and pairing have been exercised; physical fractional API writes and sustained operation remain pending. Unknown activity deliberately produces a HAP communication error, and owner screenshots confirm that Apple Home marks the whole tile unavailable in that situation. Npm distribution remains in #11. These limitations are not hidden prerequisites for closing the implemented local model, adapter and automated-validation issues.

The [preserved protocol investigation](https://github.com/deanvanniekerk/homebridge-aqua-temp/blob/cf07e8e/docs/PROTOCOL.md) records the original wire observations. No previous plugin implementation was copied.

On 2026-09-09 the installed-plugin diagnostic observed O07 string `0` with datatype `DIGI1` and both boolean fault aliases false. The prior sanitized fixture's null metadata represented projection omission, not proof that the vendor omitted the datatype. Rejecting DIGI1 made this inactive sample unavailable. The decoder now admits this observed zero-frequency representation; no positive-frequency scaling or heating/defrost mapping is inferred. Apple Home was observed to mark the whole thermostat No Response when current activity fails, even while displaying water temperature. See [physical validation](VALIDATION.md#apple-home-failure-and-diagnosis-2026-09-09).
