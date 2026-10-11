import { app } from 'electron'
import * as fs from 'fs'
import { packagedBinaryPath, validateBinary } from './binaryValidation'
export { validateBinary }

const ffmpegStatic = require('ffmpeg-static') as string | null
const ffprobeStatic = require('ffprobe-static') as { path?: string } | null

const AUTO_SETTING = 'auto'

function toUnpackedPath(binaryPath: string | null | undefined): string | null {
  if (!binaryPath) return null
  if (app.isPackaged) {
    return packagedBinaryPath(app.getAppPath(), binaryPath)
  }
  return binaryPath
}

const bundledPaths = {
  ffmpeg: toUnpackedPath(ffmpegStatic),
  ffprobe: toUnpackedPath(ffprobeStatic?.path)
}

export function getDefaultBinarySetting(): string {
  return AUTO_SETTING
}

export function resolveBinaryPath(kind: 'ffmpeg' | 'ffprobe', setting: string | undefined): string {
  const value = (setting ?? '').trim()
  const isAuto = value === '' || value === AUTO_SETTING || value === kind
  if (!isAuto) return value
  const bundled = bundledPaths[kind]
  return bundled && fs.existsSync(bundled) ? bundled : kind
}


export function hasBundledBinary(kind: 'ffmpeg' | 'ffprobe'): boolean {
  return Boolean(bundledPaths[kind])
}
