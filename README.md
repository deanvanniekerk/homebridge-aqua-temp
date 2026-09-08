# Aqua Temp for Homebridge

An independent Homebridge plugin project for Aqua Temp connected heat pumps, starting with an AstralPool BOOST-i-INV-HP-40 used at home.

**Status: specification and implementation backlog. There is no installable plugin yet.**

The first release will bring water temperature, target temperature, on/off control, and verified operating status into Apple Home. The primary deployment is Homebridge running in Docker on SONOFF iHost.

- [Product and engineering specification](docs/SPEC.md)
- [Observed deployment and runtime compatibility](docs/COMPATIBILITY.md)
- [Protocol observations and unresolved device controls](docs/PROTOCOL.md)
- [Implementation roadmap](docs/ROADMAP.md)
- [MIT license](LICENSE)

This is an original implementation project. The older Aqua Temp plugin's public documentation and issue reports inform interoperability research and test scenarios; its source, tests, assets, and history are not imported. This project is not affiliated with Aqua Temp, AstralPool, Fluidra, Apple, or SONOFF.

Cloud connectivity is required for v1. Hardware compatibility and the vendor protocol still need verification. No public npm package or compatibility certification is claimed.

Please exclude credentials, tokens, device identifiers, raw device photographs, and unredacted logs from public issues. Future live diagnostics will use local credentials and produce sanitized output.
