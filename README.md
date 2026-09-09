# Aqua Temp for Homebridge

Control compatible Aqua Temp heat pumps from Apple Home through Homebridge.

- Off, Heat, Cool and Auto, with a separate retained target for each mode.
- Inlet water temperature on the thermostat.
- Optional inlet, outlet and ambient temperature sensors, each disabled by default.
- Shared-account discovery, bounded cloud retries and automatic read recovery.

**Release channel: stable.** Hardware testing has covered only AstralPool `PASRW040-P-BP4II-C` / `BOOSTi-INV-HP-40`. Other models are attempted with a console warning, using the same protocol mappings; compatibility is unverified. Cloud access is required. A sustained hardware soak has not been recorded; see [compatibility and limitations](docs/COMPATIBILITY.md).

## Install

Use **Node 22.23.2 or later in the 22.x line** and **Homebridge 2.4.0 or later in the 2.x line**. Back up Homebridge before changing plugins.

Install `@deanvniekerk/homebridge-aqua-temp-connect` from Homebridge UI → Plugins, then follow the [setup guide](docs/INSTALLATION.md). Check the exact package name before installing.

Configure the Aqua Temp account, restart the plugin's child bridge and pair it with Apple Home. A dedicated account with the device shared to it is recommended when the phone app and plugin compete for a session. See [setup and migration](docs/INSTALLATION.md) and [configuration](docs/CONFIGURATION.md).

## Using the thermostat

Switch Off before selecting a different mode. Selecting Heat, Cool or Auto requests On in that mode; it does not change the retained target. Auto uses a single target.

| Mode | Home target range | Step  |
| ---- | ----------------- | ----- |
| Heat | 15–38°C           | 0.5°C |
| Cool | 10–35°C           | 0.5°C |
| Auto | 10–38°C           | 0.5°C |

Targets outside Home's range can still be set in Aqua Temp. The plugin never silently clamps them; an unrepresentable target can make the thermostat unavailable until changed in Aqua Temp. After a timeout, check the app before retrying: the command may have applied late.

Home's heating/cooling indicator estimates demand when compressor activity is unknown. It is not proof that the compressor is running; delays, defrost and protection cannot currently be distinguished. Unknown compressor activity alone does not disable controls. Stale/offline core readings remain unavailable.

## Support and contributing

Report the plugin/runtime versions, device model, expected behavior and a sanitized diagnostic report in a [GitHub issue](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues). Never include account credentials, tokens, pairing codes or raw device identifiers.

- [Contributing](CONTRIBUTING.md)
- [Architecture and protocol boundaries](docs/ARCHITECTURE.md)
- [Validation status](docs/VALIDATION.md)
- [Release process](docs/RELEASING.md)

An original, independent implementation under the [MIT license](LICENSE). Not affiliated with Aqua Temp, AstralPool, Fluidra, Apple or SONOFF.
