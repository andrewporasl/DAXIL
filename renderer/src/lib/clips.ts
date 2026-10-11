export interface TimelineClip {
  id: string
  mediaId?: string
  startSeconds: number
  endSeconds: number
}

export const MIN_CLIP_SECONDS = 0.1

export function trimClipEdge(
  clip: TimelineClip,
  edge: 'start' | 'end',
  sourceTime: number,
  sourceDuration: number,
  fps = 30
): TimelineClip {
  if (!Number.isFinite(sourceTime) || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return clip
  const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30
  const snapped = Math.round(sourceTime * frameRate) / frameRate
  const minimum = Math.min(MIN_CLIP_SECONDS, clip.endSeconds - clip.startSeconds)
  return edge === 'start'
    ? { ...clip, startSeconds: Math.max(0, Math.min(snapped, clip.endSeconds - minimum)) }
    : { ...clip, endSeconds: Math.max(clip.startSeconds + minimum, Math.min(snapped, sourceDuration)) }
}

export function updateClipRange(clips: TimelineClip[], id: string, start: number, end: number, sourceDuration: number): TimelineClip[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sourceDuration || end - start < MIN_CLIP_SECONDS - 1e-8) return clips
  const clip = clips.find(item => item.id === id)
  if (!clip || (Math.abs(clip.startSeconds - start) < 1e-8 && Math.abs(clip.endSeconds - end) < 1e-8)) return clips
  return clips.map(item => item.id === id ? { ...item, startSeconds: start, endSeconds: end } : item)
}

// Keep the same source frame under the playhead when an earlier clip changes length.
export function remapPlayhead(before: TimelineClip[], after: TimelineClip[], time: number): number {
  const active = clipAtTime(before, time)
  if (!active) return 0
  const index = after.findIndex(clip => clip.id === active.clip.id)
  if (index < 0) return Math.min(time, timelineDuration(after))
  const clip = after[index]
  return timelineDuration(after.slice(0, index)) + Math.max(0, Math.min(clip.endSeconds - clip.startSeconds, active.sourceTime - clip.startSeconds))
}

export function timelineDuration(clips: TimelineClip[]): number {
  return clips.reduce((total, clip) => total + clip.endSeconds - clip.startSeconds, 0)
}

export function clipAtTime(clips: TimelineClip[], time: number): { index: number; clip: TimelineClip; offset: number; sourceTime: number } | null {
  if (!clips.length) return null
  let offset = 0
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index]
    const length = clip.endSeconds - clip.startSeconds
    if (time < offset + length || index === clips.length - 1) {
      return { index, clip, offset, sourceTime: clip.startSeconds + Math.max(0, Math.min(length, time - offset)) }
    }
    offset += length
  }
  return null
}

export function splitClip(clips: TimelineClip[], time: number, newId: string): TimelineClip[] | null {
  const active = clipAtTime(clips, time)
  if (!active) return null
  const { index, clip, sourceTime } = active
  if (sourceTime <= clip.startSeconds + MIN_CLIP_SECONDS || sourceTime >= clip.endSeconds - MIN_CLIP_SECONDS) return null
  return [
    ...clips.slice(0, index),
    { ...clip, endSeconds: sourceTime },
    { ...clip, id: newId, startSeconds: sourceTime, endSeconds: clip.endSeconds },
    ...clips.slice(index + 1)
  ]
}

export function moveClip(clips: TimelineClip[], from: number, to: number): TimelineClip[] {
  if (from < 0 || from >= clips.length || to < 0 || to >= clips.length || from === to) return clips
  const result = [...clips]
  result.splice(to, 0, result.splice(from, 1)[0])
  return result
}

// The destination is a boundary in the original sequence, including length (the end).
export function moveClips(clips: TimelineClip[], ids: string[], destination: number): TimelineClip[] {
  const selected = new Set(ids)
  const moving = clips.filter(clip => selected.has(clip.id))
  if (!moving.length) return clips
  const boundary = Math.max(0, Math.min(clips.length, destination))
  const insertion = clips.slice(0, boundary).filter(clip => !selected.has(clip.id)).length
  const remaining = clips.filter(clip => !selected.has(clip.id))
  const result = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
  return result.every((clip, index) => clip === clips[index]) ? clips : result
}

export function selectClips(clips: TimelineClip[], selected: string[], id: string, mode: 'replace' | 'toggle' | 'range' | 'preserve', anchor: string | null): string[] {
  if (mode === 'preserve' && selected.includes(id)) return selected
  if (mode === 'toggle') return selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
  if (mode === 'range' && anchor) {
    const a = clips.findIndex(clip => clip.id === anchor)
    const b = clips.findIndex(clip => clip.id === id)
    if (a >= 0 && b >= 0) return clips.slice(Math.min(a, b), Math.max(a, b) + 1).map(clip => clip.id)
  }
  return [id]
}

export function dropBoundary(clips: TimelineClip[], time: number): number {
  let offset = 0
  for (let i = 0; i < clips.length; i++) {
    const length = clips[i].endSeconds - clips[i].startSeconds
    if (time < offset + length / 2) return i
    offset += length
  }
  return clips.length
}
