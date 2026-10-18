import type { Clip, ExportOptions } from '../shared/types'
import { clipDuration, clipHasSound, clipSpeed, MAX_CLIP_SPEED, MAX_VOLUME, MIN_CLIP_SPEED, timelineSpan } from '../shared/exportPlan.ts'

// atempo only takes 0.5–2 per stage, so bigger changes are chained. Pitch is kept.
export function atempoChain(speed: number): string {
  const stages: string[] = []
  let rest = speed
  while (rest > 2) { stages.push('atempo=2'); rest /= 2 }
  while (rest < 0.5) { stages.push('atempo=0.5'); rest /= 0.5 }
  if (Math.abs(rest - 1) > 1e-6) stages.push(`atempo=${Number(rest.toFixed(6))}`)
  return stages.join(',')
}

export interface GraphInput {
  index: number
  durationSeconds: number
}

// Composite every video track over black and mix every sounding clip over silence.
// Lower tracks go first so a higher track always draws on top; on one track a later
// clip draws over an earlier one. Text clips arrive as full-frame PNG inputs and sit
// above all video. Returns the labels the crop/speed/encode stages use.
export function buildTimelineGraph(
  options: ExportOptions,
  inputFor: (mediaId: string) => GraphInput,
  frameWidth: number,
  frameHeight: number,
  fps: number,
  primaryAudioCodec: string,
  wantVideo: boolean,
  wantAudio: boolean,
  textInputFor?: (clip: Clip, length: number) => number
): { filters: string[]; video: string; audio: string | null; duration: number } {
  const clips = options.clips ?? []
  const hidden = options.hiddenVideoTracks ?? []
  const duration = timelineSpan(clips, hidden)
  if (duration <= 0) throw new Error('Add at least one clip before exporting.')
  const filters: string[] = []
  const fix = (value: number) => value.toFixed(3)
  for (const clip of clips) {
    if (clip.kind === 'text') {
      if (!(clip.endSeconds - clip.startSeconds >= 0.05) || !Number.isFinite(clip.timelineStart) || clip.timelineStart < 0) throw new Error('A text clip has an invalid length.')
      continue
    }
    const input = inputFor(clip.mediaId)
    const length = clip.endSeconds - clip.startSeconds
    if (!Number.isFinite(length) || length < 0.1 || clip.startSeconds < 0 || clip.endSeconds > input.durationSeconds + 0.01 || !Number.isFinite(clip.timelineStart) || clip.timelineStart < 0) {
      throw new Error('A clip has an invalid source range.')
    }
    if (clip.kind === 'video' && (!(clip.scale > 0 && clip.scale <= 1) || !(clip.opacity >= 0 && clip.opacity <= 1))) throw new Error('A video clip has an invalid size or opacity.')
    if (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > MAX_VOLUME + 1e-6) throw new Error('A clip has an invalid volume.')
    if (clip.speed !== undefined && !(clip.speed >= MIN_CLIP_SPEED && clip.speed <= MAX_CLIP_SPEED)) throw new Error('A clip has an invalid speed.')
  }

  let video = 'vbase'
  if (wantVideo) {
    filters.push(`color=c=black:s=${frameWidth}x${frameHeight}:r=${fps}:d=${fix(duration)},format=yuv420p[vbase]`)
    const visible = clips
      .filter(clip => clip.kind === 'video' && !hidden.includes(clip.track))
      .sort((a, b) => a.track - b.track || a.timelineStart - b.timelineStart)
    visible.forEach((clip, index) => {
      const input = inputFor(clip.mediaId)
      const speed = clipSpeed(clip)
      const start = fix(clip.timelineStart)
      const end = fix(clip.timelineStart + clipDuration(clip))
      // A clip's own speed stretches or squeezes its timestamps; fps= then drops or repeats frames.
      const pts = speed === 1 ? `PTS-STARTPTS+${start}/TB` : `(PTS-STARTPTS)/${Number(speed.toFixed(6))}+${start}/TB`
      const full = clip.scale >= 0.999 && Math.abs(clip.x) < 0.001 && Math.abs(clip.y) < 0.001
      const scale = full
        ? `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${Math.max(2, Math.round(frameWidth * clip.scale / 2) * 2)}:-2`
      const alpha = clip.opacity < 1 ? `,colorchannelmixer=aa=${clip.opacity.toFixed(3)}` : ''
      filters.push(`[${input.index}:v]trim=start=${clip.startSeconds}:end=${clip.endSeconds},setpts=${pts},fps=${fps},${scale},setsar=1,format=yuva420p${alpha}[c${index}]`)
      const next = `v${index}`
      filters.push(`[${video}][c${index}]overlay=x=${Math.round(frameWidth * clip.x)}:y=${Math.round(frameHeight * clip.y)}:eof_action=pass:enable='between(t,${start},${end})'[${next}]`)
      video = next
    })
    const texts = clips.filter(clip => clip.kind === 'text').sort((a, b) => a.track - b.track || a.timelineStart - b.timelineStart)
    texts.forEach((clip, index) => {
      if (!textInputFor) throw new Error('Text could not be prepared for export.')
      const length = clip.endSeconds - clip.startSeconds
      const start = fix(clip.timelineStart)
      const end = fix(clip.timelineStart + length)
      filters.push(`[${textInputFor(clip, length)}:v]scale=${frameWidth}:${frameHeight},format=rgba,setpts=PTS-STARTPTS+${start}/TB[t${index}]`)
      const next = `vt${index}`
      filters.push(`[${video}][t${index}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${start},${end})'[${next}]`)
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
      const tempo = clipSpeed(clip) === 1 ? '' : `,${atempoChain(clipSpeed(clip))}`
      filters.push(`[${input.index}:a]atrim=start=${clip.startSeconds}:end=${clip.endSeconds},asetpts=PTS-STARTPTS${tempo},aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},adelay=${Math.round(clip.timelineStart * 1000)}:all=1[a${index}]`)
      labels.push(`[a${index}]`)
    })
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=duration=${fix(duration)}[acat]`)
    audio = 'acat'
  }
  return { filters, video, audio, duration }
}
