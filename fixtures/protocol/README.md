# Device-model evidence

The initial three allowlisted observations were created during the owner's authorized issue #2 investigation. They are copied from this project's evidence commit `cf07e8e`, not from another integration. Each JSON file retains its own date, provenance, sanitization and limitations. Account/device/product IDs are placeholders; no raw captures or credentials are included.

`deviceList.json` and `shared-device-list.json` establish the matching device code across owned and shared records, despite different account-scoped IDs. `telemetry-core.json`, together with the owner's app comparison documented in the [preserved protocol investigation](https://github.com/deanvanniekerk/homebridge-aqua-temp/blob/cf07e8e/docs/PROTOCOL.md), supports the inlet temperature and requested Off/Heat state. It does not establish activity, target step or authoritative command completion.

Tests that modify these observations are explicitly synthetic fault cases. Fixtures are excluded from the npm package.

`telemetry-status-parameters.json` is a later original read-only observation following owner-supplied app 2.2.2 status pages. It projects numeric-or-empty values and allowlisted metadata; null indicates metadata/value omitted by that projection, not a raw vendor null. [APP_PARAMETERS.md](../../docs/APP_PARAMETERS.md) records the app labels and comparison limitations, including app-visible O/S states that this endpoint returns empty.
