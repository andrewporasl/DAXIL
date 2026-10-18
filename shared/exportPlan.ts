import type { ExportOptions, VideoMetadata, Clip } from './types'

export function clipHasSound(clip: Clip, options: Pick<ExportOptions, 'media' | 'mutedAudioTracks' | 'muteAudio'>, primaryAudioCodec: string): boolean {
  if (clip.kind === 'text' || options.muteAudio || clip.muted || clip.volume <= 0) return false
  if (clip.kind === 'audio') return !(options.mutedAudioTracks ?? []).includes(clip.track)
  const codec = options.media?.find(asset => asset.id === clip.mediaId)?.metadata.audioCodec ?? primaryAudioCodec
  return codec !== 'none'
}

// Clip volume is stored as a linear gain (1 = unchanged) and shown in decibels.
export const MIN_VOLUME_DB = -40
export const MAX_VOLUME_DB = 12
export const MAX_VOLUME = 10 ** (MAX_VOLUME_DB / 20)
export const gainToDb = (gain: number): number => gain > 0 ? 20 * Math.log10(gain) : -Infinity
export const dbToGain = (db: number): number => db <= MIN_VOLUME_DB ? 0 : 10 ** (db / 20)

export const MIN_CLIP_SPEED = 0.1
export const MAX_CLIP_SPEED = 16
export const clipSpeed = (clip: Clip): number => clip.kind !== 'text' && clip.speed && clip.speed > 0 ? clip.speed : 1
// How long a clip lasts on the timeline: its source range played at its own speed.
export const clipDuration = (clip: Clip): number => (clip.endSeconds - clip.startSeconds) / clipSpeed(clip)

// A timeline with nothing to see can only be exported as sound.
export function soundOnly(clips: Clip[]): boolean {
  return clips.length > 0 && clips.every(clip => clip.kind === 'audio')
}

export function timelineSpan(clips: Clip[], hiddenVideoTracks: number[] = []): number {
  return clips.reduce((end, clip) => clip.kind === 'video' && hiddenVideoTracks.includes(clip.track) ? end : Math.max(end, clip.timelineStart + clipDuration(clip)), 0)
}

/** Bitrate targets are not predictions: CRF/GIF size depends on the encoded content. */
export function exportPlan(options: ExportOptions, primary: Pick<VideoMetadata, 'fileSizeBytes' | 'durationSeconds' | 'audioCodec'>) {
  const rate = options.playbackRate ?? 1
  const source = (id?: string) => options.media?.find(asset => asset.id === id)?.metadata ?? primary
  const clips = options.clips ?? []
  const legacyRange = options.trim.enabled ? [options.trim.startSeconds, options.trim.endSeconds] : [0, primary.durationSeconds]
  const duration = (clips.length ? timelineSpan(clips, options.hiddenVideoTracks) : legacyRange[1] - legacyRange[0]) / rate
  const audio = options.mode !== 'gif' && !options.muteAudio && (clips.length ? clips.some(clip => clipHasSound(clip, options, primary.audioCodec)) : primary.audioCodec !== 'none')
  const audioKbps = audio ? options.mode === 'audio' ? options.mp3Bitrate ?? 192 : options.compressionLevel === 'none' ? 192 : 128 : 0
  const sourceBytes = clips.length
    ? clips.filter(clip => clip.kind === 'video').reduce((sum, clip) => {
      const meta = source(clip.mediaId)
      return sum + meta.fileSizeBytes * (clip.endSeconds - clip.startSeconds) / Math.max(meta.durationSeconds, 0.001)
    }, 0)
    : primary.fileSizeBytes * (legacyRange[1] - legacyRange[0]) / Math.max(primary.durationSeconds, 0.001)
  const reduction = options.compressionLevel === 'none' ? 0 : Number(options.compressionLevel) / 100
  const videoKbps = reduction ? Math.max(200, Math.floor(sourceBytes * (1 - reduction) * 8 / Math.max(duration, 0.001) / 1000 - audioKbps)) : null
  const targetBytes = options.mode === 'gif' || (options.mode === 'video' && videoKbps === null) ? null : Math.round(((options.mode === 'audio' ? 0 : videoKbps ?? 0) + audioKbps) * 1000 / 8 * duration)
  return { duration, audio, audioKbps, videoKbps, targetBytes }
}

/** The part of the timeline inside [start, start + length), shifted to begin at 0. Used to render short previews. */
export function sliceTimeline(clips: Clip[], start: number, length: number): Clip[] {
  const end = start + length
  return clips.flatMap(clip => {
    const clipEnd = clip.timelineStart + clipDuration(clip)
    const speed = clipSpeed(clip)
    const from = Math.max(start, clip.timelineStart), to = Math.min(end, clipEnd)
    if (to - from < 0.01) return []
    const startSeconds = clip.startSeconds + (from - clip.timelineStart) * speed
    return [{ ...clip, timelineStart: from - start, startSeconds, endSeconds: startSeconds + (to - from) * speed }]
  })
}
