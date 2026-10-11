import type { Clip, MediaAsset } from '../../../shared/types'

export const MIN_CLIP_SECONDS = 0.1
export const FULL_FRAME = { x: 0, y: 0, scale: 1, opacity: 1 }
export const PIP_FRAME = { x: 0.58, y: 0.05, scale: 0.4, opacity: 1 }

export const clipLength = (clip: Clip): number => clip.endSeconds - clip.startSeconds
export const clipEnd = (clip: Clip): number => clip.timelineStart + clipLength(clip)

export function timelineEnd(clips: Clip[]): number {
  return clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0)
}

export function clipsAt(clips: Clip[], time: number, kind?: Clip['kind']): Clip[] {
  return clips.filter(clip => (!kind || clip.kind === kind) && time >= clip.timelineStart - 1e-6 && time < clipEnd(clip) - 1e-6)
}

// Tracks in use plus one empty track to drop onto.
export function trackCount(clips: Clip[], kind: Clip['kind']): number {
  return clips.reduce((max, clip) => clip.kind === kind ? Math.max(max, clip.track + 1) : max, 0) + 1
}

// Topmost clip under the playhead on the lowest video track, used by I/O when nothing is selected.
export function primaryClipAt(clips: Clip[], time: number): Clip | null {
  const under = clipsAt(clips, time, 'video').sort((a, b) => a.track - b.track || b.timelineStart - a.timelineStart)
  return under[0] ?? null
}

// Source time under the playhead for a clip, or null when the playhead is outside it.
export function sourceTimeAt(clip: Clip, time: number): number | null {
  if (time < clip.timelineStart - 1e-6 || time > clipEnd(clip) + 1e-6) return null
  return clip.startSeconds + Math.max(0, Math.min(clipLength(clip), time - clip.timelineStart))
}

// Trim one edge to a source time. The start edge keeps the out point fixed on the timeline.
export function trimEdge(clip: Clip, edge: 'start' | 'end', sourceTime: number, sourceDuration: number, fps = 30): Clip {
  if (!Number.isFinite(sourceTime) || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return clip
  const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30
  const snapped = Math.round(sourceTime * frameRate) / frameRate
  const minimum = Math.min(MIN_CLIP_SECONDS, clipLength(clip))
  if (edge === 'start') {
    const start = Math.max(0, Math.min(snapped, clip.endSeconds - minimum))
    const shift = start - clip.startSeconds
    return { ...clip, startSeconds: start, timelineStart: Math.max(0, clip.timelineStart + shift) }
  }
  return { ...clip, endSeconds: Math.max(clip.startSeconds + minimum, Math.min(snapped, sourceDuration)) }
}

export function updateClipRange(clips: Clip[], id: string, start: number, end: number, sourceDuration: number): Clip[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > sourceDuration + 1e-6 || end - start < MIN_CLIP_SECONDS - 1e-8) return clips
  const clip = clips.find(item => item.id === id)
  if (!clip || (Math.abs(clip.startSeconds - start) < 1e-8 && Math.abs(clip.endSeconds - end) < 1e-8)) return clips
  const timelineStart = Math.max(0, clip.timelineStart + (start - clip.startSeconds))
  return clips.map(item => item.id === id ? { ...item, startSeconds: start, endSeconds: end, timelineStart } : item)
}

// Split the given clips (or everything under the playhead) at a timeline time.
export function splitAt(clips: Clip[], time: number, ids: string[] | null, newId: () => string): Clip[] {
  const targets = clipsAt(clips, time).filter(clip => !ids || ids.includes(clip.id))
  const splittable = targets.filter(clip => time - clip.timelineStart >= MIN_CLIP_SECONDS && clipEnd(clip) - time >= MIN_CLIP_SECONDS)
  if (!splittable.length) return clips
  const result: Clip[] = []
  for (const clip of clips) {
    if (!splittable.includes(clip)) { result.push(clip); continue }
    const cut = clip.startSeconds + (time - clip.timelineStart)
    result.push({ ...clip, endSeconds: cut })
    result.push({ ...clip, id: newId(), startSeconds: cut, timelineStart: time })
  }
  return result
}

