import type { VideoMetadata, TrimRange, Mp3Bitrate, GifScale } from '../../../shared/types'

const OVERESTIMATE = 1.15

function effectiveDuration(meta: VideoMetadata, trim: TrimRange): number {
  if (trim.enabled && trim.endSeconds > trim.startSeconds) {
    return trim.endSeconds - trim.startSeconds
  }
  return meta.durationSeconds
}

export function estimateTrimmedSize(meta: VideoMetadata, trim: TrimRange): number {
  const duration = effectiveDuration(meta, trim)
  const fullDuration = meta.durationSeconds > 0 ? meta.durationSeconds : 1
  const ratio = duration / fullDuration
  return Math.round(meta.fileSizeBytes * ratio * OVERESTIMATE)
}

export function estimateCompressedSize(
  meta: VideoMetadata,
  reductionFactor: number,
  trim: TrimRange
): number {
  const duration = effectiveDuration(meta, trim)
  const fullDuration = meta.durationSeconds > 0 ? meta.durationSeconds : 1
  const trimRatio = duration / fullDuration
  const baseSize = meta.fileSizeBytes * trimRatio
  return Math.round(baseSize * (1 - reductionFactor) * OVERESTIMATE)
}

export function estimateMp3Size(
  meta: VideoMetadata,
  mp3Bitrate: Mp3Bitrate,
  trim: TrimRange
): number {
  const duration = effectiveDuration(meta, trim)
  return Math.round((mp3Bitrate * 1000) / 8 * duration)
}

export function estimateGifSize(
  meta: VideoMetadata,
  scale: GifScale,
  trim: TrimRange
): number {
  const duration = effectiveDuration(meta, trim)
  const height = Math.round(scale * 9 / 16)
  // ~12fps, ~0.35 bytes/pixel after palette compression
  return Math.round(scale * height * 12 * duration * 0.35 * OVERESTIMATE)
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function parseTimeInput(val: string): number | null {
  val = val.trim()
  if (!val) return null
  if (/^\d+(\.\d+)?$/.test(val)) return parseFloat(val)
  const parts = val.split(':').map((p) => parseFloat(p))
  if (parts.some(isNaN)) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}
