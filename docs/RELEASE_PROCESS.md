# Release Process

This document describes the expected release process for DAXIL.

## Release Artifacts

The GitHub Actions release workflow publishes these assets for each tagged version:

- Windows x64 NSIS installer.
- Windows x64 ZIP archive.
- macOS arm64 (Apple Silicon) DMG.
- macOS arm64 (Apple Silicon) ZIP archive.
- Linux x64 AppImage.
- Linux x64 tarball.
- SHA-256 checksums file covering all assets.

## Versioning

DAXIL currently uses simple semantic versioning:

```text
MAJOR.MINOR.PATCH
```

Use a patch release for UI polish, packaging fixes, and small behavior updates. Use a minor release for new workflows or export capabilities. Use a major release for changes that break documented behavior.

## Release Checklist

1. Confirm the working tree is clean or contains only intended changes.
2. Update `package.json` and `package-lock.json` to the new version.
3. Update user-facing documentation.
4. Run validation:

```bash
npm run build
npm run lint
```

5. Commit the changes.
6. Push the target branch.
7. Create and push a version tag:

```bash
git tag v<version>
git push origin v<version>
```

8. Confirm the GitHub Actions release workflow completes successfully.
9. Confirm the GitHub Release contains the expected assets.
10. Update the release notes if manual clarification is needed.

## GitHub Actions

The release workflow is located at `.github/workflows/release.yml`. It runs when a tag matching `v*` is pushed.

The workflow builds platform artifacts on the appropriate GitHub-hosted runners and attaches all artifacts to the GitHub Release for the tag.

## Test builds without releasing

To check that every platform builds before tagging, push a `release/<version>` branch (for example `release/v0.4.0`), or run the workflow by hand: **Actions → Release → Run workflow**, pick the branch. It type-checks, runs the unit tests and packages Windows, macOS and Linux, and leaves the installers as downloadable artifacts on the run. Nothing is published. With the GitHub CLI:

```bash
gh workflow run release.yml --ref <branch>
```

## In-app updates

Installed copies update themselves from GitHub Releases, so users never need to revisit the releases page. Nothing extra is needed when releasing: pushing the version tag is enough.

- `electron-builder.yml` has a `publish` block pointing at this repository. Packaging with `--publish never` still writes `latest.yml` (Windows), `latest-mac.yml` and `latest-linux.yml` into `dist/`, and bakes an `app-update.yml` into the app saying where to look.
- The release workflow uploads those `latest*.yml` files and the `.blockmap` files next to the installers.
- On start (and from **Settings → General → Updates**), the app reads the `latest*.yml` for its platform. If the version is newer, the user can download it in the background and restart to install. See `main/updater.ts`.
- Windows installer and Linux AppImage copies install updates themselves. macOS builds are unsigned, which macOS doesn't allow to self-update, so they (and the Windows ZIP and Linux tarball) only check the latest release's version via the GitHub API and offer to open the download.

Things that break updates:

- **The release must be published, not a draft or pre-release.** Clients only see the latest full release.
- **The version must go up.** The tag and `package.json` must match (the workflow checks this) and be higher than the previous release.
- **Don't rename the installers after the build.** `latest*.yml` lists the file name and SHA-512 of each one.

To test an update end to end, install release N, publish N+1, then open the installed N and press **Check now**.

## Code Signing

Current release builds are unsigned. Signing the macOS build (Developer ID + notarization) would also let macOS copies install updates themselves. The workflow disables automatic macOS identity discovery so unsigned macOS builds package consistently in CI.

When signing is introduced, update:

- `electron-builder.yml`
- `.github/workflows/release.yml`
- GitHub repository secrets
- Installation documentation

## Manual Recovery

If the release workflow fails after a tag is pushed:

1. Inspect the failed job logs.
2. Fix the workflow or packaging configuration.
3. Commit and push the fix.
4. Move the tag only if the release has not been distributed broadly.
5. Re-run the workflow or push a new patch tag.

Avoid replacing published installers after users may have downloaded them. Prefer a new patch release when in doubt.
