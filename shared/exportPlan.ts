import type { ExportOptions, VideoMetadata, Clip } from './types'

export function clipHasSound(clip: Clip, options: Pick<ExportOptions, 'media' | 'mutedAudioTracks' | 'muteAudio'>, primaryAudioCodec: string): boolean {
  if (options.muteAudio || clip.muted || clip.volume <= 0) return false
  if (clip.kind === 'audio') return !(options.mutedAudioTracks ?? []).includes(clip.track)
  const codec = options.media?.find(asset => asset.id === clip.mediaId)?.metadata.audioCodec ?? primaryAudioCodec
  return codec !== 'none'
}

export function timelineSpan(clips: Clip[], hiddenVideoTracks: number[] = []): number {
  return clips.reduce((end, clip) => clip.kind === 'video' && hiddenVideoTracks.includes(clip.track) ? end : Math.max(end, clip.timelineStart + clip.endSeconds - clip.startSeconds), 0)
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
