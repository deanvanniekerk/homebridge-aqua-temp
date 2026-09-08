# Aqua Temp status-parameter evidence

The owner supplied thirteen screenshots from Aqua Temp 2.2.2 on 2026-09-08, showing the supported BOOSTi-INV-HP-40's **Status parameters** pages at phone times 19:34–19:38, followed by the V tab at 19:42. The preceding device screen showed Online, Heat, target 32°C and compressor Standby. These tables transcribe the displayed labels, codes and values; they are observations, not instructions or a vendor protocol specification. Duplicate screenshots are consolidated. All displayed tab categories are represented. Raw screenshots and device/account identifiers remain private.

## Displayed parameters

| Code or displayed tag | App label                             | Displayed value |
| --------------------- | ------------------------------------- | --------------- |
| Current mode          | Mode State                            | Heating         |
| ver                   | Motherboard program version           | 1.1             |
| O01                   | Compressor                            | 0               |
| O02                   | Circulate pump                        | 0               |
| O03                   | 4-way valve                           | 0               |
| O04                   | High fan                              | 0               |
| O05                   | Low fan                               | 0               |
| O06                   | Exp. valve                            | 250N            |
| O07                   | Comp. output frequency                | 0Hz             |
| O08                   | Compressor current                    | 0.1A            |
| O09                   | IPM Temp.                             | 24.0°C          |
| O10                   | DSP software version                  | 1               |
| O11                   | PFC software version                  | 0               |
| O12                   | EEPROM version                        | 5               |
| O13                   | Chassis Heater                        | 0               |
| O14                   | Target Temperature after Compensation | 0.0°C           |
| O15                   | PV Real-time Current                  | 0.0°C           |
| Power_State           | Power_State                           | OFF             |
| S01                   | HP switch                             | 0               |
| S02                   | LP switch                             | 0               |
| S03                   | Flow switch                           | 1               |
| S04                   | Remote switch                         | 0               |
| S05                   | Mode switch                           | 0               |
| S06                   | Master/Slave switch                   | 0               |
| software_code         | Software code                         | 156             |
| T01                   | Suction Temp.                         | 23.5°C          |
| T02                   | Inlet water Temp.                     | 21.5°C          |
| T03                   | Outlet water Temp.                    | 23.0°C          |
| T04                   | Coil 1 Temp.                          | 21.0°C          |
| T05                   | Ambient Temp.                         | 21.5°C          |
| T06                   | Exhaust Temp.                         | 24.0°C          |
| T07                   | Compressor current detect             | 1A              |
| T08                   | AC fan Output                         | 0               |
| T09                   | Flow rate input                       | 0.0             |
| T10                   | Pressure sensor                       | 12.6bar         |
| T11                   | Real overheat                         | 0.0°C           |
| T12                   | Target fan speed                      | 0r              |
| T13                   | Overheat after Compen.                | 4.0°C           |
| T14                   | Inverter board AC input voltage       | 232A            |
| T15                   | Antifreeze Temp.                      | 0.0°C           |
| T16                   | EC fan motor speed                    | 0r              |
| T17                   | Speed of fan motor1                   | 0r              |
| T18                   | Speed of fan motor2                   | 0r              |
| T19                   | Buses Voltage                         | 313             |
| T20                   | Limited frequency protect state       | 0               |
| T21                   | Frequency reduction protect state     | 0               |
| T22                   | Coil 2 Temp.                          | 0.0°C           |
| T23                   | Frequency converter running status 1  | 0               |
| T24                   | Frequency converter running status 2  | 0               |
| T25                   | Frequency converter running status 3  | 0               |
| T26                   | Frequency converter running status 4  | 0               |
| T27                   | Frequency converter running status 5  | 0               |
| T28                   | Target frequency                      | 0Hz             |
| Z01                   | 机组COP                               | 0.0             |
| Z02                   | Capacity                              | 0.0             |
| Z03                   | Water flow rates                      | 0.0             |
| Z04                   | Real power value                      | 0.0             |
| Z05                   | Total Water Flow                      | 0.00            |
| Z06                   | ACC                                   | 0.00            |
| Z07                   | Flow meter state                      | 0               |
| 2037                  | Total Water Flow Low Bit              | 0               |
| 2038                  | ACC High Bit                          | 0.0             |
| 2039                  | ACC Low Bit                           | 0               |
| 2057                  | Total power value(24 hours of power)  | 0.0             |
| 2058                  | Battery Number                        | 0°C             |
| 2059                  | undefined                             | 0               |
| 2064                  | Silent display flag (bit8)            | 0°C             |
| 2086                  | Actual running press code             | 46              |

