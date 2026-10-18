import * as path from 'path'
import * as fs from 'fs'
import type { ExportMode } from '../shared/types'

export function extensionForMode(mode: ExportMode): string {
  return mode === 'audio' ? '.mp3' : mode === 'gif' ? '.gif' : '.mp4'
}

// A path in `dir` for `name` that doesn't exist yet: "name.mp4", then "name (2).mp4", and so on.
export function uniqueOutputPath(dir: string, name: string, mode: ExportMode): string {
  const ext = extensionForMode(mode)
  // Path separators are stripped so a title can never point outside `dir`.
  const base = name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120) || 'clip'
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, `${base}${n > 1 ? ` (${n})` : ''}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

export function validateOutputPath(filePath: string, mode: ExportMode): string {
  const absolute = path.resolve(filePath)
  const name = path.basename(absolute)
  const ext = extensionForMode(mode)
  if (!name || name === '.' || name === '..' || /[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('Choose a valid output filename.')
  }
  if (path.extname(name).toLowerCase() !== ext) {
    throw new Error(`Output filename must end in ${ext}.`)
  }
  if (process.platform === 'win32' && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('This filename is reserved by Windows. Choose another name.')
  }
  return absolute
}
