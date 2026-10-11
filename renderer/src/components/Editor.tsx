import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import type { Clip, CropSelection, MediaAsset, Project } from '@shared/types'
import { formatDuration } from '../lib/sizeEstimator'
import Icon from './Icon'
import Tracks, { rowHeight, ROW_GAP } from './Tracks'
import { clipEnd, clipLength, clipsAt, FULL_FRAME, PIP_FRAME, primaryClipAt, snapTargets, snapTime, sourceTimeAt, timelineEnd, trackCount, trimEdge, type Placement } from '../lib/edit'
import { assetName } from '../lib/media'
import { anchoredScrollLeft, clampZoom, formatRulerTime, maxZoom, MEDIA_MIME, parseMediaIds, rectsIntersect, rulerStep, wheelZoomFactor } from '../lib/timeline'

export type SelectMode = 'replace' | 'toggle' | 'range' | 'preserve' | 'add'

interface Props {
  project: Project | null
  media: MediaAsset[]
  clips: Clip[]
  selectedIds: string[]
  hiddenVideoTracks: number[]
  mutedAudioTracks: number[]
  muteAudio: boolean
  crop: CropSelection
  currentTime: number
  playbackRate: number
  canUndo: boolean
  canRedo: boolean
  onClipsChange: (clips: Clip[]) => void
  onSelect: (id: string, mode?: SelectMode) => void
  onMarqueeSelect: (ids: string[], additive: boolean) => void
  onClearSelection: () => void
  onTimeUpdate: (time: number) => void
  onSplit: () => void
  onRemoveSelected: () => void
  onDuplicate: () => void
  onUndo: () => void
  onRedo: () => void
  onInsertMedia: (ids: string[], placement: Placement) => void
  onDropFiles: (paths: string[], placement: Placement) => void
  onToggleVideoTrack: (track: number) => void
  onToggleAudioTrack: (track: number) => void
  onCropChange: (crop: CropSelection) => void
  onPlaybackRateChange: (rate: number) => void
  onImport: () => void
  mediaPanel: React.ReactNode
  inspector: React.ReactNode
  timelineHeight: number
  onTimelineHeightChange: (height: number) => void
}

interface DisplayBounds { left: number; top: number; width: number; height: number }
interface CropDragState { target: 'move' | 'resize'; startClientX: number; startClientY: number; crop: CropSelection }
interface Marquee { pointerId: number; x: number; y: number; currentX: number; currentY: number; additive: boolean; active: boolean }
interface ClipGesture {
  pointerId: number
  clip: Clip
  edge: 'start' | 'end' | null
  ids: string[]
  startX: number
  startY: number
  pixelsPerSecond: number
  scrollLeft: number
  moved: boolean
  draft: Record<string, Clip>
  snapped: number | null
}

const SNAP_PIXELS = 8
const END_PAD = 48
const ZOOM_STEP = 1.25
const RULER_HEIGHT = 18
const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2]

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

// One video clip in the preview, kept in step with the timeline clock. Video clips carry
// their own sound unless muted. Elements mount a second early so the next cut has buffered.
function VideoLayer({ clip, asset, bounds, frameAspect, time, playing, rate, muted, selected, onPointerDown, onResizeDown }: {
  clip: Clip; asset?: MediaAsset; bounds: DisplayBounds; frameAspect: number; time: number; playing: boolean; rate: number; muted: boolean; selected: boolean
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void; onResizeDown: (event: React.PointerEvent<HTMLElement>) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const active = time >= clip.timelineStart - 1e-6 && time < clipEnd(clip) - 1e-6
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const target = clip.startSeconds + clamp(time - clip.timelineStart, 0, clipLength(clip))
    video.playbackRate = rate
    video.volume = Math.min(1, clip.volume)
    video.muted = muted || clip.muted
    if (!playing || !active) { video.pause(); if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target; return }
    if (Math.abs(video.currentTime - target) > 0.2) video.currentTime = target
    if (video.paused) void video.play().catch(() => {})
  }, [clip, time, playing, rate, muted, active])
  const aspect = asset && asset.metadata.width > 0 ? asset.metadata.height / asset.metadata.width : frameAspect
  const full = clip.scale >= 0.999 && Math.abs(clip.x) < 0.001 && Math.abs(clip.y) < 0.001
  // Full-frame clips letterbox inside the project frame like the export does.
  const style: React.CSSProperties = full
    ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, opacity: clip.opacity, visibility: active ? 'visible' : 'hidden' }
    : { left: bounds.left + clip.x * bounds.width, top: bounds.top + clip.y * bounds.height, width: clip.scale * bounds.width, height: clip.scale * bounds.width * aspect, opacity: clip.opacity, visibility: active ? 'visible' : 'hidden' }
  return <div className={`layer${selected ? ' is-selected' : ''}${full ? ' is-full' : ''}`} data-id={clip.id} style={style} onPointerDown={onPointerDown}
    title={`${assetName(asset, 'Video')} · V${clip.track + 1} · drag to move, corner to resize`}>
    <video ref={ref} playsInline preload="auto" className={full ? 'layer-video is-contain' : 'layer-video'} src={asset ? `safe-file://video?path=${encodeURIComponent(asset.metadata.filePath)}` : undefined} />
    {selected && <div className="layer-resize-handle" onPointerDown={onResizeDown} />}
  </div>
}

