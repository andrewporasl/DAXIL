import * as path from 'path'
import type { ExportMode } from '../shared/types'

export function extensionForMode(mode: ExportMode): string {
  return mode === 'audio' ? '.mp3' : mode === 'gif' ? '.gif' : '.mp4'
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