// Move a group in time and across tracks of the same kind, keeping relative offsets.
export function moveClips(clips: Clip[], ids: string[], dt: number, dTrack = 0): Clip[] {
  const moving = clips.filter(clip => ids.includes(clip.id))
  if (!moving.length || (!dt && !dTrack)) return clips
  const earliest = Math.min(...moving.map(clip => clip.timelineStart))
  const shift = Math.max(-earliest, dt)
  const lowest = Math.min(...moving.map(clip => clip.track))
  const trackShift = Math.max(-lowest, Math.round(dTrack))
  if (!shift && !trackShift) return clips
  return clips.map(clip => ids.includes(clip.id) ? { ...clip, timelineStart: Math.max(0, clip.timelineStart + shift), track: clip.track + trackShift } : clip)
}

// Snap a candidate time to the nearest target within tolerance; returns the time and what it snapped to.
export function snapTime(time: number, targets: number[], tolerance: number): { time: number; snapped: number | null } {
  let best: number | null = null
  let distance = tolerance
  for (const target of targets) {
    const gap = Math.abs(target - time)
    if (gap <= distance) { distance = gap; best = target }
  }
  return best === null ? { time, snapped: null } : { time: best, snapped: best }
}

export function snapTargets(clips: Clip[], excludeIds: string[], playhead: number): number[] {
  const targets = [0, playhead]
  for (const clip of clips) if (!excludeIds.includes(clip.id)) targets.push(clip.timelineStart, clipEnd(clip))
  return targets
}

export function selectClips(clips: Clip[], selected: string[], id: string, mode: 'replace' | 'toggle' | 'range' | 'preserve' | 'add', anchor: string | null): string[] {
  if (mode === 'preserve' && selected.includes(id)) return selected
  if (mode === 'add') return selected.includes(id) ? selected : [...selected, id]
  if (mode === 'toggle') return selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
  if (mode === 'range' && anchor) {
    const a = clips.find(clip => clip.id === anchor)
    const b = clips.find(clip => clip.id === id)
    if (a && b && a.kind === b.kind && a.track === b.track) {
      const low = Math.min(a.timelineStart, b.timelineStart)
      const high = Math.max(a.timelineStart, b.timelineStart)
      return clips.filter(clip => clip.kind === a.kind && clip.track === a.track && clip.timelineStart >= low && clip.timelineStart <= high).map(clip => clip.id)
    }
  }
  return [id]
}

export interface Placement { kind: Clip['kind']; track: number; time: number }

export function clipFromAsset(asset: MediaAsset, track: number, time: number, id: string, frame = FULL_FRAME): Clip {
  return { id, mediaId: asset.id, kind: asset.kind, track, timelineStart: Math.max(0, time), startSeconds: 0, endSeconds: asset.metadata.durationSeconds, ...frame, volume: 1, muted: false }
}

// Lay assets back to back from the drop time. Video goes to the video track, audio to the
// audio track; an asset dropped on the wrong kind of track lands on track 0 of its own kind.
export function insertAssets(clips: Clip[], assets: MediaAsset[], placement: Placement, newId: () => string): { clips: Clip[]; ids: string[] } {
  const ids: string[] = []
  const added: Clip[] = []
  const cursors: Record<Clip['kind'], number> = { video: placement.time, audio: placement.time }
  for (const asset of assets) {
    const track = asset.kind === placement.kind ? placement.track : 0
    const frame = asset.kind === 'video' && placement.kind === 'video' && placement.track > 0 && clips.some(clip => clip.kind === 'video' && clip.track < placement.track) ? PIP_FRAME : FULL_FRAME
    const clip = clipFromAsset(asset, track, cursors[asset.kind], newId(), frame)
    cursors[asset.kind] += clipLength(clip)
    added.push(clip)
    ids.push(clip.id)
  }
  return { clips: added.length ? [...clips, ...added] : clips, ids }
}

export function removeMedia(clips: Clip[], mediaIds: string[]): Clip[] {
  const next = clips.filter(clip => !mediaIds.includes(clip.mediaId))
  return next.length === clips.length ? clips : next
}

// Hidden video tracks and muted audio tracks are stored as sorted number lists.
export function toggleTrack(list: number[], track: number): number[] {
  return list.includes(track) ? list.filter(item => item !== track) : [...list, track].sort((a, b) => a - b)
}