export default function Editor({
  project, media, clips, selectedIds, hiddenVideoTracks, mutedAudioTracks, muteAudio, crop, currentTime, playbackRate, canUndo, canRedo,
  onClipsChange, onSelect, onMarqueeSelect, onClearSelection, onTimeUpdate, onSplit, onRemoveSelected, onDuplicate, onUndo, onRedo,
  onInsertMedia, onDropFiles, onToggleVideoTrack, onToggleAudioTrack, onCropChange, onPlaybackRateChange, onImport,
  mediaPanel, inspector, timelineHeight, onTimelineHeightChange
}: Props) {
  const previewRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<{ x: number; y: number; up: boolean; clip: Clip | null } | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const pendingAnchor = useRef<{ time: number; clientX: number } | null>(null)
  const [view, setView] = useState({ scrollLeft: 0, width: 0, stripWidth: 0 })
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const scrubbing = useRef<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const timeRef = useRef(currentTime)
  timeRef.current = currentTime
  const [displayBounds, setDisplayBounds] = useState<DisplayBounds | null>(null)
  const displayBoundsRef = useRef<DisplayBounds | null>(null)
  const cropDragRef = useRef<CropDragState | null>(null)
  const [cropDragging, setCropDragging] = useState<'move' | 'resize' | null>(null)
  const [layerDraft, setLayerDraft] = useState<Clip | null>(null)
  const layerDragRef = useRef<{ clip: Clip; mode: 'move' | 'resize'; startX: number; startY: number; next: Clip } | null>(null)
  const gestureRef = useRef<ClipGesture | null>(null)
  const [gestureDraft, setGestureDraft] = useState<{ clips: Record<string, Clip>; snapped: number | null; trimming: Clip | null } | null>(null)
  const [dropHint, setDropHint] = useState<{ kind: Clip['kind']; track: number; time: number; length: number } | null>(null)
  const dragPointer = useRef<{ x: number; y: number } | null>(null)

  const frameWidth = project?.width || 1280
  const frameHeight = project?.height || 720
  const frameAspect = frameHeight / frameWidth
  const fps = project?.fps || 30
  const duration = timelineEnd(clips)
  const axisSpan = Math.max(duration, 1)
  const displayClips = gestureDraft ? clips.map(clip => gestureDraft.clips[clip.id] ?? clip) : layerDraft ? clips.map(clip => clip.id === layerDraft.id ? layerDraft : clip) : clips
  const renderSpan = Math.max(axisSpan, timelineEnd(displayClips))
  // Rows are laid out from the committed clips so a drag can't grow the track list under the pointer.
  const videoTracks = Array.from({ length: trackCount(clips, 'video') }, (_, i) => i).reverse()
  const audioTracks = Array.from({ length: trackCount(clips, 'audio') }, (_, i) => i)
  const selectedClips = clips.filter(clip => selectedIds.includes(clip.id))
  const hasProject = Boolean(project)
  const assetFor = (clip: Clip) => media.find(asset => asset.id === clip.mediaId)
  const sourceLength = (clip: Clip) => assetFor(clip)?.metadata.durationSeconds ?? clip.endSeconds

  // ---------- playback clock ----------
  const setTime = useCallback((time: number) => onTimeUpdate(clamp(time, 0, Math.max(0, timelineEnd(clips)))), [clips, onTimeUpdate])
  useEffect(() => {
    if (!isPlaying) return
    const end = timelineEnd(clips)
    const origin = timeRef.current >= end - 1e-3 ? 0 : timeRef.current
    const startedAt = performance.now()
    let frame = 0
    const tick = () => {
      const next = origin + (performance.now() - startedAt) / 1000 * playbackRate
      if (next >= end) { onTimeUpdate(end); setIsPlaying(false); return }
      onTimeUpdate(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, playbackRate, clips, onTimeUpdate])
  const togglePlayback = useCallback(() => { if (duration > 0) setIsPlaying(playing => !playing) }, [duration])
  useEffect(() => { if (duration <= 0) setIsPlaying(false) }, [duration])
  const seekBy = (delta: number) => setTime(currentTime + delta)

  // ---------- zoom ----------
  const changeZoom = (next: number, anchorClientX?: number) => {
    const viewport = viewportRef.current
    const strip = contentRef.current
    if (!viewport || !strip) return
    const normalized = clampZoom(next, axisSpan)
    if (Math.abs(normalized - zoomRef.current) < 1e-6) return
    const stripRect = strip.getBoundingClientRect()
    const viewRect = viewport.getBoundingClientRect()
    let clientX = anchorClientX
    if (clientX === undefined) {
      const playX = stripRect.left + currentTime / renderSpan * stripRect.width
      clientX = playX >= viewRect.left && playX <= viewRect.right ? playX : viewRect.left + viewRect.width / 2
    }
    if (!pendingAnchor.current) pendingAnchor.current = { time: clamp((clientX - stripRect.left) / stripRect.width * renderSpan, 0, renderSpan), clientX }
    zoomRef.current = normalized
    setZoom(normalized)
  }
  const changeZoomRef = useRef(changeZoom)
  changeZoomRef.current = changeZoom
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    const viewport = viewportRef.current
    const strip = contentRef.current
    pendingAnchor.current = null
    if (!anchor || !viewport || !strip) return
    const rect = strip.getBoundingClientRect()
    viewport.scrollLeft = anchoredScrollLeft(viewport.scrollLeft, rect.left, rect.width, renderSpan, anchor.time, anchor.clientX)
  }, [zoom])
  useEffect(() => {
    const viewport = viewportRef.current
    const strip = contentRef.current
    if (!viewport || !strip) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setView({ scrollLeft: viewport.scrollLeft, width: viewport.clientWidth, stripWidth: strip.getBoundingClientRect().width }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport); observer.observe(strip)
    viewport.addEventListener('scroll', measure, { passive: true })
    return () => { cancelAnimationFrame(frame); observer.disconnect(); viewport.removeEventListener('scroll', measure) }
  }, [])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      if (gestureRef.current) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        changeZoomRef.current(zoomRef.current * wheelZoomFactor(event.deltaY, event.deltaMode), event.clientX)
      } else if (!event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY) && viewport.scrollHeight > viewport.clientHeight) {
        return // vertical wheel scrolls the tracks natively
      } else if (viewport.scrollWidth > viewport.clientWidth) {
        event.preventDefault()
        const unit = event.deltaMode === 1 ? 16 : 1
        viewport.scrollLeft += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit
      }
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => {
    const viewport = viewportRef.current
    const headers = headersRef.current
    if (!viewport || !headers) return
    const sync = () => { headers.style.transform = `translateY(${-viewport.scrollTop}px)` }
    sync()
    viewport.addEventListener('scroll', sync, { passive: true })
    return () => viewport.removeEventListener('scroll', sync)
  }, [])
  // Page the view forward during playback so the playhead never runs off screen.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!isPlaying || scrubbing.current !== null || !viewport || view.stripWidth <= 0) return
    const x = currentTime / renderSpan * view.stripWidth
    if (x > viewport.scrollLeft + viewport.clientWidth - 24 || x < viewport.scrollLeft) viewport.scrollLeft = x - viewport.clientWidth * 0.1
  }, [currentTime, isPlaying, renderSpan, view.stripWidth])

  const pixelsPerSecond = view.stripWidth > 0 ? view.stripWidth / renderSpan : 0
  const timeAtClientX = (clientX: number) => {
    const strip = contentRef.current
    if (!strip) return 0
    const rect = strip.getBoundingClientRect()
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width * renderSpan, 0, renderSpan) : 0
  }

  // ---------- preview frame bounds, crop drag ----------
  useEffect(() => {
    const preview = previewRef.current
    if (!preview || !project) { displayBoundsRef.current = null; setDisplayBounds(null); return }
    const update = () => {
      const rect = preview.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      let width = rect.width, height = rect.height, left = 0, top = 0
      if (rect.width / rect.height > frameWidth / frameHeight) { width = height * frameWidth / frameHeight; left = (rect.width - width) / 2 }
      else { height = width * frameHeight / frameWidth; top = (rect.height - height) / 2 }
      const next = { left, top, width, height }
      displayBoundsRef.current = next
      setDisplayBounds(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(preview)
    return () => observer.disconnect()
  }, [project, frameWidth, frameHeight])
  const startCropDrag = (event: React.MouseEvent<HTMLDivElement>, target: 'move' | 'resize') => {
    event.preventDefault(); event.stopPropagation()
    cropDragRef.current = { target, startClientX: event.clientX, startClientY: event.clientY, crop }
    setCropDragging(target)
  }
  useEffect(() => {
    if (!cropDragging) return
    const onMove = (event: MouseEvent) => {
      const drag = cropDragRef.current
      const bounds = displayBoundsRef.current
      if (!drag || !bounds || bounds.width <= 0) return
      const dx = (event.clientX - drag.startClientX) * frameWidth / bounds.width
      const dy = (event.clientY - drag.startClientY) * frameHeight / bounds.height
      if (drag.target === 'move') {
        const x = clamp(Math.round(drag.crop.x + dx), 0, frameWidth - drag.crop.width)
        const y = clamp(Math.round(drag.crop.y + dy), 0, frameHeight - drag.crop.height)
        onCropChange({ ...drag.crop, enabled: true, x, y })
      } else {
        const width = clamp(Math.round(drag.crop.width + dx), 32, frameWidth - drag.crop.x)
        const height = clamp(Math.round(drag.crop.height + dy), 32, frameHeight - drag.crop.y)
        onCropChange({ ...drag.crop, enabled: true, width, height })
      }
    }
    const onUp = () => { cropDragRef.current = null; setCropDragging(null) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [cropDragging, frameWidth, frameHeight, onCropChange])

  // ---------- video layer drag/resize in the preview ----------
  const startLayerDrag = (event: React.PointerEvent<HTMLElement>, clip: Clip, mode: 'move' | 'resize') => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    if (!selectedIds.includes(clip.id)) onSelect(clip.id, 'replace')
    layerDragRef.current = { clip, mode, startX: event.clientX, startY: event.clientY, next: clip }
    setLayerDraft(clip)
  }
  useEffect(() => {
    if (!layerDraft) return
    const move = (event: PointerEvent) => {
      const drag = layerDragRef.current
      const bounds = displayBoundsRef.current
      if (!drag || !bounds || bounds.width <= 0) return
      const dx = (event.clientX - drag.startX) / bounds.width
      const dy = (event.clientY - drag.startY) / bounds.height
      const asset = assetFor(drag.clip)?.metadata
      const aspect = asset && asset.width > 0 ? asset.height / asset.width : frameAspect
      let next: Clip
      if (drag.mode === 'move') {
        const h = drag.clip.scale * aspect / frameAspect
        next = { ...drag.clip, x: clamp(drag.clip.x + dx, -drag.clip.scale * 0.9, 1 - drag.clip.scale * 0.1), y: clamp(drag.clip.y + dy, -h * 0.9, 1 - h * 0.1) }
      } else next = { ...drag.clip, scale: clamp(drag.clip.scale + dx, 0.05, 1) }
      drag.next = next
      setLayerDraft(next)
    }
    const end = () => {
      const drag = layerDragRef.current
      layerDragRef.current = null
      setLayerDraft(null)
      if (!drag) return
      const { next, clip } = drag
      if (next.x !== clip.x || next.y !== clip.y || next.scale !== clip.scale) onClipsChange(clips.map(item => item.id === clip.id ? next : item))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end) }
  }, [Boolean(layerDraft), clips, media, frameAspect, onClipsChange])

  // ---------- timeline clip drag: move across time and tracks, or trim an edge ----------
  const rowAt = (clientX: number, clientY: number): { kind: Clip['kind']; track: number } | null => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.track')
    if (!element?.dataset.kind) return null
    return { kind: element.dataset.kind as Clip['kind'], track: Number(element.dataset.track) }
  }
  const onClipPointerDown = (event: React.PointerEvent<HTMLElement>, clip: Clip, edge: 'start' | 'end' | null) => {
    if (event.button !== 0 || !contentRef.current) return
    event.preventDefault(); event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey
    const selected = selectedIds.includes(clip.id)
    if (edge) { if (!selected) onSelect(clip.id, 'replace') }
    else onSelect(clip.id, additive ? 'toggle' : event.shiftKey ? 'range' : selected ? 'preserve' : 'replace')
    if (additive || event.shiftKey) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPlaying(false)
    const ids = edge ? [clip.id] : selected ? selectedIds : [clip.id]
    gestureRef.current = { pointerId: event.pointerId, clip, edge, ids, startX: event.clientX, startY: event.clientY, pixelsPerSecond: contentRef.current.getBoundingClientRect().width / renderSpan, scrollLeft: viewportRef.current?.scrollLeft ?? 0, moved: false, draft: {}, snapped: null }
    dragPointer.current = { x: event.clientX, y: event.clientY }
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const g = gestureRef.current
      if (!g || event.pointerId !== g.pointerId) return
      dragPointer.current = { x: event.clientX, y: event.clientY }
      updateGesture(event.clientX, event.clientY, event.altKey)
    }
    const up = (event: PointerEvent) => { if (gestureRef.current && event.pointerId === gestureRef.current.pointerId) finishGesture(false) }
    const cancel = () => finishGesture(true)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gestureRef.current) { event.stopPropagation(); finishGesture(true) } }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel) }
  })
  const updateGesture = (clientX: number, clientY: number, noSnap: boolean) => {
    const g = gestureRef.current
    const viewport = viewportRef.current
    if (!g || !viewport) return
    const scrolled = viewport.scrollLeft - g.scrollLeft
    const dx = clientX - g.startX + scrolled
    if (!g.moved && Math.hypot(dx, clientY - g.startY) < 3) return
    g.moved = true
    const dt = dx / g.pixelsPerSecond
    const draft: Record<string, Clip> = {}
    let snapped: number | null = null
    const tolerance = SNAP_PIXELS / g.pixelsPerSecond
    if (g.edge) {
      const asset = assetFor(g.clip)
      const original = g.edge === 'start' ? g.clip.startSeconds : g.clip.endSeconds
      let sourceTime = original + dt
      if (!noSnap) {
        const edgeTime = g.edge === 'start' ? g.clip.timelineStart + dt : clipEnd(g.clip) + dt
        const snap = snapTime(edgeTime, snapTargets(clips, [g.clip.id], currentTime), tolerance)
        if (snap.snapped !== null) { sourceTime = original + (snap.time - (g.edge === 'start' ? g.clip.timelineStart : clipEnd(g.clip))); snapped = snap.snapped }
      }
      draft[g.clip.id] = trimEdge(g.clip, g.edge, sourceTime, asset?.metadata.durationSeconds ?? g.clip.endSeconds, asset?.metadata.fps || fps)
    } else {
      const moving = clips.filter(clip => g.ids.includes(clip.id))
      const earliest = Math.min(...moving.map(clip => clip.timelineStart))
      let shift = Math.max(-earliest, dt)
      if (!noSnap) {
        const targets = snapTargets(clips, g.ids, currentTime)
        const start = snapTime(g.clip.timelineStart + shift, targets, tolerance)
        const end = snapTime(clipEnd(g.clip) + shift, targets, tolerance)
        if (start.snapped !== null) { shift = start.time - g.clip.timelineStart; snapped = start.snapped }
        else if (end.snapped !== null) { shift = end.time - clipEnd(g.clip); snapped = end.snapped }
        shift = Math.max(-earliest, shift)
      }
      const row = rowAt(clientX, clientY)
      const lowest = Math.min(...moving.filter(clip => clip.kind === g.clip.kind).map(clip => clip.track))
      const trackShift = row && row.kind === g.clip.kind ? Math.max(-lowest, row.track - g.clip.track) : 0
      for (const clip of moving) draft[clip.id] = { ...clip, timelineStart: Math.max(0, clip.timelineStart + shift), track: clip.kind === g.clip.kind ? clip.track + trackShift : clip.track }
    }
    g.draft = draft
    g.snapped = snapped
    setGestureDraft({ clips: draft, snapped, trimming: g.edge ? draft[g.clip.id] : null })
  }
  const finishGesture = (cancel: boolean) => {
    const g = gestureRef.current
    gestureRef.current = null
    dragPointer.current = null
    setGestureDraft(null)
    if (!g || cancel || !g.moved) return
    const changed = Object.values(g.draft).some(next => {
      const before = clips.find(clip => clip.id === next.id)
      return before && (before.timelineStart !== next.timelineStart || before.track !== next.track || before.startSeconds !== next.startSeconds || before.endSeconds !== next.endSeconds)
    })
    if (changed) onClipsChange(clips.map(clip => g.draft[clip.id] ?? clip))
  }
  // Auto-scroll while dragging near the viewport edges (clip drags and external drags alike).
  const dragging = Boolean(gestureDraft) || Boolean(dropHint)
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const tick = () => {
      const viewport = viewportRef.current
      const pointer = dragPointer.current
      if (viewport && pointer) {
        const rect = viewport.getBoundingClientRect()
        if (pointer.x > rect.right - 40) viewport.scrollLeft += 10
        else if (pointer.x < rect.left + 40) viewport.scrollLeft -= 10
        if (gestureRef.current) updateGesture(pointer.x, pointer.y, false)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dragging])

  // ---------- external drops (pool assets, OS files) ----------
  const placementAt = (clientX: number, clientY: number): Placement => {
    const row = rowAt(clientX, clientY)
    const time = timeAtClientX(clientX)
    if (row) return { kind: row.kind, track: row.track, time }
    const content = contentRef.current?.getBoundingClientRect()
    if (content && clientY < content.top + RULER_HEIGHT + 4) return { kind: 'video', track: trackCount(clips, 'video') - 1, time }
    return { kind: 'audio', track: trackCount(clips, 'audio') - 1, time }
  }
  const finishDrop = () => { setDropHint(null); dragPointer.current = null }

  // ---------- ruler scrubbing, marquee ----------
  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubbing.current = event.pointerId
    setIsPlaying(false)
    setTime(timeAtClientX(event.clientX))
  }
  const moveScrub = (event: React.PointerEvent<HTMLDivElement>) => { if (scrubbing.current === event.pointerId) setTime(timeAtClientX(event.clientX)) }
  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => { if (scrubbing.current === event.pointerId) scrubbing.current = null }
  const contentPoint = (event: { clientX: number; clientY: number }) => {
    const rect = contentRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const startMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !contentRef.current || gestureRef.current) return
    if ((event.target as HTMLElement).closest('.clip, .timeline-ruler, button')) return
    const viewport = viewportRef.current
    if (viewport && (event.clientY > viewport.getBoundingClientRect().top + viewport.clientTop + viewport.clientHeight || event.clientX > viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth)) return
    const point = contentPoint(event)
    marqueeRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, currentX: point.x, currentY: point.y, additive: event.shiftKey || event.ctrlKey || event.metaKey, active: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = marqueeRef.current
    if (!current || current.pointerId !== event.pointerId) return
    const point = contentPoint(event)
    const next = { ...current, currentX: point.x, currentY: point.y, active: current.active || Math.hypot(point.x - current.x, point.y - current.y) > 4 }
    marqueeRef.current = next
    if (next.active) setMarquee(next)
  }
  const endMarquee = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = marqueeRef.current
    if (!current || current.pointerId !== event.pointerId || !contentRef.current) return
    marqueeRef.current = null
    setMarquee(null)
    if (cancel) return
    if (!current.active) {
      if (!current.additive) onClearSelection()
      setIsPlaying(false)
      setTime(timeAtClientX(event.clientX))
      return
    }
    const origin = contentRef.current.getBoundingClientRect()
    const box = { left: Math.min(current.x, current.currentX), right: Math.max(current.x, current.currentX), top: Math.min(current.y, current.currentY), bottom: Math.max(current.y, current.currentY) }
    const hits = Array.from(contentRef.current.querySelectorAll<HTMLElement>('.clip[data-id]'))
      .filter(element => { const r = element.getBoundingClientRect(); return rectsIntersect(box, { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top }) })
      .map(element => element.dataset.id!)
    onMarqueeSelect(hits, current.additive)
  }

  // ---------- edits ----------
  const replaceClip = (next: Clip) => onClipsChange(clips.map(clip => clip.id === next.id ? next : clip))
  const editSelected = (patch: (clip: Clip) => Clip) => onClipsChange(clips.map(clip => selectedIds.includes(clip.id) ? patch(clip) : clip))
  const markTrim = useCallback((edge: 'start' | 'end') => {
    const target = selectedClips.length === 1 ? selectedClips[0] : primaryClipAt(clips, currentTime)
    if (!target) return
    const sourceTime = sourceTimeAt(target, currentTime)
    if (sourceTime === null) return
    const asset = media.find(item => item.id === target.mediaId)
    const next = trimEdge(target, edge, sourceTime, asset?.metadata.durationSeconds ?? target.endSeconds, asset?.metadata.fps || fps)
    if (next.startSeconds === target.startSeconds && next.endSeconds === target.endSeconds) return
    onSelect(target.id, 'replace')
    onClipsChange(clips.map(clip => clip.id === target.id ? next : clip))
  }, [clips, selectedClips, currentTime, media, fps, onClipsChange, onSelect])
  const nudge = (dt: number, dTrack: number) => {
    if (!selectedClips.length) return
    const earliest = Math.min(...selectedClips.map(clip => clip.timelineStart))
    const shift = Math.max(-earliest, dt)
    onClipsChange(clips.map(clip => {
      if (!selectedIds.includes(clip.id)) return clip
      const lowest = Math.min(...selectedClips.filter(item => item.kind === clip.kind).map(item => item.track))
      return { ...clip, timelineStart: Math.max(0, clip.timelineStart + shift), track: Math.max(0, clip.track + Math.max(-lowest, dTrack)) }
    }))
  }
  const canSplit = clipsAt(clips, currentTime).some(clip => currentTime - clip.timelineStart >= 0.1 && clipEnd(clip) - currentTime >= 0.1)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.ctrlKey || event.metaKey || event.altKey || gestureRef.current) return
      const k = event.key
      if (k === ' ') { event.preventDefault(); togglePlayback() }
      else if (k.toLowerCase() === 'i' || k.toLowerCase() === 'o') { event.preventDefault(); markTrim(k.toLowerCase() === 'i' ? 'start' : 'end') }
      else if (k === '=' || k === '+') { event.preventDefault(); changeZoomRef.current(zoomRef.current * ZOOM_STEP) }
      else if (k === '-' || k === '_') { event.preventDefault(); changeZoomRef.current(zoomRef.current / ZOOM_STEP) }
      else if (k === '\\') { event.preventDefault(); changeZoomRef.current(1) }
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (!selectedIds.length) { event.preventDefault(); setTime(currentTime + (k === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / fps); return }
        event.preventDefault(); nudge((k === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / fps, 0)
      } else if ((k === 'ArrowUp' || k === 'ArrowDown') && selectedIds.length) { event.preventDefault(); nudge(0, k === 'ArrowUp' ? 1 : -1) }
      else if (k === 'Escape') { if (openMenu) setOpenMenu(null); else onClearSelection() }
      else if (k === 'Home') { event.preventDefault(); setTime(0) }
      else if (k === 'End') { event.preventDefault(); setTime(duration) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    if (!openMenu) return
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.timeline-popover')) setOpenMenu(null) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [openMenu])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY, startHeight = timelineHeight
    const move = (e: PointerEvent) => onTimelineHeightChange(clamp(startHeight - (e.clientY - startY), 140, 560))
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // ---------- derived render data ----------
  const step = pixelsPerSecond > 0 ? rulerStep(pixelsPerSecond) : 1
  const ticks: number[] = []
  if (pixelsPerSecond > 0) {
    const first = Math.max(0, Math.floor((view.scrollLeft - view.width) / pixelsPerSecond / step))
    const last = Math.min(renderSpan, (view.scrollLeft + view.width * 2) / pixelsPerSecond)
    for (let i = first; i * step <= last + 1e-9 && ticks.length < 500; i++) ticks.push(Math.round(i * step * 1000) / 1000)
  }
  const playPct = clamp((currentTime / renderSpan) * 100, 0, 100)
  const cropBoxStyle = crop.enabled && displayBounds ? { left: displayBounds.left + crop.x / frameWidth * displayBounds.width, top: displayBounds.top + crop.y / frameHeight * displayBounds.height, width: crop.width / frameWidth * displayBounds.width, height: crop.height / frameHeight * displayBounds.height } : null
  const layers = displayBounds ? displayClips
    .filter(clip => clip.kind === 'video' && !hiddenVideoTracks.includes(clip.track) && currentTime >= clip.timelineStart - 1 && currentTime < clipEnd(clip) + 1)
    .sort((a, b) => a.track - b.track || a.timelineStart - b.timelineStart) : []
  const menuClip = openMenu?.clip ?? (selectedClips.length === 1 ? selectedClips[0] : null)
  const toolbarDisabled = !hasProject
  const trimming = gestureDraft?.trimming ?? null
  const laneGhost = dropHint

  return (
    <div className="editor-grid" style={{ '--timeline-height': `${timelineHeight}px` } as React.CSSProperties}>
      <aside className="panel panel-media">{mediaPanel}</aside>

      <section className="panel panel-preview">
        <div ref={previewRef} className="video-preview-frame" onClick={() => { if (hasProject) togglePlayback() }}>
          {!hasProject && <div className="preview-empty" onClick={event => event.stopPropagation()}>
            <div className="preview-empty-mark"><Icon name="video" size={26} /></div>
            <div className="preview-empty-title">Drop video or audio anywhere</div>
            <div className="surface-note">Or paste a YouTube / X link, or import from the media pool.</div>
            <button className="btn-primary" onClick={onImport}><Icon name="plus" size={14} /><span>Import media</span></button>
          </div>}
          {displayBounds && <div className="frame-mask" style={{ left: displayBounds.left, top: displayBounds.top, width: displayBounds.width, height: displayBounds.height }} />}
          {displayBounds && layers.map(clip => <VideoLayer key={clip.id} clip={clip} asset={assetFor(clip)} bounds={displayBounds} frameAspect={frameAspect}
            time={currentTime} playing={isPlaying} rate={playbackRate} muted={muteAudio} selected={selectedIds.includes(clip.id)}
            onPointerDown={event => startLayerDrag(event, clip, 'move')} onResizeDown={event => startLayerDrag(event, clip, 'resize')} />)}
          {trimming && <output className="trim-timecode">{trimming.startSeconds.toFixed(2)} – {trimming.endSeconds.toFixed(2)}</output>}
          {cropBoxStyle && (
            <div className="crop-overlay-layer">
              <div className={`crop-box ${cropDragging ? 'is-dragging' : ''}`} onMouseDown={event => startCropDrag(event, 'move')} onClick={event => event.stopPropagation()} style={cropBoxStyle}>
                <div className="crop-grid" />
                <div className="crop-resize-handle" onMouseDown={event => startCropDrag(event, 'resize')} title="Resize crop" />
              </div>
            </div>
          )}
          {hasProject && !isPlaying && duration > 0 && !trimming && (
            <button className="preview-play" onClick={event => { event.stopPropagation(); togglePlayback() }} aria-label="Play preview" title={currentTime > 0 ? 'Resume' : 'Play'}><Icon name="play" size={22} /></button>
          )}
        </div>

        <div className="timeline-toolbar" ref={toolbarRef} role="toolbar" aria-label="Timeline editing">
          <button className="icon-button is-primary" onClick={togglePlayback} disabled={toolbarDisabled} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}><Icon name={isPlaying ? 'pause' : 'play'} size={15} /></button>
          <button className="icon-button" onClick={() => seekBy(-5)} disabled={toolbarDisabled} aria-label="Back five seconds" title="Back 5 seconds"><Icon name="skip-back" size={15} /></button>
          <button className="icon-button" onClick={() => seekBy(5)} disabled={toolbarDisabled} aria-label="Forward five seconds" title="Forward 5 seconds"><Icon name="skip-forward" size={15} /></button>
          <span className="timeline-time"><b>{formatDuration(currentTime)}</b> / {formatDuration(duration)}</span>
          <span className="timeline-divider" />
          <button className="icon-button" onClick={() => markTrim('start')} disabled={toolbarDisabled || !clipsAt(clips, currentTime, 'video').length} aria-label="Set in point" title="Set in point (I)"><Icon name="mark-in" size={15} /></button>
          <button className="icon-button" onClick={() => markTrim('end')} disabled={toolbarDisabled || !clipsAt(clips, currentTime, 'video').length} aria-label="Set out point" title="Set out point (O)"><Icon name="mark-out" size={15} /></button>
          <button className="icon-button" onClick={onSplit} disabled={!canSplit} aria-label="Split" title="Split at playhead (S)"><Icon name="scissors" size={15} /></button>
          <button className="icon-button" onClick={onRemoveSelected} disabled={!selectedIds.length} aria-label="Remove clip" title="Remove selected (Delete)"><Icon name="trash" size={15} /></button>
          <button className="icon-button" onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setOpenMenu(openMenu ? null : { x: r.left, y: r.top - 6, up: true, clip: null }) }} disabled={!selectedIds.length} aria-label="Clip actions" title="More clip actions" aria-expanded={Boolean(openMenu)}>⋯</button>
          <span className="timeline-toolbar-spacer" />
          <button className="icon-button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo edit">↶</button>
          <button className="icon-button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo edit">↷</button>
          <span className="timeline-divider" />
          <select className={`speed-select${playbackRate !== 1 ? ' speed-select--active' : ''}`} value={playbackRate} onChange={e => onPlaybackRateChange(Number(e.target.value))} aria-label="Playback speed" title="Playback speed">
            {SPEED_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
          <div className="timeline-zoom-controls">
            <button className="icon-button" onClick={() => changeZoom(zoom / ZOOM_STEP)} disabled={zoom <= 1 || toolbarDisabled} aria-label="Zoom out" title="Zoom out (−)">−</button>
            <button className="timeline-zoom" onClick={() => changeZoom(1)} disabled={toolbarDisabled} title="Fit timeline (\) · Ctrl + wheel or pinch to zoom">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</button>
            <button className="icon-button" onClick={() => changeZoom(zoom * ZOOM_STEP)} disabled={zoom >= maxZoom(axisSpan) || toolbarDisabled} aria-label="Zoom in" title="Zoom in (=)">+</button>
          </div>
        </div>
      </section>

      <aside className="panel panel-inspector">{inspector}</aside>

      <section className="panel panel-timeline">
        <div className="timeline-resize" onPointerDown={startResize} title="Drag to resize the timeline" />
        <div className="timeline-shell">
          <div className="track-headers-clip">
            <div ref={headersRef} className="track-headers">
              <div className="track-header track-header-ruler" style={{ height: RULER_HEIGHT }} />
              <div className="track-headers-group">
                {videoTracks.map(track => {
                  const used = clips.some(clip => clip.kind === 'video' && clip.track === track)
                  const hidden = hiddenVideoTracks.includes(track)
                  return <div key={`v${track}`} className={`track-header${hidden ? ' is-disabled' : ''}${used ? '' : ' is-empty'}`} style={{ height: rowHeight('video') + ROW_GAP }}>
                    <span>V{track + 1}</span>
                    {used && <button className="track-toggle" onClick={() => onToggleVideoTrack(track)} aria-label={`${hidden ? 'Show' : 'Hide'} track V${track + 1}`} title={hidden ? 'Show track' : 'Hide track'}>{hidden ? '○' : '●'}</button>}
                  </div>
                })}
              </div>
              <div className="track-headers-group">
                {audioTracks.map(track => {
                  const used = clips.some(clip => clip.kind === 'audio' && clip.track === track)
                  const muted = mutedAudioTracks.includes(track)
                  return <div key={`a${track}`} className={`track-header${muted ? ' is-disabled' : ''}${used ? '' : ' is-empty'}`} style={{ height: rowHeight('audio') + ROW_GAP }}>
                    <span>A{track + 1}</span>
                    {used && <button className="track-toggle" onClick={() => onToggleAudioTrack(track)} aria-label={`${muted ? 'Unmute' : 'Mute'} track A${track + 1}`} title={muted ? 'Unmute track' : 'Mute track'}>{muted ? '∅' : '♫'}</button>}
                  </div>
                })}
              </div>
            </div>
          </div>
          <div ref={viewportRef} className="timeline-viewport"
            onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={event => endMarquee(event)} onPointerCancel={event => endMarquee(event, true)}
            onDragOver={event => {
              if (!event.dataTransfer.types.some(type => type === MEDIA_MIME || type === 'Files')) return
              event.preventDefault()
              dragPointer.current = { x: event.clientX, y: event.clientY }
              const placement = placementAt(event.clientX, event.clientY)
              setDropHint({ ...placement, length: 0 })
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) finishDrop() }}
            onDrop={event => {
              event.preventDefault()
              const placement = placementAt(event.clientX, event.clientY)
              finishDrop()
              if (event.dataTransfer.files.length) {
                event.stopPropagation()
                onDropFiles(Array.from(event.dataTransfer.files, file => window.electronAPI.getPathForFile(file)).filter(Boolean), placement)
                return
              }
              const ids = parseMediaIds(event.dataTransfer.getData(MEDIA_MIME))
              if (ids.length) onInsertMedia(ids, placement)
            }}>
            <div style={{ width: `calc(${zoom * 100 * renderSpan / axisSpan}% + ${zoom > 1 ? END_PAD : 0}px)` }}>
              <div ref={contentRef} className="timeline-content" style={{ width: `calc(100% - ${zoom > 1 ? END_PAD : 0}px)` }}>
                <div className="timeline-ruler" style={{ height: RULER_HEIGHT, '--minor': `${Math.max(4, step * pixelsPerSecond / 5)}px` } as React.CSSProperties}
                  onPointerDown={startScrub} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub}>
                  {ticks.map(tick => <span key={tick} className="timeline-tick" style={{ left: `${tick / renderSpan * 100}%` }}>{formatRulerTime(tick, step)}</span>)}
                </div>
                {clips.length === 0 && <div className="timeline-empty-hint">{hasProject ? 'Drop clips on any track' : 'Drop video or audio here, or paste a link'}</div>}
                <Tracks kind="video" tracks={videoTracks} clips={displayClips.filter(clip => clip.kind === 'video')} media={media} span={renderSpan} selectedIds={selectedIds}
                  disabledTracks={hiddenVideoTracks} draggingIds={gestureDraft && !gestureDraft.trimming ? Object.keys(gestureDraft.clips) : []} dropHint={laneGhost}
                  time={currentTime} playing={isPlaying} rate={playbackRate} muteAll={muteAudio}
                  onClipPointerDown={onClipPointerDown} onClipContextMenu={(clip, x, y) => { if (!selectedIds.includes(clip.id)) onSelect(clip.id, 'replace'); setOpenMenu({ x, y, up: false, clip }) }} />
                <Tracks kind="audio" tracks={audioTracks} clips={displayClips.filter(clip => clip.kind === 'audio')} media={media} span={renderSpan} selectedIds={selectedIds}
                  disabledTracks={mutedAudioTracks} draggingIds={gestureDraft && !gestureDraft.trimming ? Object.keys(gestureDraft.clips) : []} dropHint={laneGhost}
                  time={currentTime} playing={isPlaying} rate={playbackRate} muteAll={muteAudio}
                  onClipPointerDown={onClipPointerDown} onClipContextMenu={(clip, x, y) => { if (!selectedIds.includes(clip.id)) onSelect(clip.id, 'replace'); setOpenMenu({ x, y, up: false, clip }) }} />
                {gestureDraft?.snapped !== null && gestureDraft?.snapped !== undefined && <div className="timeline-snap" style={{ left: `${gestureDraft.snapped / renderSpan * 100}%` }} />}
                <div className="timeline-playhead" style={{ left: `${playPct}%` }} />
                {marquee?.active && <div className="timeline-marquee" style={{ left: Math.min(marquee.x, marquee.currentX), top: Math.min(marquee.y, marquee.currentY), width: Math.abs(marquee.currentX - marquee.x), height: Math.abs(marquee.currentY - marquee.y) }} />}
              </div>
            </div>
          </div>
        </div>
        {openMenu && <div className="timeline-popover timeline-actions" role="menu" style={{ left: openMenu.x, top: openMenu.y, transform: openMenu.up ? 'translateY(-100%)' : undefined }}>
          <button role="menuitem" onClick={() => { onDuplicate(); setOpenMenu(null) }}>Duplicate</button>
          <button role="menuitem" aria-label="Reset trim" disabled={!menuClip} onClick={() => { if (menuClip) replaceClip({ ...menuClip, startSeconds: 0, endSeconds: sourceLength(menuClip) }); setOpenMenu(null) }}>Reset trim</button>
          {menuClip?.kind === 'video' && <>
            <button role="menuitem" onClick={() => { editSelected(clip => clip.kind === 'video' ? { ...clip, ...FULL_FRAME } : clip); setOpenMenu(null) }}>Fill frame</button>
            <button role="menuitem" onClick={() => { editSelected(clip => clip.kind === 'video' ? { ...clip, ...PIP_FRAME } : clip); setOpenMenu(null) }}>Picture-in-picture</button>
          </>}
          <button role="menuitem" onClick={() => { editSelected(clip => ({ ...clip, muted: !(menuClip?.muted ?? false) })); setOpenMenu(null) }}>{menuClip?.muted ? 'Unmute' : 'Mute'}</button>
          <span className="timeline-menu-divider" />
          <button role="menuitem" onClick={() => { onRemoveSelected(); setOpenMenu(null) }}>Remove</button>
        </div>}
      </section>
    </div>
  )
}
