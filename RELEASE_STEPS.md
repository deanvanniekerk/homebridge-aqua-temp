# Release steps

1. Update the version in `package.json` and `package-lock.json`, and set the matching
   `publishConfig.tag`.
2. Add a dated release section with that version to `CHANGELOG.md`.
3. Run:

   ```sh
   npm run check
   npm pack --dry-run
   ```

4. Commit the changes, open a pull request and merge it into `main`.
5. In GitHub, open **Actions → Publish npm release → Run workflow**, select `main`, enter the exact
   version and approve the `npm` environment.

The workflow publishes to npm and then creates the matching Git tag and GitHub release. Confirm
both jobs succeeded and the release notes are visible on GitHub for every published version; the
Homebridge UI displays those notes when users update. Do not create tags or releases manually
except for the [first publication](docs/RELEASING.md#first-publication-under-the-unscoped-name) or
[recovery of a missing historical release](docs/RELEASING.md#failure-recovery).
