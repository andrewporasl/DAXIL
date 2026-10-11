import type { ExportOptions } from '../shared/types'
import { clipHasSound, timelineSpan } from '../shared/exportPlan.ts'

export interface GraphInput {
  index: number
  durationSeconds: number
}

// Composite every video track over black and mix every sounding clip over silence.
// Lower tracks go first so a higher track always draws on top; on one track a later
// clip draws over an earlier one. Returns the labels the crop/speed/encode stages use.
export function buildTimelineGraph(
  options: ExportOptions,
  inputFor: (mediaId: string) => GraphInput,
  frameWidth: number,
  frameHeight: number,
  fps: number,
  primaryAudioCodec: string,
  wantVideo: boolean,
  wantAudio: boolean
): { filters: string[]; video: string; audio: string | null; duration: number } {
  const clips = options.clips ?? []
  const hidden = options.hiddenVideoTracks ?? []
  const duration = timelineSpan(clips, hidden)
  if (duration <= 0) throw new Error('Add at least one clip before exporting.')
  const filters: string[] = []
  const fix = (value: number) => value.toFixed(3)
  for (const clip of clips) {
    const input = inputFor(clip.mediaId)
    const length = clip.endSeconds - clip.startSeconds
    if (!Number.isFinite(length) || length < 0.1 || clip.startSeconds < 0 || clip.endSeconds > input.durationSeconds + 0.01 || !Number.isFinite(clip.timelineStart) || clip.timelineStart < 0) {
      throw new Error('A clip has an invalid source range.')
    }
    if (clip.kind === 'video' && (!(clip.scale > 0 && clip.scale <= 1) || !(clip.opacity >= 0 && clip.opacity <= 1))) throw new Error('A video clip has an invalid size or opacity.')
    if (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2) throw new Error('A clip has an invalid volume.')
  }

  let video = 'vbase'
  if (wantVideo) {
    filters.push(`color=c=black:s=${frameWidth}x${frameHeight}:r=${fps}:d=${fix(duration)},format=yuv420p[vbase]`)
    const visible = clips
      .filter(clip => clip.kind === 'video' && !hidden.includes(clip.track))
      .sort((a, b) => a.track - b.track || a.timelineStart - b.timelineStart)
    visible.forEach((clip, index) => {
      const input = inputFor(clip.mediaId)
      const length = clip.endSeconds - clip.startSeconds
      const start = fix(clip.timelineStart)
      const end = fix(clip.timelineStart + length)
      const full = clip.scale >= 0.999 && Math.abs(clip.x) < 0.001 && Math.abs(clip.y) < 0.001
      const scale = full
        ? `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${Math.max(2, Math.round(frameWidth * clip.scale / 2) * 2)}:-2`
      const alpha = clip.opacity < 1 ? `,colorchannelmixer=aa=${clip.opacity.toFixed(3)}` : ''
      filters.push(`[${input.index}:v]trim=start=${clip.startSeconds}:end=${clip.endSeconds},setpts=PTS-STARTPTS+${start}/TB,fps=${fps},${scale},setsar=1,format=yuva420p${alpha}[c${index}]`)
      const next = `v${index}`
      filters.push(`[${video}][c${index}]overlay=x=${Math.round(frameWidth * clip.x)}:y=${Math.round(frameHeight * clip.y)}:eof_action=pass:enable='between(t,${start},${end})'[${next}]`)
      video = next
    })
  }

  let audio: string | null = null
  if (wantAudio) {
    const sounding = clips.filter(clip => clipHasSound(clip, options, primaryAudioCodec))
    const labels = ['[asilence]']
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${fix(duration)}[asilence]`)
    sounding.forEach((clip, index) => {
      const input = inputFor(clip.mediaId)
      filters.push(`[${input.index}:a]atrim=start=${clip.startSeconds}:end=${clip.endSeconds},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},adelay=${Math.round(clip.timelineStart * 1000)}:all=1[a${index}]`)
      labels.push(`[a${index}]`)
    })
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=duration=${fix(duration)}[acat]`)
    audio = 'acat'
  }
  return { filters, video, audio, duration }
}
