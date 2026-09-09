# Configuration

Use Homebridge UI → Plugins → Aqua Temp → Plugin Config. The platform alias is `AquaTemp`.

```json
{
  "platform": "AquaTemp",
  "name": "Aqua Temp",
  "username": "your-account@example.com",
  "password": "your-password",
  "pollInterval": 60,
  "deviceIds": [],
  "debug": false,
  "includeInletTemperatureSensor": false,
  "includeOutletTemperatureSensor": false,
  "includeAmbientTemperatureSensor": false
}
```

| Option                            | Default   | Meaning                                                                 |
| --------------------------------- | --------- | ----------------------------------------------------------------------- |
| `name`                            | Aqua Temp | Accessory display name; 1–64 characters                                 |
| `username`, `password`            | Required  | Aqua Temp account credentials, stored in local Homebridge configuration |
| `deviceIds`                       | `[]`      | Include all supported discovered devices, or only the listed exact IDs  |
| `pollInterval`                    | `60`      | Seconds between completed polling cycles; whole number 30–300           |
| `debug`                           | `false`   | Emit sanitized diagnostic reports                                       |
| `includeInletTemperatureSensor`   | `false`   | Separate inlet water temperature sensor (T02)                           |
| `includeOutletTemperatureSensor`  | `false`   | Separate outlet water temperature sensor (T03)                          |
| `includeAmbientTemperatureSensor` | `false`   | Separate ambient air temperature sensor (T05)                           |

## Optional accessories

The three read-only sensors are independently configurable and share the existing polling session. They do not add cloud requests or depend on compressor, mode or target support. Missing data affects only the corresponding sensor. Stale/offline data stays unavailable.

Restart the child bridge after changing options. Disabling a sensor removes that accessory; re-enabling uses the same generated identity, but its Home assignments and automations may have been lost. Temporary missing telemetry does not remove accessories.

The retired development options `includePowerSwitch` and `includeWaterTemperatureSensor` are ignored. Their cached accessories are removed after launch with valid configuration. Use `includeInletTemperatureSensor` to replace the old Water sensor. There is no optional Power switch.

## Diagnostics

Normal logs report failures and recovery with bounded repetition. Enable `debug`, restart the child bridge and find `Diagnostic report:` in its log. Reports are emitted at most once every five minutes and include runtime versions, anonymous device references, capability availability, sample age and retry timing. Disable debug when finished.

Copy only the sanitized report when requesting support. Raw cloud errors, tokens, passwords, account IDs and device IDs are excluded. References are local to one process, not persistent identifiers. Invalid configuration is rejected without echoing supplied values. Correct credentials or denied account access and restart to resume authentication.
