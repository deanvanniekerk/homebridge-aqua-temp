# Aqua Temp for Homebridge

An independent Homebridge plugin project for Aqua Temp connected heat pumps, starting with an AstralPool BOOST-i-INV-HP-40 used at home.

**Status: limited development/prerelease plugin. Reads and confirmed target/On/Off commands are implemented for the observed BOOSTi-INV-HP-40 profile. No npm release or actual iHost/Apple Home certification is available.**

The local development build exposes Off, Heat, Cool and Auto through a HomeKit Thermostat. Each mode retains its own target. HomeKit target ranges are Heat 15–38°C, Cool 10–35°C and Auto 10–38°C, in 0.5°C steps. Device targets outside those ranges remain available through Aqua Temp; they are never silently clamped or changed by the plugin. An unrepresentable target can make the Home thermostat unavailable.

Switch Off before selecting a different mode in Home. An explicit mode selection confirms the vendor mode while Off, then requests On; it never changes a running unit's mode or changes its stored targets. Heat/Cool/Auto controls have automated tests and component-level live protocol evidence. The earlier expanded build completed an Apple Home Auto round trip; the latest changes and remaining end-to-end validation are handed to the owner. Auto uses the device's single retained target, with no invented heating/cooling thresholds.

Writes require fresh state and matching readback. A timeout or unconfirmed result can mean the setting applied later: check the app before trying again. Startup and recovery never replay commands. Fractional Heat target writes have been confirmed in the app during iHost testing. Idle can be reported from zero compressor frequency; active heating, defrost and flow/protection states cannot yet be distinguished. Unknown compressor activity does not block the thermostat. Home displays Off when requested power is Off; while On with unknown activity, its heating/cooling indicator estimates demand from mode, water and target temperatures. This indicator is not proof of compressor operation, and can differ during delays or protection. Known inactivity or a reported fault displays idle. Stale/offline core readings still return communication errors. The only optional accessories are Inlet Temperature, Outlet Temperature and Ambient Temperature sensors, each disabled by default. See [configuration options](docs/CONFIGURATION.md#optional-accessories). Their actual Apple Home presentation remains unverified. See the complete [support boundary](docs/DEVICE_MODEL.md#supported-control-subset-and-limitations).

Homebridge 2.4.0+ (2.x) and Node 22.23.2+ (22.x) are required. Use a host with these supported runtime versions; the validation iHost container has been upgraded. For local development, build an installable tarball with `npm ci` then `npm pack`, and install that tarball into a supported Homebridge host. Use the [local configuration instructions](docs/CONFIGURATION.md#local-provisioning) and a separate shared Aqua Temp account. Keep the old plugin disabled while evaluating this one. Actual iHost pairing/endurance and npm distribution remain #10 and #11.

- [Product and engineering specification](docs/SPEC.md)
- [Observed deployment and runtime compatibility](docs/COMPATIBILITY.md)
- [Development commands, tests and packaging](docs/DEVELOPMENT.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [MIT license](LICENSE)

This is an original implementation project. The older Aqua Temp plugin's public documentation and issue reports inform interoperability research and test scenarios; its source, tests, assets, and history are not imported. This project is not affiliated with Aqua Temp, AstralPool, Fluidra, Apple, or SONOFF.

Cloud connectivity is required. Support is limited to the exact observed model and the documented mode contracts and limitations. No public npm package or compatibility certification is claimed.

Please exclude credentials, tokens, device identifiers, raw device photographs, and unredacted logs from public issues. Diagnostics use local credentials and produce sanitized output.
