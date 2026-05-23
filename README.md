# DAXIL — Local Video Editor & Compressor

A clean, local desktop app for compressing, trimming, and converting video files. Powered by FFmpeg. No uploads, no servers — fully private.

## Features

- **Video selection** with drag & drop + metadata display (duration, resolution, codec, size)
- **HTML5 video preview** in-app
- **Compression presets** — 25%, 50%, 75%, 90% reduction with estimated output sizes
- **Trim/cut** — set start and end time, combinable with compression
- **MP4 → MP3** audio extraction at 128k, 192k, or 320k
- **Export progress** with real-time progress bar and collapsible FFmpeg log
- **Cancel** mid-export
- **Open output folder** on completion
- **Settings** — configure custom FFmpeg/ffprobe paths and default output folder

## Requirements

- **Node.js** 18+ (tested on Node 22)
- **FFmpeg** and **ffprobe** installed and in your PATH

### Installing FFmpeg on Windows

**Option 1 — winget (recommended):**
```
winget install Gyan.FFmpeg
```

**Option 2 — manual:** Download from https://www.gyan.dev/ffmpeg/builds/ and add the `bin/` folder to your system PATH.

**Verify installation:**
```
ffmpeg -version
ffprobe -version
```

If FFmpeg is not in your PATH, open DAXIL Settings and provide the full path to the executables (e.g. `C:\ffmpeg\bin\ffmpeg.exe`).

## Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package as a Windows installer (requires build first)
npm run package
```

The packaged `.exe` installer will be in the `dist/` folder.

## Project Structure

```
DAXIL/
├── main/           Electron main process
│   ├── index.ts    App entry, BrowserWindow, safe-file:// protocol
│   ├── preload.ts  contextBridge API
│   ├── ipc.ts      IPC handler registrations
│   ├── ffmpeg.ts   FFmpeg command builder + runner
│   └── ffprobe.ts  Video metadata reader
├── renderer/       React frontend
│   └── src/
│       ├── App.tsx             Main layout & state
│       ├── components/         UI components
│       └── lib/sizeEstimator   Size/bitrate calculation
└── shared/
    └── types.ts    Shared TypeScript interfaces
```

## FFmpeg Commands Used

**Compress MP4 (e.g. 50% smaller):**
```
ffmpeg -y -i input.mp4 -c:v libx264 -preset fast -b:v <calculated>k -c:a aac -b:a 128k output.mp4
```

**Trim + compress:**
```
ffmpeg -y -i input.mp4 -ss 10 -to 80 -c:v libx264 -preset fast -b:v <calculated>k -c:a aac -b:a 128k output.mp4
```

**Stream copy (no compression):**
```
ffmpeg -y -i input.mp4 -c copy output.mp4
```

**Extract MP3 audio:**
```
ffmpeg -y -i input.mp4 -vn -c:a libmp3lame -b:a 192k output.mp3
```

**Bitrate calculation for target size:**
```
target_bitrate_bps = (target_size_bytes * 8) / duration_seconds
video_bitrate_kbps = max((target_bitrate_bps - audio_bitrate_bps) / 1000, 200)
```

## Post-MVP Ideas

- Drag-and-drop file upload
- Waveform visualization
- Thumbnail generation
- Batch processing
- Custom bitrate / resolution inputs
- Export presets (Discord <8MB, YouTube, Instagram Reels, email-safe)
- Hardware acceleration (NVENC, Intel QuickSync)
