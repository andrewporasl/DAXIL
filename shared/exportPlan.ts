import type { ExportOptions, VideoMetadata, TimelineClip } from './types'

/** Bitrate targets are not predictions: CRF/GIF size depends on the encoded content. */
export function exportPlan(options: ExportOptions, primary: Pick<VideoMetadata, 'fileSizeBytes' | 'durationSeconds' | 'audioCodec'>) {
  const clips: TimelineClip[] = options.clips ?? [{ id: 'source', startSeconds: options.trim.enabled ? options.trim.startSeconds : 0, endSeconds: options.trim.enabled ? options.trim.endSeconds : primary.durationSeconds }]
  const source = (id?: string) => options.media?.find(asset => asset.id === id)?.metadata ?? primary
  const duration = clips.reduce((sum, clip) => sum + clip.endSeconds - clip.startSeconds, 0) / (options.playbackRate ?? 1)
  const audio = options.mode !== 'gif' && !options.muteAudio && (clips.some(clip => source(clip.mediaId).audioCodec !== 'none') || Boolean(options.audioClips?.some(clip => clip.volume > 0)))
  const audioKbps = audio ? options.mode === 'audio' ? options.mp3Bitrate ?? 192 : options.compressionLevel === 'none' ? 192 : 128 : 0
  const sourceBytes = clips.reduce((sum, clip) => {
    const meta = source(clip.mediaId)
    return sum + meta.fileSizeBytes * (clip.endSeconds - clip.startSeconds) / Math.max(meta.durationSeconds, 0.001)
  }, 0)
  const reduction = options.compressionLevel === 'none' ? 0 : Number(options.compressionLevel) / 100
  const videoKbps = reduction ? Math.max(200, Math.floor(sourceBytes * (1 - reduction) * 8 / Math.max(duration, 0.001) / 1000 - audioKbps)) : null
  const targetBytes = options.mode === 'gif' || (options.mode === 'video' && videoKbps === null) ? null : Math.round(((options.mode === 'audio' ? 0 : videoKbps ?? 0) + audioKbps) * 1000 / 8 * duration)
  return { duration, audio, audioKbps, videoKbps, targetBytes }
}
