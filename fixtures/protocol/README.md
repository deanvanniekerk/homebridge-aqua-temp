# Protocol fixtures

These are allowlisted, sanitized observations from this project's owner-authorized Aqua Temp investigation, not another integration. Each JSON file records provenance and limitations. Account/device identifiers are placeholders; raw captures and credentials are excluded. Tests that alter fixtures create synthetic cases. Fixtures are not shipped to npm.

Owned/shared lists establish the common device code despite different account-scoped IDs. Telemetry supports the mappings in [architecture](../../docs/ARCHITECTURE.md). In `telemetry-status-parameters.json`, null metadata can mean omission by the projection rather than a vendor null. App-visible O/S switch values were empty in the API: do not coerce them to zero or infer flow polarity. Compressor frequency is not a percentage, and positive frequency does not prove heating rather than defrost.
