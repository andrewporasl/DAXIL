import type { ExportMode } from './types'

// Where "Convert and save" puts a file: MP3s go to their own folder when one is set (for example
// Spotify's local files), everything else to the converted-links folder. Blank values fall through.
export function convertDirFor(mode: ExportMode, dirs: { convertOutputDir?: string; mp3OutputDir?: string }, fallback: string): string {
  const convert = dirs.convertOutputDir?.trim() || fallback
  return mode === 'audio' ? dirs.mp3OutputDir?.trim() || convert : convert
}
