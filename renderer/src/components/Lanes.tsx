import { useEffect, useRef, useState } from 'react'
import type { AudioClip, MediaAsset, OverlayClip } from '@shared/types'
import { trimClipEdge } from '../lib/clips'
import { MEDIA_MIME, parseMediaIds } from '../lib/timeline'

// A clip that sits at a free position on a lane rather than in the V1 sequence.
export type LaneClip = AudioClip | OverlayClip
export type LaneSelectMode = 'replace' | 'toggle' | 'add' | 'preserve'

export const LANE_HEIGHT = 26
export const LANE_GAP = 2

function AudioPreview({ clip, asset, time, playing, rate, muted }: { clip: AudioClip; asset?: MediaAsset; time: number; playing: boolean; rate: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    const position = time - clip.timelineStart
    audio.volume = Math.min(1, clip.volume)
    audio.muted = muted
    audio.playbackRate = rate
    if (position < 0 || position >= clip.endSeconds - clip.startSeconds || !playing) audio.pause()
    else {
      const target = clip.startSeconds + position
      if (Math.abs(audio.currentTime - target) > 0.15) audio.currentTime = target
      if (audio.paused) void audio.play().catch(() => {})
    }
  }, [clip, time, playing, rate, muted])
  return <audio ref={ref} src={asset ? `safe-file://video?path=${encodeURIComponent(asset.metadata.filePath)}` : undefined} preload="auto" />
}

interface Props<T extends LaneClip> {
  kind: 'video' | 'audio'
  // Each entry is one lane; video lanes are tracks, audio lanes hold one clip each.
  lanes: Array<{ key: string; track?: number; clips: T[]; hidden?: boolean }>
  media: MediaAsset[]
  span: number
  duration: number
  time: number
  playing: boolean
  rate: number
  muted: boolean
  selectedIds: string[]
  dropHint: boolean
  onSelect: (id: string, mode: LaneSelectMode) => void
  onChange: (clips: T[]) => void
  onDropMedia: (ids: string[], time: number, track?: number) => void
  onContextMenu: (clip: T, x: number, y: number) => void
}

