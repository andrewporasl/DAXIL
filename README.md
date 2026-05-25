# DAXIL

Minimal local video trimming, compression, and export for desktop. DAXIL runs entirely on your machine with Electron, React, and FFmpeg, so there are no uploads, accounts, or cloud processing steps in the loop.

## What It Does

- Load a local video from the large `+` add target, drag and drop, or the top-bar `Open Video` action
- Preview footage directly in-app with transport controls and a thumbnail timeline
- Set trim ranges with draggable in/out handles and quick `Set In`, `Set Out`, and `Reset` actions
- Export as:
  - `MP4`
  - `MP4 mute`
  - `MP3`
  - `GIF`
- Apply compression presets from `Original` through `90% smaller`
- See estimated output sizes before rendering
- Track export progress with a live FFmpeg log
- Open another clip in the same window or launch a fresh editor with `New Window`
- Configure FFmpeg, FFprobe, and the default output folder in Settings

## Current UI Flow

1. Open a file with the `+` box or `Open Video`.
2. Scrub the preview and adjust the trim range on the timeline.
3. Pick a compression preset and export format.
4. Choose the output folder.
5. Export, then open the result folder or start another export.

If you want to work on a second clip without replacing the current one, use `New Window`.

## Requirements

- Node.js `18+`
- `ffmpeg`
- `ffprobe`

### Installing FFmpeg on Windows

Recommended:

```bash
winget install Gyan.FFmpeg
```

Manual install:

- Download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)
- Add the `bin/` directory to your `PATH`

Verify the install:

```bash
ffmpeg -version
ffprobe -version
```

If FFmpeg is not available on your `PATH`, open DAXIL Settings and point the app to the full executable paths.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

This produces the Electron app bundles in `out/`.

## Package

```bash
npm run package
```

That builds an installable package for the current platform into `dist/`.

Platform-specific packaging commands:

```bash
npm run package:mac
npm run package:win
```

Architecture-specific macOS builds:

```bash
npm run package:mac:x64
npm run package:mac:arm64
```

## GitHub Releases

Tagged releases build installable artifacts automatically through GitHub Actions.

1. Bump the app version in `package.json`.
2. Create and push a tag like `v0.1.1`.
3. GitHub Actions builds:
   - Windows `x64` NSIS installer
   - macOS `x64` DMG + ZIP
   - macOS `arm64` DMG + ZIP
4. The workflow attaches those files to the GitHub Release for that tag.

If signing secrets are configured in GitHub, `electron-builder` can use them during release packaging. Without signing, the builds still package successfully, but macOS may show the standard first-run security prompt.

## Architecture

```text
DAXIL/
├── main/
│   ├── index.ts      Electron app entry, window creation, safe-file:// protocol
│   ├── ipc.ts        IPC handlers for dialogs, metadata, thumbnails, exports, settings
│   ├── preload.ts    contextBridge API exposed to the renderer
│   ├── ffmpeg.ts     FFmpeg command building, execution, progress parsing, GIF pipeline
│   └── ffprobe.ts    Source metadata reader
├── renderer/
│   └── src/
│       ├── App.tsx                Main workspace state and layout
│       ├── components/
│       │   ├── FileDropZone.tsx   Add/replace video entry point
│       │   ├── VideoTimeline.tsx  Preview, transport, trim handles, thumbnail strip
│       │   └── ...
│       └── lib/sizeEstimator.ts   Output size estimation helpers
└── shared/
    └── types.ts      Shared TypeScript contracts
```

## Implementation Notes

- Local preview uses a custom `safe-file://` protocol so Electron can reliably stream local media files, including absolute paths and filenames with spaces.
- Thumbnail strips are generated through FFmpeg after metadata loads.
- Compression is bitrate-targeted based on the selected reduction preset and the effective trimmed duration.
- GIF export uses a two-pass palette workflow for cleaner results.
- When there is no trim and no compression, MP4 export uses stream copy for fast output.
- When trimming without compression, DAXIL re-encodes at high quality to produce a clean clipped file.

## Representative FFmpeg Output Paths

### MP4 copy

```bash
ffmpeg -y -i input.mp4 -c copy output.mp4
```

### Trimmed MP4

```bash
ffmpeg -y -i input.mp4 -ss 10 -to 80 -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k output.mp4
```

### Compressed MP4

```bash
ffmpeg -y -i input.mp4 -c:v libx264 -preset fast -b:v <calculated>k -c:a aac -b:a 128k output.mp4
```

### Muted MP4

```bash
ffmpeg -y -i input.mp4 -c:v libx264 -preset fast -b:v <calculated>k -an output.mp4
```

### MP3 extract

```bash
ffmpeg -y -i input.mp4 -vn -c:a libmp3lame -b:a 192k output.mp3
```

### GIF export

```bash
ffmpeg -y -i input.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,palettegen" palette.png
ffmpeg -y -i input.mp4 -i palette.png -lavfi "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" output.gif
```
