# Compatibility and support limits

| Component   | Supported baseline                        | Evidence                                      |
| ----------- | ----------------------------------------- | --------------------------------------------- |
| Node.js     | `^22.23.2`                                | Minimum/latest Node 22 CI; ARMv7 baseline     |
| Homebridge  | `^2.4.0`                                  | Real packed-process tests use 2.4.0           |
| Linux x64   | CI                                        | Minimum/latest Node 22                        |
| Linux ARMv7 | CI under emulation; iHost installation    | 32-bit runtime, no plugin native dependencies |
| macOS arm64 | Local development tests                   | Not an iHost performance substitute           |
| Heat pump   | `PASRW040-P-BP4II-C` / `BOOSTi-INV-HP-40` | Owner-assisted Aqua Temp tests                |

Only the heat pump model listed above has been hardware-tested. Other models are not blocked by name: the plugin logs a warning once per selected untested device per startup and attempts the same Aqua Temp protocol mappings and target ranges. Compatibility with those models is unverified. Missing or conflicting model metadata also triggers the warning.

Other Node majors, Homebridge 1.x and Windows are not claimed as supported. Homebridge UI is host tooling rather than a plugin dependency. Check other installed plugins before upgrading a shared Homebridge runtime.

The iHost test installation uses the official Homebridge Docker layout with host networking and persistent `/homebridge` storage (`/var/lib/homebridge`). It was upgraded to Node 22.23.2 and Homebridge 2.4.0. This is observed compatibility, not vendor or HomeKit certification.

## Device behavior

| Mode | Wire mode | Target field | Protocol range | Home range |
| ---- | --------- | ------------ | -------------- | ---------- |
| Heat | `1`       | R02          | 15–40°C        | 15–38°C    |
| Cool | `0`       | R01          | 8–35°C         | 10–35°C    |
| Auto | `2`       | R03          | 8–40°C         | 10–38°C    |

All grids use 0.5°C steps. Heat app endpoints and adjacent steps were observed. Cool/Auto full bounds are metadata-based assumptions; live tests covered adjacent Cool 8/8.5°C and Auto 30/30.5°C values, not every grid point. Auto uses one retained target. A stored target outside Home's range remains unchanged but can make the thermostat unavailable.

Power is the requested app setting, not proof of compressor stop/start. O07 zero with clear fault status supports idle; positive frequency cannot distinguish heating, cooling, defrost or protection. Home estimates demand when activity is unknown. The estimate never controls the device.

Cloud fields are not an atomic snapshot. Every command requires fresh preflight and matching readback, but a timeout can occur after the setting applied. Commands are never replayed. A partial mode change can leave the new mode selected while Off, or the unit On after a lost acknowledgment. Check Aqua Temp before retrying.

Model names do not determine capability availability. Unsupported, missing or invalid fields do not stop account polling or sibling sensors. Missing core readings can still disable dependent thermostat controls. Generic faults are not decoded into specific protection diagnoses.

## Release confidence

The maintainer approved the stable release after installing the published beta, pairing a new child bridge and reporting successful initial testing. No seven-day physical soak, complete range sweep or all-model firmware validation is recorded. Stable versioning does not extend the tested hardware coverage; see [validation](VALIDATION.md) and [release process](RELEASING.md).

Node 22's support lifecycle and upstream ARMv7 requirements should be checked before runtime upgrades: [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), [Node 22 platforms](https://github.com/nodejs/node/blob/v22.x/BUILDING.md), [Homebridge Docker](https://github.com/homebridge/docker-homebridge).
