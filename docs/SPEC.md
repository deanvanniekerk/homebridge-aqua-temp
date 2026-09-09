# Product contract

Aqua Temp for Homebridge exposes Aqua Temp cloud-connected heat pumps to Apple Home. It is an independent implementation; source, tests and assets from other integrations must not be copied.

## User behavior

- One thermostat per selected device, with Off/Heat/Cool/Auto and a single mode-specific target.
- Only inlet, outlet and ambient temperature sensors are optional accessories; each defaults false.
- Untested models log a startup warning and use the existing protocol mappings; model names never block discovery or controls.
- A missing capability must not stop account polling or other accessories. Unsupported core inputs can reject dependent controls.
- Unknown measured compressor activity stays unknown in the domain model. Home may estimate demand for its required current-state display; never use the estimate for commands or claim physical operation.
- Commands require fresh state, bounded execution and matching reported readback. Never replay writes after failure, startup or recovery.
- Explicit mode changes require Off first. Keep mode and power distinct; report uncertain outcomes without optimistic success.

Current ranges and evidence boundaries are in [compatibility](COMPATIBILITY.md), configuration in [configuration](CONFIGURATION.md), and module contracts in [architecture](ARCHITECTURE.md).

## Distribution and migration

Use a distinct verified npm identity, compiled ESM entry point, MIT license and configuration schema. Keep private evidence and development dependencies out of the runtime artifact. Test clean installation/removal on the declared matrix.

Document account sharing, backup, disabling the old integration, pairing, automation recreation and rollback. New accessory identity does not preserve old Home automations. Use least-privilege authenticated publishing with provenance where supported; never commit tokens.

A publication requires a separate maintainer release decision. Stable releases use the latest dist-tag; prereleases use beta. Document actual-host testing and outstanding evidence gaps without implying that a release channel proves sustained reliability. See [release process](RELEASING.md) and [validation](VALIDATION.md).
