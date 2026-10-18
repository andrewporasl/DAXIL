import React, { useEffect, useRef } from 'react'
import type { Clip, MediaAsset } from '@shared/types'
import { clipLength } from '../lib/edit'
import { assetName } from '../lib/media'
import { clipSpeed } from '@shared/exportPlan'
import { setPreviewGain } from '../lib/audioGain'

export const VIDEO_ROW = 44
export const AUDIO_ROW = 26
export const TEXT_ROW = 26
export const ROW_GAP = 2
export const rowHeight = (kind: Clip['kind']): number => kind === 'video' ? VIDEO_ROW : kind === 'text' ? TEXT_ROW : AUDIO_ROW

export type ClipPointerHandler = (event: React.PointerEvent<HTMLElement>, clip: Clip, edge: 'start' | 'end' | null) => void

interface Props {
  kind: Clip['kind']
  tracks: number[]                      // row order, top to bottom
  clips: Clip[]                         // already includes any drag draft
  media: MediaAsset[]
  span: number
  selectedIds: string[]
  disabledTracks: number[]              // hidden video tracks / muted audio tracks
  draggingIds: string[]
  dropHint: { kind: Clip['kind']; track: number; time: number; length: number } | null
  time: number
  playing: boolean
  rate: number
  muteAll: boolean
  onClipPointerDown: ClipPointerHandler
  onClipContextMenu: (clip: Clip, x: number, y: number) => void
  onClipDoubleClick?: (clip: Clip) => void
}

// Hidden audio element that keeps an audio clip in step with the timeline clock.
function AudioLayer({ clip, asset, time, playing, rate, muted }: { clip: Clip; asset?: MediaAsset; time: number; playing: boolean; rate: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    const position = time - clip.timelineStart
    setPreviewGain(audio, clip.volume)
    audio.muted = muted || clip.muted
    audio.playbackRate = Math.max(0.0625, Math.min(16, rate * clipSpeed(clip)))
    if (position < 0 || position >= clipLength(clip) || !playing) audio.pause()
    else {
      const target = clip.startSeconds + position * clipSpeed(clip)
      if (Math.abs(audio.currentTime - target) > 0.15) audio.currentTime = target
      if (audio.paused) void audio.play().catch(() => {})
    }
  }, [clip, time, playing, rate, muted])
  return <audio ref={ref} crossOrigin="anonymous" src={asset ? `safe-file://video?path=${encodeURIComponent(asset.metadata.filePath)}` : undefined} preload="auto" />
}

// Rows of free-positioned clips for one kind of track. Pointer logic lives in the Editor,
// which owns snapping, cross-track moves and the viewport.
export default function Tracks({ kind, tracks, clips, media, span, selectedIds, disabledTracks, draggingIds, dropHint, time, playing, rate, muteAll, onClipPointerDown, onClipContextMenu, onClipDoubleClick }: Props) {
  const height = rowHeight(kind)
  return <div className={`tracks tracks-${kind}`}>
    {tracks.map(track => {
      const disabled = disabledTracks.includes(track)
      const hint = dropHint && dropHint.kind === kind && dropHint.track === track ? dropHint : null
      return <div key={track} className={`track track-${kind}${disabled ? ' is-disabled' : ''}${hint ? ' is-drop-target' : ''}`} data-kind={kind} data-track={track} style={{ height }}>
        {clips.filter(clip => clip.track === track).sort((a, b) => a.timelineStart - b.timelineStart).map(clip => {
          const asset = media.find(item => item.id === clip.mediaId)
          const name = kind === 'text' ? (clip.text?.content.replace(/\s+/g, ' ').trim() || 'Text') : assetName(asset, kind)
          const selected = selectedIds.includes(clip.id)
          return <div key={clip.id} data-id={clip.id} data-in={clip.startSeconds} data-out={clip.endSeconds} data-start={clip.timelineStart} data-track={clip.track}
            className={`clip clip-${kind}${selected ? ' is-selected' : ''}${clip.muted ? ' is-muted' : ''}${draggingIds.includes(clip.id) ? ' is-dragging' : ''}`}
            style={{ left: `${clip.timelineStart / span * 100}%`, width: `${clipLength(clip) / span * 100}%` }}
            onPointerDown={event => onClipPointerDown(event, clip, (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined ?? null)}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onClipContextMenu(clip, event.clientX, event.clientY) }}
            onDoubleClick={() => onClipDoubleClick?.(clip)}
            title={kind === 'text' ? `${name} · ${clipLength(clip).toFixed(2)}s · drag to move, edges to change length, double-click to edit` : `${name} · ${clip.startSeconds.toFixed(2)}–${clip.endSeconds.toFixed(2)}s · drag to move, edges to trim, right-click for actions`}>
            {kind === 'video' && asset?.thumbnail && <div className="clip-thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />}
            {kind === 'audio' && <AudioLayer clip={clip} asset={asset} time={time} playing={playing} rate={rate} muted={muteAll || disabled} />}
            <span className="clip-trim start" data-edge="start" />
            <span className="clip-name">{clip.muted && kind === 'audio' ? '∅ ' : ''}{kind === 'text' ? <><b className="clip-text-glyph">T</b>{name}</> : assetName(asset)}</span>
            {clipSpeed(clip) !== 1 && <span className="clip-speed" title={`Plays at ${clipSpeed(clip)}× speed`}>{clipSpeed(clip)}×</span>}
            <span className="clip-trim end" data-edge="end" />
          </div>
        })}
        {hint && <div className="clip-ghost" style={{ left: `${hint.time / span * 100}%`, width: `${Math.max(0.05, hint.length) / span * 100}%` }} />}
      </div>
    })}
  </div>
}
