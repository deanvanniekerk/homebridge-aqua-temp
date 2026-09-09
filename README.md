# Aqua Temp for Homebridge

An independent Homebridge plugin project for Aqua Temp connected heat pumps, starting with an AstralPool BOOST-i-INV-HP-40 used at home.

**Status: limited development/prerelease plugin. Reads and confirmed target/On/Off commands are implemented for the observed BOOSTi-INV-HP-40 profile. No npm release or actual iHost/Apple Home certification is available.**

The plugin exposes inlet water temperature and a 15–38°C target in 0.5°C steps through a HomeKit Thermostat. Select Heat mode in Aqua Temp first; HomeKit Off/Heat then controls power without changing the vendor mode. The device's 38.5–40°C targets remain available only through Aqua Temp because they exceed the supported HAP target range.

Writes require fresh state and matching readback. A timeout or unconfirmed result can mean the setting applied later: check the app before trying again. Startup and recovery never replay commands. Fractional Heat target writes have been confirmed in the app during iHost testing. Idle can be reported from zero compressor frequency; active heating, defrost and flow/protection states cannot yet be distinguished. Unknown activity returns a communication error and can make the Apple Home thermostat unavailable. Optional independent Power and Water Temperature accessories can retain usable capabilities; both are disabled by default. See [configuration options](docs/CONFIGURATION.md#optional-accessories). Their actual Apple Home presentation remains unverified. See the complete [support boundary](docs/DEVICE_MODEL.md#supported-control-subset-and-limitations).

Homebridge 2.4.0+ (2.x) and Node 22.23.2+ (22.x) are required. Use a host with these supported runtime versions; the validation iHost container has been upgraded. For local development, build an installable tarball with `npm ci` then `npm pack`, and install that tarball into a supported Homebridge host. Use the [local configuration instructions](docs/CONFIGURATION.md#local-provisioning) and a separate shared Aqua Temp account. Keep the old plugin disabled while evaluating this one. Actual iHost pairing/endurance and npm distribution remain #10 and #11.

- [Product and engineering specification](docs/SPEC.md)
- [Observed deployment and runtime compatibility](docs/COMPATIBILITY.md)
- [Development commands, tests and packaging](docs/DEVELOPMENT.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [MIT license](LICENSE)

This is an original implementation project. The older Aqua Temp plugin's public documentation and issue reports inform interoperability research and test scenarios; its source, tests, assets, and history are not imported. This project is not affiliated with Aqua Temp, AstralPool, Fluidra, Apple, or SONOFF.

Cloud connectivity is required. Support is limited to the exact observed model and the documented Heat contract. No public npm package or compatibility certification is claimed.

Please exclude credentials, tokens, device identifiers, raw device photographs, and unredacted logs from public issues. Diagnostics use local credentials and produce sanitized output.
