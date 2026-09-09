# Architecture

The plugin has no runtime dependencies. Homebridge supplies HAP; TypeScript and test tools are development dependencies.

| Module                                                  | Responsibility                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cloud-client.ts`, `cloud-http.ts`, `cloud-protocol.ts` | Validated HTTP envelopes, authentication, deadlines and bounded read retry               |
| `device-model.ts`                                       | Device identity, model evidence, strict telemetry decoding and absolute command encoding |
| `gateway.ts`                                            | Owned/shared discovery, profile reads and fresh command preflight                        |
| `coordinator.ts`, `command-queue.ts`                    | Account polling, freshness, per-device serialization and readback reconciliation         |
| `platform.ts`                                           | Homebridge lifecycle, selection and stable accessory identities                          |
| `thermostat.ts`, `basic-accessory.ts`                   | HAP controls and independent read-only temperature sensors                               |
| `configuration.ts`, `diagnostics.ts`                    | Runtime/schema validation and sanitized bounded reporting                                |

## Transport

The vendor origin is `https://cloud.linked-go.com:449`. Login uses `/crmservice/api/app/user/login`, `userName`, the lowercase MD5 of the UTF-8 password and `type: "2"`. MD5 is required wire encoding, not local credential storage. Authenticated calls use `x-token`. Success requires string `error_code="0"`, boolean `isReusltSuc=true` and `objectResult`; the client returns that result as unknown for the gateway to validate. Vendor code `-100` indicates session invalidation; generic `-1` is not interpreted as expiry.

Requests have a 10-second deadline, 64 KiB request and 1 MiB response limits, TLS verification and no redirects. Reads have a 30-second total budget and at most two transient retries. Session expiry permits one renewal/read replay. Login is shared across callers. Writes are never replayed.

Transient failures use account backoff from 5 seconds to 5 minutes with jitter; longer Retry-After delays are honored. Invalid credentials/account permission denial pauses traffic until reconfiguration/restart. Repeated session invalidation enters a five-minute cooldown. Failures expose fixed categories, never raw vendor messages, credentials or headers. Closing aborts requests and waits.

## Device decoding

Discovery identity is `deviceCode`, with an agreeing `device_code` alias permitted. Owned/shared duplicates collapse; missing, unrecognized or conflicting model metadata is marked untested for diagnostics and a startup warning. Shared discovery uses 100-record pages, capped at 100 pages/10,000 records. Multi-page end behavior remains a synthetic-tested assumption; incomplete discovery does not delete devices.

All selected devices use the same Aqua Temp protocol mappings. The model profile records testing evidence only; it does not gate telemetry, controls or accessory registration. The platform warns once per selected untested device per startup without logging raw discovery metadata. T02/T03/T05 are inlet/outlet/ambient Celsius; `Power` 0/1 is requested Off/On. Mode and target mappings are in [compatibility](COMPATIBILITY.md). R01/R02/R03 are authoritative per-mode targets; the generic `Set_Temp` alias can lag and is not used as fallback. Missing, duplicate, malformed or contradictory fields stay unavailable. Acquisition time is known; a reliable device measurement timestamp is not.

O07 zero with valid mode/power and clear fault status maps to idle. The observed zero representation permits `DIGI1` or omitted legacy metadata. Positive frequency stays unknown. Empty O/S switch fields do not become zero; fault flags are generic and do not establish flow polarity or defrost. Sanitized observations live under `fixtures/protocol`; synthetic variants are tests, not additional physical evidence.

## Scheduling and commands

One account loop has a 30-second cycle budget and a configurable completion-to-next-start interval (default 60 seconds). A sample expires after three intervals. Transient read failures can retain a fresh sample; offline/auth/protocol failures have distinct states. A freshness timer updates subscribers even while backoff delays polling. Subscribers receive the latest snapshot rather than an unbounded backlog; the limit is eight. Device failures do not stop siblings.

Each device admits four commands including the active one, serialized with an eight-second deadline from admission through preflight, authentication and readback. An active failure cancels queued commands. Late results cannot complete an expired setter or overwrite newer revisions; ordinary polling reconciles them. Shutdown never saves/replays commands.

Targets bind the selected mode to its own field and supported grid. Explicit mode changes require Off, confirm the new mode, still-Off power, valid retained target and clear fault before requesting On. There is no vendor atomic/conditional write. One matching readback confirms reported settings; mismatch remains an error even if it converges later. Off can remain writable with unknown mode/target when requested power is available.

## Homebridge presentation

Cached accessories receive handlers before fresh data arrives; stale cache values are not treated as telemetry. Context contains device identity, role and local display-unit preference only. Display-unit changes do not change cloud Celsius values. Recognized excluded/disabled accessories are removed after launch; transient discovery omissions do not remove them. Retired development Power/Water identities are also removed after cache attachment.

Getters never initiate network traffic. HAP target limits intersect the profile grid with 10–38°C and reject unrepresentable values rather than silently clamping. Off/Heat/Cool/Auto reflects confirmed requested power/mode. Current activity is a display policy: requested Off, known idle or fault displays idle; when On with unknown activity, mode and water/target difference estimate demand. The domain state remains unknown and the estimate never triggers commands.

HAP `/accessories` serialization can substitute defaults for failed getters. Use `/characteristics` statuses to distinguish actual readings from metadata fallbacks. Tests exercise real HAP handlers and packed Homebridge processes against loopback fake services; no test transport settings ship in the plugin.
