# Protocol evidence fixtures

These are allowlisted projections of server observations for [protocol discovery](../../docs/PROTOCOL.md), acquired on 2026-09-08. They are not complete response envelopes or an approved device profile.

| File | Evidence |
| --- | --- |
| [login.json](login.json) | Successful CRM login with `userName`, MD5 password digest and type `2`; server returns app ID `14` and token |
| [deviceList.json](deviceList.json) | Authenticated account discovers one matching customer model, offline |
| [getDeviceStatus.json](getDeviceStatus.json) | Authenticated read reports `OFFLINE` and false fault flags |
| [getDataByCode.json](getDataByCode.json) | Authenticated read without parameter selection returns an empty array; no telemetry fields established |
| [status-online.json](status-online.json) | After connectivity was restored and the session renewed, status returns `ONLINE` |
| [telemetry-core.json](telemetry-core.json) | Explicit selectors return values, data types and ranges; physical meanings and write constraints remain unverified |
| [telemetry-activity.json](telemetry-activity.json) | Additional temperature, numeric, enum and bit-string observations; activity semantics remain unverified |
| [shared-owned-list-empty.json](shared-owned-list-empty.json) | Dedicated shared account's primary device list is empty |
| [shared-device-list.json](shared-device-list.json) | Accepted-share route returns the matching heater, online |
| [shared-telemetry.json](shared-telemetry.json) | Dedicated shared account successfully reads selected telemetry |
| [command-set-temp.json](command-set-temp.json) | Approved Set_Temp 32→31→32 experiment: initial 31 read reverted; restoration verified |
| [command-r02.json](command-r02.json) | Approved R02 32→31→32 experiment: R02 held 31 while Set_Temp stayed 32; restoration verified |
| [app-power-on.json](app-power-on.json) | Owner-operated app Off→On→Off: Power 0→1→0; mode/target preserved and restoration confirmed |
| [compressor-activity-episode.json](compressor-activity-episode.json) | App later reported 38%; nearby API activity values changed, but percentage mapping remains unverified |
| [invalid-token.json](invalid-token.json) | Read with a deliberately invalid token returns HTTP 200 with vendor `-100` and false success flag |
| [legacy-login-get-error.json](legacy-login-get-error.json) | Anonymous legacy GET returns HTTP 400 |
| [crm-login-get-error.json](crm-login-get-error.json) | Anonymous current CRM GET returns HTTP 405 |
| [legacy-login-rejected.json](legacy-login-rejected.json) | Initial legacy POST returns HTTP 200 with vendor failure; this failed hypothesis precedes the successful CRM login |

Each file records acquisition time (or explicitly identified file-time approximation), URL, request shape, HTTP status/content type, retained fields and limitations. Command-sequence fixtures contain ordered events with client request-start timestamps; these are not device measurement timestamps. Requests validated TLS and did not follow redirects. The two command-sequence fixtures record two sequences of the owner-approved target test and restoration; the assistant sent no power or mode commands. The owner-operated power cycle is recorded separately. The invalid-token input is deliberately synthetic, but its response is observed. All fixture payloads are labeled `sanitized-observation`; no vendor-success or telemetry values have been invented.

Account and device references are replaced with stable placeholders such as `ACCOUNT_1` and `DEVICE_CODE_1`. Token and access-key placeholders preserve their observed presence and string type without exposing values. Product IDs are replaced too; their placeholders cannot select a device profile. Passwords and digests are omitted entirely. Other omitted fields include names, house identifiers, serial/radio identifiers and free-form messages. Omission from a projection does not mean a field was absent from the original response.

These fixtures establish working authentication and narrowly scoped reads. Shared-account read access, selected app-to-API sensor comparisons and the app Power 0/1 read mapping are established. Target-command acceptance and bounded readback are recorded, with owner confirmation of app-visible change/restoration. Natural session expiry, full activity enums, authoritative command completion and other write permissions remain unresolved. A manual single-login recovery was observed; automatic plugin recovery has not been implemented or tested. `OFFLINE` is connectivity, not power Off. Never interpret false fault flags as fresh health while offline or use the generic `-1` code as an expiry constant.
