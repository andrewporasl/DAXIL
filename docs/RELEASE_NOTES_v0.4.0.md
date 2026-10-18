# DAXIL v0.4.0 Release Notes

Titles, per-clip speed and sound, a faster way to convert links, and DAXIL now updates itself. This is the last version you need to download by hand.

## New

- **Text overlays.** Press **T** or click **Text** to add a title at the playhead on its own text track (T1, T2…). Edit the words, choose from eight basic fonts (Sans, Serif, Mono, Impact, Verdana, Trebuchet, Script, Comic), size, colour, bold/italic, alignment, and a Plain, Shadow, Outline or Box style. Drag it around the preview, stretch it on the timeline, double-click to edit. Text is drawn with the same code for the preview and the export, so what you see is exactly what you get.
- **Clip properties.** A new section at the top of the inspector shows the selected clip: its source (resolution, frame rate, codecs, length), in and out points, and length on the timeline. Each clip, including one piece of a split clip, can have its own:
  - **Speed** from 0.1× to 16× (presets 0.25×–4×, or a custom value). It multiplies with the project speed, so a 2× piece in a 2× project plays at 4× while the rest plays at 2×. Sound keeps its pitch. Fast clips show a speed badge on the timeline.
  - **Gain** in decibels, from −40 dB to +12 dB, with −3 / 0 / +3 dB buttons, or mute. Works on video clips with sound and on MP3, WAV and other audio clips. Boosts are heard in live playback, not just in the export.
  - Size, position and opacity for video.
- **Link dialog.** Pasting a link (anywhere, or in the link box) now asks what you want:
  - **Add to media pool** to edit it, as before. This is the default, so Enter works as before.
  - **Convert and save** to MP4, MP3 or GIF straight away, without touching your project. Converted files go to a new **Converted links folder** (Settings → General, default: Downloads), kept apart from your exports and never overwritten. Sound-only links always become MP3.
- **Copy and paste clips.** Ctrl+C, Ctrl+X and Ctrl+V on the timeline. Pasted clips land at the playhead, keep their spacing, and move up a track if they would overlap something. A link you copied after your clips still pastes as a link.
- **Snapping in the preview.** Video layers and text snap their edges and centre to the canvas edges and centre lines, with pink guides while you drag. Resizing snaps too. Hold Alt to place freely.
- **Sound-only projects.** Import just a song and DAXIL starts a project with it on A1. A timeline with only sound exports as MP3, and the other formats are disabled with a note saying why.
- **In-app updates.** DAXIL checks for a new version shortly after it starts (you can turn this off) and from **Settings → General → Updates**. On the Windows installer and Linux AppImage, click **Download**, keep working, then **Restart and update**; the update installs silently and DAXIL reopens. macOS builds (unsigned) and the ZIP/tarball builds tell you about a new version and open its download page.
- **Canvas size menu.** Landscape 1080p/720p, portrait, square, 4:5, match any clip in the pool, or a custom size. Change it at any time; clip positions follow.
- **Preview 5s** renders five seconds from the playhead through the real export, so crop, canvas, compression and speed look exactly as they will.
- **Phone and pro formats.** iPhone HEVC/HDR `.mov` files (including portrait), ProRes and Motion JPEG get a lightweight preview copy automatically. Export always reads the original.
- **Storage in Settings.** Every place DAXIL keeps files (exports, converted links, temporary downloads, previews, settings, tools) with a button to open each.
- **Supported sites list** under the link box ("What works?").

## Changed

- **Temporary downloads.** Files downloaded from links are deleted when you remove them from the pool, close the window, or choose **Delete** after an export. Undo can't bring back a clip whose download was deleted. Files you import yourself are never touched.
- **Timeline** keeps a little empty space after the last clip and can zoom out further, so there's always room to drop clips at the end. Dragging clips up opens at most one new track at a time, and empty tracks close up.
- **Transform and crop** controls sit in a compact strip under the preview.
- Light themes: the start screen now uses the theme's colours instead of a black box, and light themes no longer flash dark on launch.

## Fixed

- Dragging a layer in the preview no longer starts or stops playback when you let go.
- Keyboard shortcuts no longer break in some cases where the key event doesn't come from an element on the page.

## Privacy

Your media still never leaves your machine. Network activity is limited to fetching yt-dlp on first use, the links you paste, and the update check, which asks GitHub Releases for the newest DAXIL version and sends nothing about you or your files. You can turn the update check off in Settings.

## Upgrade Notes

- Updating from 0.3.0 or earlier needs one manual download: those versions don't have the updater. From 0.4.0 on, updates arrive in the app.
- Settings are kept. Two new settings get defaults: **Converted links folder** (your Downloads folder) and **Check for updates when DAXIL starts** (on).
- Builds remain unsigned; see [INSTALLATION.md](INSTALLATION.md) for first-launch prompts.
