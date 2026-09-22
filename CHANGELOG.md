# Changelog

Release notes for `homebridge-aqua-temp-connect` live here. The release workflow publishes the
section matching `package.json` to GitHub, so the npm package, tag and GitHub release use the same
version and notes.

## [1.0.3] - 2026-09-22

### Changed

- Organize TypeScript source by cloud, device and Homebridge responsibility, with colocated Vitest
  tests and a package-content check.
- Use Zod for runtime configuration and vendor-data validation, and Biome for formatting and linting.
- Preserve the existing cloud protocol, accessory identities and control behavior.

## [1.0.2] - 2026-09-16

### Changed

- Improve Homebridge plugin search results for spaced `aqua temp` queries by publishing each term
  as a package keyword.
- Add a credential-redacted Homebridge UI configuration screenshot to the README and published
  package.

## [1.0.1] - 2026-09-16

### Changed

- Move the public npm package from `@deanvniekerk/homebridge-aqua-temp-connect` to the unscoped
  `homebridge-aqua-temp-connect` name while preserving existing accessory UUIDs.
- Declare HAP transport support and support both Node 22 and Node 24 for Homebridge verification.
- Do not start cloud monitoring without account configuration, and remove stale cached accessories
  after configuration is removed.
- Create each future Git tag and GitHub release automatically from this changelog after npm
  publication.

### Migration

- Back up Homebridge, disable the Aqua Temp child bridge, uninstall the old scoped package and
  install `homebridge-aqua-temp-connect`. Keep the existing `AquaTemp` platform configuration and
  do not run both package names at once.

## [1.0.0] - 2026-09-09

### Added

- Stable Aqua Temp heat-pump control with Off, Heat, Cool and Auto modes and retained targets.
- Optional inlet, outlet and ambient temperature sensor accessories.
- Shared-account discovery, bounded cloud retries, automatic recovery and sanitized diagnostics.
- Untested-model fallback with an explicit warning while preserving protocol validation.

## [0.1.0-beta.1] - 2026-09-09

### Added

- First public beta with guarded Heat control, temperature reporting and Homebridge child-bridge
  installation guidance.