export default function Lanes<T extends LaneClip>({ kind, lanes, media, span, duration, time, playing, rate, muted, selectedIds, dropHint, onSelect, onChange, onDropMedia, onContextMenu }: Props<T>) {
  const root = useRef<HTMLDivElement>(null)
  const clips = lanes.flatMap(lane => lane.clips)
  const [draft, setDraft] = useState<Record<string, T> | null>(null)
  // Moving a selected clip carries the rest of the lane selection with it; trimming affects one clip.
  const gesture = useRef<{ clip: T; group: T[]; x: number; width: number; edge: 'start' | 'end' | 'move'; next: Record<string, T> } | null>(null)
  useEffect(() => {
    if (!draft) return
    const move = (event: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      const delta = (event.clientX - g.x) / g.width * span
      const next: Record<string, T> = {}
      if (g.edge === 'move') {
        const earliest = Math.min(...g.group.map(clip => clip.timelineStart))
        const shift = Math.max(-earliest, Math.round(delta * 30) / 30)
        for (const clip of g.group) next[clip.id] = { ...clip, timelineStart: Math.max(0, Math.min(Math.max(0, duration - 0.1), clip.timelineStart + shift)) }
      } else {
        const sourceDuration = media.find(item => item.id === g.clip.mediaId)?.metadata.durationSeconds ?? g.clip.endSeconds
        next[g.clip.id] = { ...g.clip, ...trimClipEdge(g.clip, g.edge, (g.edge === 'start' ? g.clip.startSeconds : g.clip.endSeconds) + delta, sourceDuration, 30) }
      }
      g.next = next
      setDraft(next)
    }
    const end = () => {
      const g = gesture.current
      gesture.current = null
      setDraft(null)
      if (!g) return
      const changed = Object.values(g.next).some(clip => {
        const before = clips.find(item => item.id === clip.id)
        return before && (before.timelineStart !== clip.timelineStart || before.startSeconds !== clip.startSeconds || before.endSeconds !== clip.endSeconds)
      })
      if (changed) onChange(clips.map(clip => g.next[clip.id] ?? clip))
    }
    const cancel = () => { gesture.current = null; setDraft(null) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', cancel); document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key, true) }
  }, [Boolean(draft), clips, duration, media, onChange, span])

  const dropTime = (clientX: number) => {
    const rect = root.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * span))
  }

  return <div ref={root} className={`lanes lanes-${kind}`} data-kind={kind}>
    {lanes.map(lane => <div className={`lane lane-${kind}${lane.hidden ? ' is-hidden' : ''}${dropHint && !lane.clips.length ? ' is-drop-hint' : ''}`} key={lane.key} data-track={lane.track}
      onDragOver={event => { if (event.dataTransfer.types.includes(MEDIA_MIME)) { event.preventDefault(); event.stopPropagation() } }}
      onDrop={event => {
        const ids = parseMediaIds(event.dataTransfer.getData(MEDIA_MIME))
        if (!ids.length || !root.current) return
        event.preventDefault(); event.stopPropagation()
        onDropMedia(ids, dropTime(event.clientX), lane.track)
      }}>
      {dropHint && !lane.clips.length && <span className="lane-drop-label">{kind === 'video' ? `Drop video to stack on V${(lane.track ?? 0) + 1}` : 'Drop audio here'}</span>}
      {lane.clips.map(original => {
        const clip = draft?.[original.id] ?? original
        const asset = media.find(item => item.id === clip.mediaId)
        const selected = selectedIds.includes(clip.id)
        const muted = 'volume' in clip && !clip.volume
        return <div key={clip.id} data-id={clip.id}
          className={`lane-clip ${kind}-clip${selected ? ' is-selected' : ''}${muted ? ' is-muted' : ''}`}
          style={{ left: `${clip.timelineStart / span * 100}%`, width: `${(clip.endSeconds - clip.startSeconds) / span * 100}%` }}
          onPointerDown={event => {
            if (event.button !== 0 || !root.current) return
            event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
            const additive = event.ctrlKey || event.metaKey
            onSelect(clip.id, additive ? 'toggle' : event.shiftKey ? 'add' : selected ? 'preserve' : 'replace')
            if (additive) return
            const edge = (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined
            const group = !edge && selected ? clips.filter(item => selectedIds.includes(item.id)) : [clip]
            gesture.current = { clip, group, next: {}, x: event.clientX, width: root.current.getBoundingClientRect().width, edge: edge ?? 'move' }
            setDraft({})
          }}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!selected) onSelect(clip.id, 'replace'); onContextMenu(clip, event.clientX, event.clientY) }}
          title={`${asset?.metadata.fileName ?? (kind === 'video' ? 'Video' : 'Audio')} · drag to move, drag edges to trim, right-click for actions`}>
          {kind === 'video' && asset?.thumbnail && <div className="lane-clip-thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />}
          <span className="lane-trim start" data-edge="start" />
          <span className="lane-name">{asset?.metadata.fileName}</span>
          {kind === 'audio' && <>
            <AudioPreview clip={clip as AudioClip} asset={asset} time={time} playing={playing} rate={rate} muted={muted || false} />
            <button onPointerDown={event => event.stopPropagation()} onClick={() => onChange(clips.map(item => item.id === clip.id ? { ...item, volume: (item as AudioClip).volume ? 0 : 1 } : item))} title={muted ? 'Unmute audio track' : 'Mute audio track'} aria-label="Mute audio track">{muted ? '∅' : '♫'}</button>
          </>}
          <button onPointerDown={event => event.stopPropagation()} onClick={() => onChange(clips.filter(item => item.id !== clip.id))} title={`Remove ${kind} clip`} aria-label={`Remove ${kind} track`}>×</button>
          <span className="lane-trim end" data-edge="end" />
        </div>
      })}
    </div>)}
  </div>
}
