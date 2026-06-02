# DAXIL 0.1.1

## Summary

DAXIL 0.1.1 focuses on interface polish, clearer release packaging, and professional documentation. The app now includes a theme dropdown with dark and light theme groups, cleaner icon-driven controls, and updated release automation for Windows, macOS, and Linux.

## Changes

- Added grouped dark and light theme selection in the application header.
- Added four light themes: Mist, Sage, Blush, and Linen.
- Retained four dark themes: Cloud, Mint, Rose, and Amber.
- Persisted the selected theme locally between launches.
- Added a local SVG icon system for core application actions.
- Replaced redundant text controls with compact accessible icon buttons where appropriate.
- Replaced the settings icon with a simpler sliders-style icon.
- Updated packaging configuration for Windows, macOS, and Linux release assets.
- Added Linux release packaging through AppImage and tarball targets.
- Updated release workflow behavior for unsigned macOS builds.
- Rewrote documentation for installation, development, packaging, architecture, and release operations.

## Release Assets

Expected release assets:

- `DAXIL-0.1.1-win-x64.exe`
- `DAXIL-0.1.1-win-x64.zip`
- `DAXIL-0.1.1-mac-x64.dmg`
- `DAXIL-0.1.1-mac-x64.zip`
- `DAXIL-0.1.1-mac-arm64.dmg`
- `DAXIL-0.1.1-mac-arm64.zip`
- `DAXIL-0.1.1-linux-x86_64.AppImage`
- `DAXIL-0.1.1-linux-x64.tar.gz`

## Runtime Requirements

Release builds bundle FFmpeg and FFprobe. End users do not need to install Node.js, FFmpeg, FFprobe, npm, or other developer tools.

## Code Signing

Current builds are unsigned. macOS and Windows may show first-run security prompts for unsigned applications.
