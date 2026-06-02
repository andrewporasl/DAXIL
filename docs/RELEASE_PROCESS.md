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

## Code Signing

Current release builds are unsigned. The workflow disables automatic macOS identity discovery so unsigned macOS builds package consistently in CI.

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
