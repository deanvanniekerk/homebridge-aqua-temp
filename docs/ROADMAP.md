# Implementation roadmap

Each issue contains scope, dependencies, acceptance criteria and a verification deliverable. [SPEC.md](SPEC.md) defines the shared product and engineering contract.

The repository currently contains planning documents only. All implementation and validation work below is outstanding.

| Issue | Work | Depends on |
| --- | --- | --- |
| [#1](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/1) | Verify iHost runtime and select the supported compatibility matrix | — |
| [#2](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/2) | Document the Aqua Temp protocol and verified device profile | — |
| [#3](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/3) | Create the original TypeScript plugin foundation and CI | [#1](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/1) |
| [#4](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/4) | Implement validated cloud transport and session recovery | [#2](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/2), [#3](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/3) |
| [#5](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/5) | Implement the verified heat pump model and capability mapping | [#2](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/2), [#3](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/3) |
| [#6](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/6) | Implement polling, freshness and ordered command reconciliation | [#4](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/4), [#5](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/5) |
| [#7](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/7) | Expose core controls through the Homebridge dynamic platform | [#6](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/6) |
| [#8](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/8) | Add validated configuration and sanitized diagnostics | [#4](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/4), [#7](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/7) |
| [#9](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/9) | Prove failure recovery and package compatibility locally | [#7](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/7), [#8](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/8) |
| [#10](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/10) | Validate Apple Home behavior and sustained operation on iHost | [#9](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/9) |
| [#11](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/11) | Prepare npm distribution and migration documentation | [#9](https://github.com/deanvanniekerk/homebridge-aqua-temp-next/issues/9) |

## Delivery order

1. Establish host compatibility and the independent API/device contract.
2. Build the package foundation, cloud client and device profile; then the coordinator, Homebridge adapter and configuration.
3. Complete local failure/recovery and package validation.
4. Validate on the actual iHost and heat pump with the owner. Release preparation can proceed after local tests; a stable release additionally requires actual-host evidence.

A prerelease may disclose incomplete hardware validation. No simulated test establishes live vendor behavior, physical actuation or long-term hardware reliability.

## Remaining evidence, not additional product scope

- Installed container/Node/Homebridge versions and target architecture.
- Current vendor API fields, session behavior, permissions and supported command semantics.
- Device setpoint limits and reliable operating-status telemetry.
- Npm scope ownership and scoped-package installation/discovery.
- Actual Apple Home presentation and sustained iHost operation.
