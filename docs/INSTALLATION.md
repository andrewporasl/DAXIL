# Installation

This document describes how to install DAXIL from a GitHub Release without building from source.

## Download Location

Use the GitHub Releases page:

https://github.com/andrewporasl/DAXIL/releases

Download an application artifact from the release assets section. Do not use the automatically generated `Source code (zip)` or `Source code (tar.gz)` archives for installation.

## macOS

Use the DMG that matches the Mac architecture:

- Apple Silicon: `DAXIL-<version>-mac-arm64.dmg`
- Intel: `DAXIL-<version>-mac-x64.dmg`

Installation:

1. Open the DMG.
2. Drag `DAXIL.app` into `Applications`.
3. Open DAXIL from `Applications`.

Unsigned build note:

DAXIL release builds are currently unsigned. If macOS blocks the first launch, right-click `DAXIL.app`, choose `Open`, and confirm the prompt. If needed, use `System Settings > Privacy & Security > Open Anyway`.

## Windows

Use the Windows x64 installer:

```text
DAXIL-<version>-win-x64.exe
```

Installation:

1. Open the installer.
2. Choose the installation location when prompted.
3. Launch DAXIL from the Start menu or desktop shortcut.

Some browsers or Windows SmartScreen may warn about new unsigned installers. Confirm that the file was downloaded from the official GitHub Release before continuing.

## Linux

Use the AppImage for the simplest installation path:

```text
DAXIL-<version>-linux-x86_64.AppImage
```

Run the AppImage:

```bash
chmod +x DAXIL-<version>-linux-x86_64.AppImage
./DAXIL-<version>-linux-x86_64.AppImage
```

A tarball is also published for users who prefer unpacked application directories:

```text
DAXIL-<version>-linux-x64.tar.gz
```

## Runtime Dependencies

Release builds bundle FFmpeg and FFprobe. End users do not need to install Node.js, FFmpeg, FFprobe, npm, or other developer tools.
