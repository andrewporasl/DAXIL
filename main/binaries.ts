const ffmpegStatic = require('ffmpeg-static') as string | null
const ffprobeStatic = require('ffprobe-static') as { path?: string } | null

const AUTO_SETTING = 'auto'

function toUnpackedPath(binaryPath: string | null | undefined): string | null {
  if (!binaryPath) return null
  return binaryPath.replace('app.asar', 'app.asar.unpacked')
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
  return bundledPaths[kind] ?? kind
}

export function hasBundledBinary(kind: 'ffmpeg' | 'ffprobe'): boolean {
  return Boolean(bundledPaths[kind])
}
