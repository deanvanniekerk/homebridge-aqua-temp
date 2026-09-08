# Aqua Temp protocol discovery

Updated 2026-09-08 for [issue #2](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues/2). **Discovery remains incomplete; the device profile is not approved for controls.** Authentication, shared discovery, selected sensor readings and the app power-state mapping are established. Compressor semantics and a reliable write contract remain unresolved.

The final live observation restored the owner's original configuration: **app Off, Heat mode, target 32°C, cloud ONLINE**. No live experiment is active. This document describes observed vendor behavior, not an official API guarantee.

## Evidence and scope

The unit is an AstralPool / Fluidra Waterlinx **BOOSTi-INV-HP-40**, with cloud model **PASRW040-P-BP4II-C** and `wifiSoftwareVer: "V1.2"`. The Wi-Fi version is not established to be controller firmware. The exact installed Aqua Temp app version and full controller parameter manual remain unavailable.

| Source | Supported conclusion | Limit |
| --- | --- | --- |
| Owner's nameplate, app screenshots and live account observations | Customer/internal model match; inlet/outlet/ambient readings; Heat selection; app Off/On; compressor Standby and later 38% | Screenshots are not synchronized device measurements or complete parameter definitions |
| [Fluidra catalogue](https://fluidra.co.za/wp-content/uploads/2023/08/Fluidra-Catalogue-DIGITAL.pdf), Connected Heat Pumps table | BOOSTi HP-40 family uses Aqua Temp for temperature/status and heating/cooling control | No exact wire codes, limits or firmware contract |
| [AquaTemp publisher policy](https://cloud.go-heating.com/en/user/privacy/AquaTempPrivacyPolicy.html) | LinkedGo provides AquaTemp; device sharing is intended to allow control | Does not prove a particular account's permissions |
| [Oasis/Sunlover Aqua Temp guide](https://sunloverheating.com.au/wp-content/uploads/2024/09/Oasis-AquaTemp-Module-Installation-and-Operation-Manual-2024.pdf), printed pp19–20 | Distinguishes inlet/outlet/target; documents accepted sharing and warns of competing logins | Another manufacturer's integration; not this unit's enums or current session contract |
| [Vendor public web client](https://cloud.go-heating.com/) | Service origin and web metadata-route leads | Administrator UI behavior is not a mobile API permission grant |

No old Homebridge Aqua Temp implementation, tests or assets were read, imported or translated. Public interoperability captures suggested bounded probes; the contract below relies on the owner's actual vendor responses and app comparisons. Public vendor assets were inspected as functional leads only. Raw traffic, credentials, account/device identifiers and source screenshots remain outside tracked files.

The [fixture index](../fixtures/protocol/README.md) describes sanitized allowlist projections, timestamps, placeholders and limitations. Ordinary reads used verified TLS, no redirects, a 20-second timeout and a 1 MB response limit; command experiments used a 10-second timeout. No measurement timestamps were obtained. Acquisition/request times are local observation times, not proof of device freshness.

## Account and transport contract

### Origin and working login

Successful account requests verified **`https://cloud.linked-go.com:449`**. The [vendor application bundle](https://cloud.go-heating.com/static/js/app.7459ff55db890192eed0.1788245013752.js) independently identifies that service origin for its web client.

| Operation | Observed request | Observed result |
| --- | --- | --- |
| Login | `POST /crmservice/api/app/user/login`; JSON `userName`, `password` as lowercase hexadecimal MD5 of UTF-8 password, `type: "2"` | HTTP 200; `error_code: "0"`, `isReusltSuc: true`, `objectResult` with `x-token`, `userId`, `user_id`, `user_type: "Customer"`, `accessKey`, `appId: "14"` |
| Authenticated read | `Content-Type: application/json; charset=utf-8`, `Accept: application/json`, returned token in `x-token` | The operations below succeeded without an `accessKey` or `sessionid` header |

This is a working request shape, not proof that every field is mandatory. The app ID was returned by the login response, not guessed or supplied in that request. The two user-ID aliases agreed in the captured login. See [login fixture](../fixtures/protocol/login.json). MD5 is an observed wire encoding; protect the digest like the password. Do not send credentials to fallback origins or invent a refresh endpoint.

### Errors and session recovery

A read with a deliberately invalid token returned **HTTP 200**, `error_code: "-100"`, `isReusltSuc: false`, `objectResult: null`; see [invalid-token fixture](../fixtures/protocol/invalid-token.json). Previously successful sessions also returned `-100` on later reads, including after switching to dedicated shared credentials. A new login restored read access in the observed attempts. These were manual probes, not a tested automatic recovery implementation.

The cause of repeated invalidation is unresolved: natural expiry, competing clients and token lifetime were not isolated. A dedicated account has not yet demonstrated contention-free operation. Validate the vendor envelope as well as HTTP status, share one in-flight login in the eventual client, and apply the bounded renewal/cooldown policy in [SPEC.md §5](SPEC.md#5-reliability-contract). Never replay an uncertain command merely because the session was renewed.

Historical error fixtures record anonymous legacy GET HTTP 400 (`could_not_read_json`), current CRM GET HTTP 405 (incorrect request method), and a legacy credential-bearing POST that returned HTTP 200 with `Error username or password` and `is_reuslt_suc: false`. Legacy attempts failed before the working CRM format was established; they do not prove that the owner's confirmed app password was wrong. Generic vendor `-1` is not a session-expiry constant. These historical legacy routes are not runtime fallbacks.

## Discovery, sharing and availability

All paths in this table use the verified origin, JSON POST and `x-token`. Account/app/device values come from the login or authorized discovery response.

| Path under `/crmservice/api/app/device/` | Observed body | Observed behavior |
| --- | --- | --- |
| `deviceList` | `userId`, `appId` | Initial account returned one matching heater. Dedicated shared account returned `[]`. |
| `getMyAppectDeviceShareDataList` | `toUser` = returned user ID, `appId: "14"`, `pageIndex: 1`, `pageSize: 100` | Dedicated shared account returned one accepted share matching the known `deviceCode` and both model names. Vendor spelling retained. |
| `getDeviceStatus` | `userId`, `appId`, `deviceCode` | Success `objectResult` with `status: "OFFLINE"` initially and `"ONLINE"` after reconnection, plus `isFault`/`is_fault` false. |
| `getDataByCode` | `userId`, `appId`, `deviceCode`, explicit `protocalCodes` array | Selected telemetry and metadata returned. Without selectors, an earlier read returned `[]`. Vendor spelling retained. |

The [accepted-share fixture](../fixtures/protocol/shared-device-list.json) and [shared telemetry](../fixtures/protocol/shared-telemetry.json) establish shared discovery and reads. The accepted-share route was suggested by a [public troubleshooting capture](https://github.com/radical-squared/aquatemp/issues/82), then independently verified against the owner's account. The empty primary list must not hide a shared accessory. Later target experiments also established server acceptance of shared-account target writes; this is not a universal permission guarantee.

Initial discovery included matching camel/snake aliases for device ID, code and product ID. The accepted-share response matched the previously known device code. Stable identity across renaming and account changes, cross-account device-ID equality, duplicate-list precedence, revocation, and multi-page behavior are untested. Null pagination metadata in one small response does not prove the absence of pagination. Product IDs are deliberately replaced in public fixtures; their placeholders cannot select a runtime profile.

The shared record's `reviewStatus: "0"`, `isLock: "0"`, `lockState: "1"` and null `authStatus` have no verified permission semantics. It also contains sensitive fields including `deviceSecret`, names, email, serial/radio and organization identifiers: never dump discovery bodies into logs. `protocalId` and `mainBoardVersion` were null. No sharing invitations, locks, permissions or registrations were changed by the assistant.

OFFLINE means cloud connectivity loss, not requested power Off or a safely stopped compressor. Conversely, the heater remained ONLINE with the app toggle Off. False fault flags while offline do not establish live health. A successful read or ONLINE response alone does not establish the age of returned parameter values.

## Telemetry and app comparison

A selected read returns entries containing `code`, `value`, `dataType`, `rangeStart`, `rangeEnd`, `tmJson` and `dataTypeAi`. Numeric values and limits are wire strings. Populated entries observed here generally have `dataTypeAi: "num"` and null `tmJson`; neither supplies enum labels, units, write permissions or step size.

Candidate selectors came from [captured interoperability responses](https://forum.iobroker.net/topic/54765/javascript-midas-aquatemp-poolheizung/154) and [app-related observations](https://github.com/radical-squared/aquatemp/issues/99), with a bounded supplemental T-series read during the activity investigation. Candidate selection is not a mapping. The values and types below come from this unit's observed [core](../fixtures/protocol/telemetry-core.json), [additional](../fixtures/protocol/telemetry-activity.json), and [transition](../fixtures/protocol/app-power-on.json) fixtures.

| Field | Observed value/type/range | Established meaning or unresolved limit |
| --- | --- | --- |
| `Power` | `ENUM`, range `0`–`1`; owner-operated app cycle read `0`→`1`→`0` | **0 = app Off, 1 = app On** for this unit. API power writes remain untested. |
| `Mode` | `1`; `ENUM`, range `0`–`2` | **1 = Heat**, corroborated by app selection. Cool/Auto values remain unverified. |
| `T02` | `20.5`; `TEMP` | Matches app **Inlet Temp. 20.5°C**; selected water reading. Not proof of bulk pool temperature when circulation stops. |
| `T03` | `21.0`; `TEMP` | Matches app **Outlet Temp. 21.0°C**. |
| `T05` | `36.0` initially; `TEMP`, range `-30`–`100` | Matches app **Ambient Temp. 36.0°C**. |
| `Set_Temp` | `32.0`; `TEMP`, range `0`–`99` | Initially matches app target; transient write/readback behavior below. Do not advertise this generic range as the valid setpoint range. |
| `R02` | `32.0`; `TEMP`, range `15.00`–`40.00` | Stronger candidate Heat-mode target; writes held during the bounded read window, while Set_Temp disagreed. Bounds enforcement and step remain unverified. |
| `R01` / `R03` | `0.0` / `30.0`; `TEMP`, ranges `8.00`–`35.00` / `8.00`–`40.00` | Other-mode meanings unverified. R01's value is outside its reported range; inactive/sentinel behavior unresolved. |
| `R08` / `R09` / `R10` / `R11` | `8.0` / `35.0` / `15.0` / `40.0`; `TEMP` | Candidate constraints, not verified active-mode write limits. See metadata in core fixture. |
| `T01` / `T04` | `28.0` / `29.5` initially; `TEMP` | Physical sensor meanings unverified. |
| `T07` / `T12` / `T14` / `T17` | Initially `1` / `0` / `236` / `0`; `DIGI1` | Units/scaling and activity meaning unverified. Later values changed near the app's 38% report. |
| `ModeState` / `H03` | `1` / `0`; `ENUM` | Neither is established as a heating/activity signal. |
| `2074`–`2077` | Each 16 zero bits; `BINARY` | Bit meanings unverified; preserve leading zeros. |
| `T1`, `T2`, `O01` | Empty values/types/ranges | Echoed selectors do not establish availability; never coerce empty strings to zero. |

Decimal formatting does not establish a half-degree writable step. TEMP labels do not independently prove Celsius; the sensor unit conclusion above comes from the owner's app comparison. Blank metadata or a plausible number cannot establish a sensor identity. Do not enable a profile solely because a server echoes the requested code.

### Truthful operating status

The owner clarified that the initial app toggle was **Off**, with mains power/Wi-Fi available and compressor **Standby**. This corrects an earlier ambiguous description of on/Standby. Switching On in the app produced Power 1 while the compressor still showed Standby, despite inlet 20.5°C and target 32°C. Thus requested power and temperature difference cannot establish active heating.

The app later displayed **Compressor Status: 38%**. After a session renewal, nearby API readings showed T07 22, T12 675 and T17 720; ModeState stayed 1 and H03 stayed 0. None establishes the percentage field or a conversion. The screenshot and API reads were not synchronized.

A supplemental T06/T08/T09/T10/T11/T13/T15/T16 read already showed Power 0 around the owner's subsequent Off action. Do not label it as a sample of the earlier 38% state. See [activity episode](../fixtures/protocol/compressor-activity-episode.json). Compressor activity, defrost, flow/protection and fault semantics remain unresolved; do not fabricate Heating or conceal unknown activity as Off.

## Controlled target experiments

The owner explicitly approved **32°C → 31°C → 32°C** on the selected heater using the dedicated shared account. Both sequences began ONLINE with Power 0, Mode 1 and both target fields 32.0. No power or mode commands were sent. The second selector was assessed after the first sequence finished with confirmed restoration; no automatic fallback/retry loop was used.

The observed command request is:

- `POST /crmservice/api/app/device/control`, JSON content type, returned `x-token` header.
- JSON `param: [{deviceCode: <selected heater>, protocolCode: <selector>, value: <absolute value string>}]`.
- Tested selectors: `Set_Temp` and `R02`; tested values: `"31.0"` and `"32.0"`.
- Every observed command returned HTTP 200, `error_code: "0"`, `isReusltSuc: true`, `objectResult: null`.

| Sequence | Readback | Restoration |
| --- | --- | --- |
| [Set_Temp](../fixtures/protocol/command-set-temp.json) | Initial read showed Set_Temp 31.0 and R02 32.0. Following a 3-second delay, Set_Temp was back at 32.0; a later read agreed. | One explicit Set_Temp 32.0 command, followed by three reads with both targets 32.0. |
| [R02](../fixtures/protocol/command-r02.json) | R02 read 31.0 across three reads separated by 5- and 10-second delays; Set_Temp stayed 32.0 throughout. | One explicit R02 32.0 command, followed by three reads with both targets 32.0. |

Power stayed 0 and Mode stayed 1 in every read. The owner confirmed seeing 31°C and the return to 32°C in the app, but did not identify which sequence caused that display change. This establishes an app-visible target change across the experiments, not which selector is authoritative or durable controller persistence. No implicit power-on was observed from this **app-Off** starting state. Behavior during active heating remains untested.

The transient Set_Temp result disproves a completion rule based solely on server success or one matching read. R02 is a stronger candidate, but a source-of-truth and settling rule must explain its disagreement with Set_Temp before enabling a HomeKit setter. Do not blindly write both fields, require immediate agreement, or retry an uncertain command to hide this uncertainty.

The later owner-operated app Off→On→Off cycle also preserved Heat and 32°C. A final read after the owner's Off confirmation verified ONLINE, **Power 0, Mode 1, Set_Temp 32.0 and R02 32.0**. The [power-transition fixture](../fixtures/protocol/app-power-on.json) records restoration. The assistant did not issue API power commands; app operation cannot prove their contract.

## Capability gate and next verification

| Issue #2 requirement | Established evidence | Remaining gate |
| --- | --- | --- |
| HTTPS/auth/session signals | Working CRM origin/login/token; observed invalid-session `-100`; bounded manual recovery | Expiry cause/lifetime and contention remain unknown; do not invent refresh behavior |
| Owned/shared discovery and permissions | Both list shapes, accepted share, shared telemetry and target-command acceptance | Multi-page/duplicate/revocation behavior and permission-denial semantics unknown |
| Sensor semantics and units | T02 inlet/water, T03 outlet, T05 ambient in Celsius corroborated by app | Telemetry freshness and further diagnostics remain unverified |
| Power/mode/activity enums | App Power 0=Off/1=On; Mode 1=Heat; app Standby distinct from power | **Compressor signal and Cool/Auto mapping unresolved** |
| Setpoint bounds/step and confirmation | Candidate ranges, two target experiments, transient acknowledgment/readback demonstrated | **Active-mode constraints, step and reliable authoritative target/readback unresolved** |
| Absolute controls and side effects | Shared target request shape accepted; no power/mode change in Off-state experiment | **API power/Heat operations and target behavior while On unresolved** |
| Sanitized observed fixtures | Timestamped projections, explicit redaction/limits, no invented success | Evidence must not be promoted into unsupported runtime behavior |

Public vendor metadata research did not resolve these gates. Its web product lookup (`/cloudservice/api/product/queryProductById`) rejected the mobile token with HTTP 401; no administrator-auth workaround or broad enumeration was attempted. Public web parameter descriptions are loaded dynamically and cannot define this profile from generic UI labels. A supported mobile metadata route or exact device/app parameter evidence is needed.

The next useful evidence is **read-only app parameter/status pages showing codes, labels, units and permitted steps**, plus the installed app version. An owner-supplied capture of the official app's relevant requests can also establish the profile; raw traffic must remain private. After those mappings are known, any additional actuation requires an agreed device/action/restoration procedure. Previous approval covered the completed target test, not arbitrary power, mode or range-boundary experiments.

For unsupported app-selected modes, retain unambiguous readings and use the [SPEC.md §4](SPEC.md#4-apple-home-behavior) communication/error policy for unrepresentable state; never switch back to Heat during discovery or polling. A verified non-Heat mode can be treated as unsupported without guessing its label, but absence of reliable current activity remains a separate blocker.

Issue #2 is **not complete** while its core activity and write contracts are unresolved. This evidence can be committed as progress, but must not produce a PR claiming `Closes #2` or unblock implementation as if discovery passed. Resolving a missing core feature requires evidence or an explicit product-scope decision, not a fabricated mapping.
