#!/usr/bin/env bash
# Builds the macOS DMG from the already-packaged app, retrying when hdiutil flakes.
#
# On GitHub's macOS runners, hdiutil fails now and then for reasons outside this project: the disk-image
# helper drops out ("attach failed - Device not configured") or the final resize fails with no output
# ("Unable to shrink"). electron-builder runs dmgbuild once with no retry, so one hiccup used to cost the
# whole macOS release (v0.3.0 and v0.4.0 shipped without a Mac build). Rerunning is safe: dmgbuild
# overwrites its output and uses a fresh temporary image each time.
#
# Usage: scripts/build-mac-dmg.sh [arch]   (default arm64; run after `electron-builder --mac zip --<arch>`)
set -uo pipefail

arch="${1:-arm64}"
app="dist/mac-${arch}/DAXIL.app"
attempts=4

if [ ! -d "$app" ]; then
  echo "::error::$app is missing. Package the app first (electron-builder --mac zip --$arch)."
  exit 1
fi

for attempt in $(seq 1 "$attempts"); do
  echo "DMG attempt $attempt of $attempts"
  if npx electron-builder --mac dmg "--$arch" --prepackaged "$app" --publish never; then
    exit 0
  fi
  echo "::warning::DMG attempt $attempt failed (hdiutil). Cleaning up and retrying."
  # A failed run can leave the staging image mounted; a stale mount makes the next attach fail too.
  for volume in /Volumes/DAXIL*; do
    [ -d "$volume" ] && hdiutil detach -force "$volume" || true
  done
  rm -f dist/*.dmg dist/*.dmg.blockmap
  [ "$attempt" -lt "$attempts" ] && sleep $((attempt * 15))
done

echo "::error::The DMG failed $attempts times. See the hdiutil errors above."
exit 1
