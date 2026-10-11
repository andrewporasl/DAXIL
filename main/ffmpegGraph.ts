import type { OverlayClip } from '../shared/types'

export interface OverlayInput {
  index: number
  durationSeconds: number
  width: number
  height: number
}

// Chain picture-in-picture overlays on top of the concatenated sequence. Lower
// tracks are composited first so a higher track always shows on top. Returns the
// filter lines and the label that now carries the composited video.
export function buildOverlayFilters(
  overlays: OverlayClip[],
  hiddenTracks: number[],
  frameWidth: number,
  frameHeight: number,
  inputFor: (mediaId: string) => OverlayInput,
  baseLabel = 'vcat'
): { filters: string[]; output: string } {
  const filters: string[] = []
  let current = baseLabel
  const visible = overlays
    .filter(clip => !hiddenTracks.includes(clip.track))
    .sort((a, b) => a.track - b.track || a.timelineStart - b.timelineStart)
  visible.forEach((clip, index) => {
    const input = inputFor(clip.mediaId)
    const length = clip.endSeconds - clip.startSeconds
    if (!Number.isFinite(length) || length < 0.1 || clip.startSeconds < 0 || clip.endSeconds > input.durationSeconds + 0.01 || !Number.isFinite(clip.timelineStart) || clip.timelineStart < 0) {
      throw new Error('A stacked video clip has an invalid range.')
    }
    if (!(clip.scale > 0 && clip.scale <= 1) || !(clip.opacity >= 0 && clip.opacity <= 1)) throw new Error('A stacked video clip has an invalid size or opacity.')
    const width = Math.max(2, Math.round(frameWidth * clip.scale / 2) * 2)
    const x = Math.round(frameWidth * clip.x)
    const y = Math.round(frameHeight * clip.y)
    const start = clip.timelineStart.toFixed(3)
    const end = (clip.timelineStart + length).toFixed(3)
    const alpha = clip.opacity < 1 ? `,colorchannelmixer=aa=${clip.opacity.toFixed(3)}` : ''
    filters.push(`[${input.index}:v]trim=start=${clip.startSeconds}:end=${clip.endSeconds},setpts=PTS-STARTPTS+${start}/TB,scale=${width}:-2,format=yuva420p${alpha}[ov${index}]`)
    const next = `vov${index}`
    filters.push(`[${current}][ov${index}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${start},${end})'[${next}]`)
    current = next
  })
  return { filters, output: current }
}
