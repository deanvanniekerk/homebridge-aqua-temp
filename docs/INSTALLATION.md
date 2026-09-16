# Installation and migration

## Prepare

1. Check [runtime and device compatibility](COMPATIBILITY.md).
2. Download a Homebridge backup using Settings → Backup & Restore. Record the installed plugin versions and keep any non-registry plugin tarballs separately. Protect backups: they contain credentials and pairing data. A backup download is not proof that a restore works.
3. Disable the previous Aqua Temp plugin or its child bridge. Keep its package, configuration and pairing data available for rollback. Avoid two integrations controlling the same device/account.
4. If using a separate Aqua Temp account, create it in the app, share the device from the owner account and confirm it appears when signed into the new account. Do not share your credentials in an issue.

## Install the package

Search Homebridge UI → Plugins for `homebridge-aqua-temp-connect`, install the latest stable version, then open Plugin Config. To test a prerelease, explicitly select its beta version. The plugin has no runtime dependencies, install scripts or native compilation.

To test a contribution, build a tarball from the intended commit on a development machine:

```sh
npm ci
npm run check
npm pack
```

Transfer the generated `.tgz` file to the Homebridge host. From the Homebridge terminal, install it in the directory where that host manages its plugins. In the official Docker image this is normally `/var/lib/homebridge`:

```sh
npm install --omit=dev --no-audit --no-fund /absolute/path/to/package.tgz
```

Use the actual transferred filename. Do not install compiler dependencies or clone the repository into Homebridge storage. If your host uses global plugin installation, use its documented global installation procedure instead. This plugin does not require runtime native dependencies.

## Migrate from the scoped package

The public npm package moved from `@deanvniekerk/homebridge-aqua-temp-connect` to `homebridge-aqua-temp-connect` at version `1.0.1`. Its `AquaTemp` platform alias and private accessory UUID namespace remain unchanged so Homebridge can retain the existing configuration and accessory identities.

1. Download a Homebridge backup and copy the existing `AquaTemp` platform configuration.
2. Stop or disable the Aqua Temp child bridge.
3. Uninstall `@deanvniekerk/homebridge-aqua-temp-connect` without deleting the platform configuration or child-bridge pairing.
4. Install `homebridge-aqua-temp-connect` and restart the child bridge. Never install both package names together because both register the same platform alias.
5. Check the Homebridge log and verify every accessory in Apple Home. Homebridge can reassociate cached dynamic-platform accessories when the package name changes and the platform alias remains unique.

If the existing child bridge does not recover cleanly, remove only that child bridge from Apple Home, recreate it under the new package and pair its new QR code. Re-pairing removes that bridge's room assignments, scenes and automations, so record them first. Keep the backup and old package version until the migration is confirmed.

## Configure and pair

1. Enter the account credentials in Plugin Config; optionally restrict device IDs. The three optional temperature sensors default off. See [configuration](CONFIGURATION.md).
2. Enable a dedicated child bridge in the plugin's Child Bridge Config, then restart it. This isolates the plugin from other integrations.
3. In Apple Home, Add Accessory and scan the child bridge's QR code. Assign rooms and recreate the automations you want.
4. Compare temperatures, selected mode, target and power with Aqua Temp. Switch Off before changing modes. Begin with a small reversible target change and confirm it in the app before restoring it.

Accessory identities from unrelated Aqua Temp plugins do not migrate automatically. Keep the old bridge disabled until you decide to remove it. An upgrade from the earlier Heat-only development build may require re-pairing this child bridge to refresh Home's mode menu; try reopening Home first. Re-pairing can lose its assignments and automations.

## Upgrade, remove or roll back

Back up first and retain the last working version/tarball. Install the desired version and restart only this child bridge. Never delete all Homebridge accessory caches to resolve one plugin's issue.

To remove, disable this plugin, remove its child bridge from Home, then uninstall its exact package using Homebridge UI. Removing accessories deletes associated Home automations; export or record them first. npm removal alone does not remove Home pairing or platform configuration.

To roll back, disable this integration, reinstall the previous package version or retained tarball, and restore its matching configuration. Re-enable the previous bridge and verify it in the app/Home. If a full Homebridge restore is necessary, use the saved backup through Backup & Restore; it affects other integrations too. Do not run both old and new controllers while verifying recovery.