Units are deliberately retained as displayed. Apparent inconsistencies such as voltage labelled A, current labelled °C and an undefined label are not corrected into guessed protocol semantics. An app-rendered zero also does not establish that the device supports that measurement.

## Read-only cloud comparison

A subsequent read through the original cloud client used only the account-visible supported device, without writes. The sanitized numeric/metadata projection is in [telemetry-status-parameters.json](../fixtures/protocol/telemetry-status-parameters.json); its timestamp is the later cloud acquisition time, not the screenshot time.

The V-tab entry was supplied after that cloud read. Its `ver=1.1` is app evidence only and was not included in the 70-field API comparison. It identifies the app-reported motherboard program version, not the app version or every component's firmware version.

- Power and Power_State both returned 0; Mode returned 1; Set_Temp and R02 both returned 32.0. This agrees with the displayed OFF/Heat/32°C state.
- O07 returned 0 with reported range 0–120, alongside the app's compressor output frequency label and 0Hz reading. O08 returned 0.1, O09 24.0, O06 250, and software_code 156.
- T01–T13 matched the displayed numeric readings, including T02=21.5, T03=23.0 and T05=21.5. T12 and T17 are now explicitly labelled fan speeds, and T07 is labelled compressor current detect; none is established as the homepage compressor percentage.
- O01–O05, O13 and S01–S06 returned empty values and empty metadata. The app nonetheless displayed numeric states, including S03=1. Empty API values must remain unavailable, not become zero. A derived bitfield or different read path is a possibility, not a verified explanation.
- Some later readings differed, including T14=230 and T19=314. These are separate acquisitions and do not establish a scaling discrepancy.

The new labels identify useful telemetry, but this inactive sample does not establish positive compressor activity, flow-switch polarity, defrost encodings, protection-state bit meanings or the homepage percentage calculation. Current mode “Heating” is a mode label: it was displayed while Power_State was OFF and the homepage showed Standby. It must not become proof of active heating.

These are status pages. They do not show writable Heat target bounds or step, resolve the earlier Set_Temp/R02 disagreement during target writes, or validate absolute mode commands. No production activity or control capability was enabled from this observation alone.

## Owner-confirmed menu limits

At phone time 19:44 the owner reported finding no separate adjustable-parameter page and supplied the Temperature unit selector. It shows Celsius selected, Fahrenheit as another option, and Save/Close controls. This establishes the visible unit choices only; it does not establish whether saving a different unit changes device telemetry or merely presentation. No unit change was requested or performed. The available app-menu investigation is complete; do not continue asking the owner to locate an unobserved parameter editor.

A bounded follow-up documentation search found the matching BOOSTi HP-40 entry, product code 640-0604, in the [Fluidra South Africa catalogue](https://fluidra.co.za/wp-content/uploads/2023/08/Fluidra-Catalogue-DIGITAL.pdf). It did not locate a control manual for the exact PASRW040-P-BP4II-C variant. Search results for other PASRW040 suffixes or other AstralPool product families do not establish this profile's writable limits, step or status encodings. The remaining requirements in [DEVICE_MODEL.md](DEVICE_MODEL.md) therefore remain open.
