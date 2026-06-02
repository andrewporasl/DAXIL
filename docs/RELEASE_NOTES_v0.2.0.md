# DAXIL v0.2.0 Release Notes

## What's New

### Playback Speed Control
Select a preview playback speed (0.25×, 0.5×, 1×, 1.5×, 2×) directly in the transport bar. The chosen speed is applied to exported files — MP4 video, MP3 audio, and GIF all honour the setting. The filename automatically includes the speed suffix (e.g. `_2x`, `_0.5x`) when not at 1×.

### GIF Improvements
- **Speed fixed:** GIF exports now correctly play faster or slower when a speed is set. The previous implementation scaled the frame extraction rate (wrong); this release uses an FFmpeg `setpts` filter so the frame delays are correct.
- **Frame rate control:** Choose 8, 12, 15, or 20 fps in the export panel — trade smoothness for file size.
- **Preview:** Click "Preview GIF" to generate a quick 240px preview before committing to a full export. The preview respects all current settings (speed, fps, scale, crop, trim).

### Trim Loop
While playing, the video now loops back to the in-point automatically when the playhead reaches the out-point. Hitting Play after reaching the out-point also resets to the in-point instead of playing through to the end of the file.

### Unique Export Filenames
All export formats (MP4, MP3, GIF) auto-increment on filename collision: `file_export.mp4` → `file_export_r2.mp4` → `file_export_r3.mp4`. No more silent overwrites.

### UI Cleanup
- Duplicate badges removed from the header bar (duration and file size are shown in context in the preview and export panels)
- MetadataCard detail rows (resolution, codecs, FPS) are now collapsible via a chevron toggle
- Compression card collapses by default; shows the current level as a badge when closed
- "Playhead" badge removed from the timeline header (same value already shown in the transport row time counter)
- Light-mode filename text is now fully readable — dark foreground on all light themes

### App Icon
The app icon now has a transparent background outside the rounded shape, so it appears correctly rounded in the Windows taskbar, macOS Dock, and Linux app launchers.

---

## Bug Fixes

- GIF exports at 2× speed no longer produce corrupt or oversized output
- Playback speed is now correctly applied when a trim range is also active (trim moved to input-side seek to avoid a PTS timestamp interaction bug with the `setpts` filter)
- Light-mode themes: filename text in both the header and the source panel is now legible

---

## Upgrade Notes

No breaking changes. Existing settings and output directory preferences are preserved across the update.
