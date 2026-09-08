# Runtime compatibility

Evidence collected on 2026-09-08 for [issue #1](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues/1).

**Decision:** use Homebridge 2.4.0 and Node 22.23.2 as the initial implementation baseline, with the official Linux ARMv7 Homebridge image pinned below. The existing iHost meets the observed architecture/kernel/libc prerequisites but needs a coordinated Homebridge, Node patch and UI update before it matches this baseline. No running-container settings, packages or services were changed during this investigation.

This establishes a build/runtime candidate. It does not establish new-plugin installation, Apple Home pairing, vendor API compatibility or sustained operation on the physical iHost; those remain the later integration and [hardware validation](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues/10) work.

## Observed deployment

The observations below came from the owner's existing signed-in iHost and Homebridge browser sessions. Only allowlisted version/platform/mount commands were executed through the Homebridge terminal. No account configuration, credentials, device telemetry or raw logs were collected for publication.

| Item | Observed value | Evidence |
| --- | --- | --- |
| Image repository | `homebridge/homebridge` | iHost add-on Info |
| Installed image tag | **Unavailable**: iHost displays Version `<none>` | No tag inferred from the image repository name |
| Installed image digest | **Unavailable** | iHost shows an Add-on ID, not a verified registry digest; Docker CLI is absent inside the container |
| Container creation shown by iHost | 2025-01-11 04:07:31; UI timezone not established | Age does not establish current package versions |
| Container architecture | Linux `arm` (32-bit); Node build ARM version `7` | Homebridge System Information and `process.arch` / `process.config.variables.arm_version` |
| Kernel | `4.19.111` | `uname -r` inside container; kernel is shared with the host |
| Container distribution | Ubuntu Noble 24.04.1 LTS | Homebridge System Information |
| Container libc | glibc `2.39` | `getconf GNU_LIBC_VERSION` |
| Node | `22.13.1` | `process.version` |
| Homebridge | `1.11.1` | Local `npm ls --depth=0 homebridge` in the storage directory |
| Homebridge UI | `5.11.0` | Global `npm ls -g --depth=0 homebridge homebridge-config-ui-x` |
| Network mode | `host` | iHost add-on Info |
| Persistent volume destination | `/homebridge` | iHost add-on Info; `findmnt` reports a separate ext4 mount, `rw,relatime` |
| Application storage | `/var/lib/homebridge` resolves to `/homebridge` | Homebridge System Information and `readlink -f` |
| Host-side volume source / recovery | **Unavailable / not tested** | In-container mount checks do not verify the host path, backup or restore |

The installed tag/digest cannot be recovered from the visible Info panel. They remain explicitly unknown; the public image digest below is a different, locally tested candidate. No Docker socket access, remote shell provisioning or full environment/configuration dump was needed.

## Selected baseline and rationale

| Component | Initial baseline | Reason |
| --- | --- | --- |
| Homebridge | `2.4.0`; proposed package engine `^2.4.0` | Stable npm `latest` and official release at observation time; do not add untested 1.x support |
| Node | `22.23.2`; proposed package engine `^22.23.2` | Supported LTS line with first-class upstream ARMv7 support; exact patch successfully executed in the candidate image |
| Homebridge UI | `5.29.0` for the deployment walkthrough | Present in the tested image; UI is host tooling, not a plugin runtime dependency |
| TypeScript | `7.0.2`, development-only | Current stable registry version; install and strict NodeNext/ESM typecheck passed under ARMv7 emulation |
| Node typings | `@types/node@22.20.1`, development-only | Match the selected runtime major rather than using declarations for a newer Node major |
| Runtime dependencies | Homebridge-supplied HAP API; no new plugin dependencies selected here | The plugin foundation and vendor implementation must verify their final dependency set independently |

Homebridge 2.4.0 declares Node `^22 || ^24 || ^26`. UI 5.29.0 declares Node `^22.12.0 || ^24.0.0 || ^26.0.0`. Satisfying those package engines alone is insufficient to select a runtime for iHost.

Node's [22.x platform table](https://github.com/nodejs/node/blob/v22.x/BUILDING.md#platform-list) lists GNU/Linux ARMv7 as Tier 1 with kernel >=4.18 and glibc >=2.28. The observed kernel/libc exceed those minima. Its [24.x table](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list) downgrades ARMv7 to Experimental. This is why Node 24 is not the default for this 32-bit deployment. This comparison covers the documented kernel/libc floors, not every property of the physical device or future dependency.

Node 22 is in Maintenance LTS and its [scheduled end of life](https://github.com/nodejs/Release/blob/main/schedule.json) is 2027-04-30. Revisit the host/runtime strategy before then; do not silently continue an unsupported Node release. Node 24/26 and other hardware can be evaluated separately, without expanding the initial engine range before validation.

The installed Homebridge 1.11.1 and Node 22.13.1 do **not** meet the selected implementation baseline. A future upgrade must preserve the existing volume and pairing/configuration state, include backup/rollback, and check the other installed plugins for Homebridge 2 compatibility. This issue authorizes discovery, not that upgrade. The image does not freeze packages in a pre-existing `/homebridge` volume; after any image change, re-read the actual application versions rather than assuming they match the candidate.

## Immutable image and local results

The public `homebridge/homebridge:latest` index resolved to:

```text
sha256:77c685a40911b3b95448f3550be0c8b94cd7b4e66daecc1cc39a8285be75b245
```

Its `linux/arm/v7` manifest, pulled and executed explicitly, was:

```text
homebridge/homebridge@sha256:547c1429345a63537690198f20d8e48417ff0e0b9d452d10764a312c621e6cea
```

Docker 29.6.2 on the development Mac reported a Linux/aarch64 engine. All ARMv7 results below therefore used emulation, not the iHost CPU/kernel. The test had no production storage mounted and no ports published. The full image init/service tree was bypassed with `/bin/sh`; the Homebridge CLI was started separately with synthetic, empty configuration.

| Check | Result |
| --- | --- |
| Manifest/platform inspection and pull | Passed: `linux/arm/v7` manifest is available and pullable |
| Node execution, with network disabled | Passed: `v22.23.2`, `arch=arm`, ARM version `7` |
| Image distribution/UI | Ubuntu 24.04.4 LTS; global UI `5.29.0` |
| Clean dependency installation with engine checks | Passed: Homebridge `2.4.0`, TypeScript `7.0.2`, Node typings `22.20.1` |
| Homebridge and TypeScript CLI load | Passed: versions `2.4.0` and `7.0.2` |
| Strict TypeScript API boundary | Passed: NodeNext/ESM imports of Homebridge API, DynamicPlatformPlugin and PlatformAccessory types, with access to `api.hap` |
| Empty Homebridge process startup | Passed: Homebridge `2.4.0`, HAP `2.2.2`, reached its running message, then received the planned SIGTERM after a 15-second smoke run |
| New-plugin installation, real pairing, vendor calls, physical-host upgrade and soak | Not performed; outside this discovery check |

The smoke run used a fresh npm directory inside the disposable container. It proves this dependency candidate installs and loads, not that every future plugin dependency works. The direct versions and image are pinned here; transitive dependency resolution can change on repetition. [Foundation issue #3](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues/3) must commit a lockfile for the actual package and use `npm ci`.

## Reproduce the checks

### Existing iHost: read only

In iHost, open the running Homebridge add-on's **Info** tab and record only the image repository/version, network mode and volume destination. Do not copy the whole panel: it includes environment settings and an installation identifier. In Homebridge, open System Information and record the distribution and architecture. Then use its Terminal:

```sh
node -p 'JSON.stringify({node:process.version,arch:process.arch,platform:process.platform,arm:process.config.variables.arm_version})'
uname -r
getconf GNU_LIBC_VERSION
npm ls --depth=0 homebridge
npm ls -g --depth=0 homebridge homebridge-config-ui-x
readlink -f /var/lib/homebridge
findmnt -n -T /homebridge -o TARGET,FSTYPE,OPTIONS
```

Run the local `npm ls` from Homebridge's storage directory; in this deployment the terminal starts there. Record package versions, not the surrounding path/account metadata. These commands do not install packages, restart services or read `config.json`. If the terminal or a command is unavailable, retain an explicit unknown rather than substituting a registry version.

### Development machine: disposable ARMv7 probe

This sequence downloads an official image and public npm packages, then runs only inside a disposable local container. Use a **local development Docker context**, not a context pointing at iHost or another shared host. Docker ARM emulation must already be available. No production volumes, credentials or real plugin configuration are used.

```sh
docker context show
docker info --format '{{.OSType}}/{{.Architecture}}'
docker buildx imagetools inspect homebridge/homebridge:latest

AQUA_PROBE_IMAGE='homebridge/homebridge@sha256:547c1429345a63537690198f20d8e48417ff0e0b9d452d10764a312c621e6cea'
docker pull --platform linux/arm/v7 "$AQUA_PROBE_IMAGE"
docker run --rm --platform linux/arm/v7 --network none \
  --entrypoint node "$AQUA_PROBE_IMAGE" \
  -p 'JSON.stringify({node:process.version,arch:process.arch,arm:process.config.variables.arm_version})'

docker run --rm -i --platform linux/arm/v7 \
  --entrypoint /bin/sh "$AQUA_PROBE_IMAGE" <<'PROBE'
set -eu
mkdir /tmp/aqua-compatibility
cd /tmp/aqua-compatibility
npm init -y >/dev/null
npm install --save-exact --engine-strict --no-audit --no-fund \
  homebridge@2.4.0 typescript@7.0.2 @types/node@22.20.1
npm ls --depth=0
./node_modules/.bin/homebridge --version
./node_modules/.bin/tsc --version
cat > boundary.mts <<'TS'
import type { API, DynamicPlatformPlugin, PlatformAccessory } from 'homebridge';
export function inspectRuntime(api: API): typeof api.hap {
  return api.hap;
}
export class CompatibilityProbe implements DynamicPlatformPlugin {
  configureAccessory(_accessory: PlatformAccessory): void {}
}
TS
./node_modules/.bin/tsc --noEmit --strict --module NodeNext \
  --moduleResolution NodeNext --target ES2022 boundary.mts
mkdir /tmp/aqua-homebridge
cat > /tmp/aqua-homebridge/config.json <<'JSON'
{"bridge":{"name":"Compatibility probe","username":"0E:11:22:33:44:55","port":51829,"pin":"031-45-154","advertiser":"ciao"},"accessories":[],"platforms":[]}
JSON
set +e
timeout --signal=TERM --kill-after=5s 15s ./node_modules/.bin/homebridge \
  --no-qrcode --strict-plugin-resolution \
  --user-storage-path /tmp/aqua-homebridge > /tmp/aqua-startup.log 2>&1
probe_status=$?
set -e
cat /tmp/aqua-startup.log
[ "$probe_status" -eq 124 ]
grep -q 'Homebridge v2.4.0.*is running' /tmp/aqua-startup.log
PROBE
```

The pin and accessory identity in this example are synthetic and used only inside the disposable test container. Timeout status 124 is expected: it bounds the startup smoke test. A crash/early exit or missing running message fails the probe. This check is not a shutdown stress test. The local Docker image cache remains after the container exits.

### Registry/support verification

```sh
npm view homebridge@2.4.0 engines dependencies --json
npm view homebridge-config-ui-x@5.29.0 engines --json
npm view typescript@7.0.2 engines optionalDependencies --json
```

Use the [official Homebridge release](https://github.com/homebridge/homebridge/releases/tag/v2.4.0), [Node support tables](https://github.com/nodejs/node/blob/v22.x/BUILDING.md), [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) and [official Docker documentation](https://github.com/homebridge/docker-homebridge) to reassess the matrix when updating versions. The Docker documentation advertises ARM32v7 images, host networking and persistent `/homebridge` storage. Its moving tag is not a substitute for recording the selected manifest digest.

## CI matrix for implementation

This issue defines the matrix; it adds no CI workflow to a documentation-only repository. Foundation issue #3 implements it, and [local integration issue #9](https://github.com/deanvanniekerk/homebridge-aqua-temp/issues/9) expands the runtime tests as the plugin becomes available.

| Lane | Runtime/platform | Required work | Evidence/claim |
| --- | --- | --- | --- |
| Fast pull-request checks | Linux x64, Node `22.23.2`, Homebridge `2.4.0` | Lockfile install, lint, strict typecheck, build, real behavioral tests, package-content validation | Proposed required CI lane; not executed on x64 in this discovery |
| Target architecture | Linux ARMv7 on an emulation-capable Linux runner; pinned image above, Node `22.23.2`, Homebridge `2.4.0` | Dependency install and typecheck; once implemented, install packed plugin and run Homebridge/fake-cloud integration including startup/restart/shutdown | Required before merging changes to dependencies, engines or runtime integration and before release; report emulation explicitly |
| Physical release gate | Actual iHost, selected versions and preserved persistent volume | Install, pair, readings/writes, recovery, restart and soak from issue #10 | Owner-assisted evidence required for stable hardware support claims; not interchangeable with CI |

Initial package engines should stay within the tested Node 22/Homebridge 2 baseline. Broader runtime/architecture claims require their own CI lanes and evidence. Dependency update PRs must re-run the ARMv7 lane and update the lockfile/evidence; a pass on an x64 runner alone cannot establish ARMv7 compatibility. Do not introduce native plugin runtime dependencies without testing their target-architecture installation. TypeScript 7's architecture-specific development compiler was explicitly exercised by the probe.

## Discovery completion versus release readiness

Issue #1 is covered by the observed deployment inventory (including explicit unknowns), an installable/executable ARMv7 candidate, the documented upgrade gap and the defined CI matrix. Missing installed tag/digest and host-side volume source remain documented limitations. They must be resolved or backed up through the deployment UI as part of a future coordinated upgrade, not guessed here.

This repository still has no production plugin. The new plugin has not touched the physical heater or Homebridge service. The next work can select dependencies using this baseline while preserving the later real-device validation gate.
