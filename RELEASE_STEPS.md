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

The workflow publishes to npm and then creates the matching Git tag and GitHub release. Do not
create those manually. The first publication under a new npm name is the documented exception; see
[releasing](docs/RELEASING.md#first-publication-under-the-unscoped-name).
