import Lanes, { LANE_HEIGHT, LANE_GAP, type LaneClip, type LaneSelectMode } from './Lanes'
import React, { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import type { CropSelection, MediaAsset, AudioClip, OverlayClip } from '@shared/types'
import { formatDuration } from '../lib/sizeEstimator'
import Icon from './Icon'
import { clipAtTime, dropBoundary, timelineDuration, trimClipEdge, MIN_CLIP_SECONDS, type TimelineClip } from '../lib/clips'
import { anchoredScrollLeft, clampZoom, formatRulerTime, maxZoom, MEDIA_MIME, overlayTracks, parseMediaIds, rectsIntersect, rulerStep, wheelZoomFactor, type InsertTarget } from '../lib/timeline'

interface Props {
  filePath: string | null
  duration: number
  sourceDuration: number
  fps: number
  thumbnails: string[]
  videoWidth: number
  videoHeight: number
  crop: CropSelection
  currentTime: number
  playbackRate: number
  clips: TimelineClip[]
  selectedClipId: string | null
  selectedClipIds: string[]
  selectedLaneIds: string[]
  media: MediaAsset[]
  audioClips: AudioClip[]
  overlays: OverlayClip[]
  hiddenTracks: number[]
  muteAudio: boolean
  onAudioChange: (clips: AudioClip[]) => void
  onOverlayChange: (clips: OverlayClip[]) => void
  onToggleTrack: (track: number) => void
  onInsertMedia: (ids: string[], boundary: number, time: number, target?: InsertTarget) => void
  onDropFiles: (paths: string[], boundary: number, time: number, target?: InsertTarget) => void
  onGroupMove: (ids: string[], boundary: number) => void
  onSelectClip: (id: string, mode?: 'replace' | 'toggle' | 'range' | 'preserve') => void
  onSelectLane: (id: string, mode: LaneSelectMode) => void
  onMarqueeSelect: (videoIds: string[], laneIds: string[], additive: boolean) => void
  onClearSelection: () => void
  onImport: () => void
  mediaPanel: React.ReactNode
  inspector: React.ReactNode
  timelineHeight: number
  onTimelineHeightChange: (height: number) => void
  onInsertClip: (start: number, end: number) => void
  onRemoveClip: () => void
  onDuplicate: () => void
  onMoveClip: (from: number, to: number) => void
  onEditClip: (id: string, start: number, end: number) => void
  onSplit: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onTimeUpdate: (t: number) => void
  onCropChange: (crop: CropSelection) => void
  onPlaybackRateChange: (rate: number) => void
}

type CropDragTarget = 'move' | 'resize'

interface DisplayBounds {
  left: number
  top: number
  width: number
  height: number
}

interface CropDragState {
  target: CropDragTarget
  startClientX: number
  startClientY: number
  crop: CropSelection
}

interface TrimGesture {
  clip: TimelineClip
  next: TimelineClip
  edge: 'start' | 'end'
  pointerX: number
  scrollLeft: number
  pixelsPerSecond: number
  span: number
}

interface Marquee {
  pointerId: number
  x: number
  y: number
  currentX: number
  currentY: number
  additive: boolean
  active: boolean
}

const STRIP_HEIGHT = 60
const END_PAD = 48
const ZOOM_STEP = 1.25

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2]

export default function Editor({
  filePath,
  duration,
  sourceDuration,
  fps,
  thumbnails,
  videoWidth,
  videoHeight,
  crop,
  currentTime,
  playbackRate,
  clips,
  selectedClipId, selectedClipIds, selectedLaneIds, media, audioClips, overlays, hiddenTracks, muteAudio, onAudioChange, onOverlayChange, onToggleTrack, onInsertMedia, onDropFiles, onGroupMove,
  onSelectClip, onSelectLane, onMarqueeSelect, onClearSelection, onImport, mediaPanel, inspector, timelineHeight, onTimelineHeightChange,
  onInsertClip,
  onRemoveClip, onDuplicate,
  onMoveClip,
  onEditClip,
  onSplit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onTimeUpdate,
  onCropChange,
  onPlaybackRateChange
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const activeClipIndexRef = useRef(0)
  const trimGestureRef = useRef<TrimGesture | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [trimPreview, setTrimPreview] = useState<{ clip: TimelineClip; span: number } | null>(null)
  const [openMenu, setOpenMenu] = useState<'insert' | 'more' | null>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const pendingAnchor = useRef<{ time: number; clientX: number } | null>(null)
  const [view, setView] = useState({ scrollLeft: 0, width: 0, stripWidth: 0 })
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const [laneMenu, setLaneMenu] = useState<{ clip: LaneClip; x: number; y: number } | null>(null)
  const [overlayDraft, setOverlayDraft] = useState<OverlayClip | null>(null)
  const overlayDragRef = useRef<{ clip: OverlayClip; mode: 'move' | 'resize'; startX: number; startY: number; next: OverlayClip } | null>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef<number | null>(null)
  const [sourceIn, setSourceIn] = useState(0)
  const [sourceOut, setSourceOut] = useState(0)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [draggingIds, setDraggingIds] = useState<string[]>([])
  const dragX = useRef<number | null>(null)
  const pendingSeek = useRef<{ time: number; play: boolean } | null>(null)
  const [previewPath, setPreviewPath] = useState(filePath)
  const sourceFor = (clip?: TimelineClip) => media.find(asset => asset.id === clip?.mediaId)?.metadata
  const sourceLength = (clip?: TimelineClip) => sourceFor(clip)?.durationSeconds ?? sourceDuration
  const sourceFps = (clip?: TimelineClip) => sourceFor(clip)?.fps || fps
  const loadClip = useCallback((clip: TimelineClip, time: number, play: boolean) => {
    const path = media.find(asset => asset.id === clip.mediaId)?.metadata.filePath ?? filePath
    if (path !== previewPath) { pendingSeek.current = { time, play }; setPreviewPath(path) }
    else if (videoRef.current) { videoRef.current.currentTime = time; if (play) void videoRef.current.play().catch(() => {}) }
  }, [media, filePath, previewPath])
  useEffect(() => { setPreviewPath(filePath) }, [filePath])
  const displayBoundsRef = useRef<DisplayBounds | null>(null)
  const cropDragRef = useRef<CropDragState | null>(null)
  const [cropDragging, setCropDragging] = useState<CropDragTarget | null>(null)
  const [displayBounds, setDisplayBounds] = useState<DisplayBounds | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const selectedClip = clips.find(clip => clip.id === selectedClipId)
  const selectedIndex = clips.findIndex(clip => clip.id === selectedClipId)
  const displayClips = trimPreview ? clips.map(clip => clip.id === trimPreview.clip.id ? trimPreview.clip : clip) : clips
  const trimLeadingDelta = trimPreview && trimGestureRef.current?.edge === 'start'
    ? trimPreview.clip.startSeconds - trimGestureRef.current.clip.startSeconds : 0
  const axisSpan = trimPreview?.span ?? Math.max(sourceDuration, duration, 0.1)
  const renderSpan = Math.max(axisSpan, timelineDuration(displayClips) + trimLeadingDelta)
  const activeClip = clipAtTime(clips, currentTime)
  const canSplit = Boolean(activeClip && activeClip.sourceTime > activeClip.clip.startSeconds + MIN_CLIP_SECONDS && activeClip.sourceTime < activeClip.clip.endSeconds - MIN_CLIP_SECONDS)
  useEffect(() => { setSourceIn(0); setSourceOut(sourceDuration) }, [filePath, sourceDuration])

  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

  // Zoom keeps one point fixed on screen: the cursor for wheel/pinch, otherwise the
  // playhead (or the view centre when the playhead is off screen). The scroll is
  // corrected in a layout effect, after React has committed the new strip width.
  const changeZoom = (next: number, anchorClientX?: number) => {
    const viewport = viewportRef.current
    const strip = stripRef.current
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
    if (!pendingAnchor.current) {
      const time = clamp((clientX - stripRect.left) / stripRect.width * renderSpan, 0, renderSpan)
      pendingAnchor.current = { time, clientX }
    }
    zoomRef.current = normalized
    setZoom(normalized)
  }
  const changeZoomRef = useRef(changeZoom)
  changeZoomRef.current = changeZoom

  useLayoutEffect(() => {
    const anchor = pendingAnchor.current
    const viewport = viewportRef.current
    const strip = stripRef.current
    pendingAnchor.current = null
    if (!anchor || !viewport || !strip) return
    const rect = strip.getBoundingClientRect()
    viewport.scrollLeft = anchoredScrollLeft(viewport.scrollLeft, rect.left, rect.width, renderSpan, anchor.time, anchor.clientX)
  }, [zoom])

  useEffect(() => {
    zoomRef.current = 1
    pendingAnchor.current = null
    setZoom(1)
    if (viewportRef.current) viewportRef.current.scrollLeft = 0
  }, [filePath])

  // Track the visible window so the ruler only renders the ticks on screen.
  const hasPreview = Boolean(previewPath)
  useEffect(() => {
    const viewport = viewportRef.current
    const strip = stripRef.current
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
  }, [hasPreview])

  const clampCropToVideo = useCallback((nextCrop: CropSelection): CropSelection => {
    if (videoWidth <= 0 || videoHeight <= 0) return nextCrop

    const width = clamp(Math.round(nextCrop.width || videoWidth), Math.min(videoWidth, 32), videoWidth)
    const height = clamp(Math.round(nextCrop.height || videoHeight), Math.min(videoHeight, 32), videoHeight)

    return {
      enabled: nextCrop.enabled,
      width,
      height,
      x: Math.round(clamp(nextCrop.x, 0, videoWidth - width)),
      y: Math.round(clamp(nextCrop.y, 0, videoHeight - height))
    }
  }, [videoHeight, videoWidth])

  const posFromClientX = useCallback((clientX: number, rect: DOMRect): number => {
    if (duration <= 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * renderSpan, 0, duration)
  }, [duration, renderSpan])

  const setVideoTime = useCallback((time: number) => {
    const next = clamp(time, 0, duration || 0)
    const active = clipAtTime(clips, next)
    if (active) {
      activeClipIndexRef.current = active.index
      loadClip(active.clip, active.sourceTime, isPlaying)
    }
    onTimeUpdate(next)
  }, [clips, duration, onTimeUpdate, loadClip, isPlaying])

  useEffect(() => {
    const active = clipAtTime(clips, Math.min(currentTime, duration))
    if (active && videoRef.current) {
      activeClipIndexRef.current = active.index
      loadClip(active.clip, active.sourceTime, isPlaying)
    } else videoRef.current?.pause()
  }, [clips])

  const handleSourceTimeUpdate = useCallback((sourceTime: number) => {
    const video = videoRef.current
    if (trimGestureRef.current || pendingSeek.current || video?.seeking) return
    const index = activeClipIndexRef.current
    const clip = clips[index]
    if (!clip) return
    const before = timelineDuration(clips.slice(0, index))
    if (sourceTime >= clip.endSeconds - 0.5 / (fps || 30) && video && !video.paused) {
      if (index + 1 < clips.length) {
        activeClipIndexRef.current = index + 1
        loadClip(clips[index + 1], clips[index + 1].startSeconds, true)
        onTimeUpdate(before + clip.endSeconds - clip.startSeconds)
      } else {
        videoRef.current?.pause()
        onTimeUpdate(duration)
      }
      return
    }
    if (sourceTime >= clip.startSeconds - 0.05) {
      onTimeUpdate(before + Math.min(clip.endSeconds - clip.startSeconds, sourceTime - clip.startSeconds))
    }
  }, [clips, duration, fps, onTimeUpdate, loadClip])

  useEffect(() => {
    if (!isPlaying) return
    let frame: number
    const tick = () => {
      if (videoRef.current) handleSourceTimeUpdate(videoRef.current.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, handleSourceTimeUpdate])

  const startTrim = (event: React.PointerEvent<HTMLButtonElement>, clip: TimelineClip, edge: 'start' | 'end') => {
    if (event.button !== 0 || !stripRef.current || !viewportRef.current) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    videoRef.current?.pause()
    onSelectClip(clip.id)
    loadClip(clip, edge === 'start' ? clip.startSeconds : clip.endSeconds - 1 / sourceFps(clip), false)
    trimGestureRef.current = {
      clip, next: clip, edge, pointerX: event.clientX,
      scrollLeft: viewportRef.current.scrollLeft,
      pixelsPerSecond: stripRef.current.getBoundingClientRect().width / renderSpan,
      span: axisSpan
    }
    setTrimPreview({ clip, span: axisSpan })
  }

  const moveTrim = (event: { clientX: number }) => {
    const gesture = trimGestureRef.current
    const viewport = viewportRef.current
    if (!gesture || !viewport) return
    const bounds = viewport.getBoundingClientRect()
    if (event.clientX > bounds.right - 20) viewport.scrollLeft += 12
    else if (event.clientX < bounds.left + 20) viewport.scrollLeft -= 12
    const delta = (event.clientX - gesture.pointerX + viewport.scrollLeft - gesture.scrollLeft) / gesture.pixelsPerSecond
    const original = gesture.edge === 'start' ? gesture.clip.startSeconds : gesture.clip.endSeconds
    const next = trimClipEdge(gesture.clip, gesture.edge, original + delta, sourceLength(gesture.clip), sourceFps(gesture.clip))
    gesture.next = next
    setTrimPreview({ clip: next, span: gesture.span })
    if (videoRef.current) videoRef.current.currentTime = gesture.edge === 'start' ? next.startSeconds : Math.max(next.startSeconds, next.endSeconds - 1 / (fps || 30))
  }

  const finishTrim = (cancel = false) => {
    const gesture = trimGestureRef.current
    if (!gesture) return
    trimGestureRef.current = null
    setTrimPreview(null)
    if (!cancel) onEditClip(gesture.clip.id, gesture.next.startSeconds, gesture.next.endSeconds)
    if (cancel || (gesture.next.startSeconds === gesture.clip.startSeconds && gesture.next.endSeconds === gesture.clip.endSeconds)) setVideoTime(currentTime)
  }

  // Keep the gesture active outside the handle, including when native pointer
  // capture is unavailable (for example an unfocused Electron window).
  const isTrimming = Boolean(trimPreview)
  useEffect(() => {
    if (!isTrimming) return
    const up = () => finishTrim()
    const cancel = () => finishTrim(true)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
    }
    document.addEventListener('pointermove', moveTrim)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('pointermove', moveTrim)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', cancel)
    }
  }, [isTrimming, fps, sourceDuration, onEditClip, currentTime, setVideoTime])

  const markTrim = useCallback((edge: 'start' | 'end') => {
    const active = clipAtTime(clips, currentTime)
    if (!active) return
    const next = trimClipEdge(active.clip, edge, active.sourceTime, sourceLength(active.clip), sourceFps(active.clip))
    onSelectClip(active.clip.id)
    onEditClip(next.id, next.startSeconds, next.endSeconds)
  }, [clips, currentTime, fps, sourceDuration, onEditClip, onSelectClip])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.ctrlKey || event.metaKey || event.altKey || trimGestureRef.current) return
      if (event.key.toLowerCase() === 'i' || event.key.toLowerCase() === 'o') {
        event.preventDefault()
        markTrim(event.key.toLowerCase() === 'i' ? 'start' : 'end')
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault(); changeZoomRef.current(zoomRef.current * ZOOM_STEP)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault(); changeZoomRef.current(zoomRef.current / ZOOM_STEP)
      } else if (event.key === '\\') {
        event.preventDefault(); changeZoomRef.current(1)
      } else if (event.key === 'Escape' && !openMenu) {
        if (laneMenu) setLaneMenu(null); else onClearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [markTrim, openMenu, laneMenu, onClearSelection])

  const closeMenu = () => { setOpenMenu(null); setMenuAt(null) }
  useEffect(() => {
    if (!openMenu) return
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.timeline-popover') && !toolbarRef.current?.contains(event.target as Node)) closeMenu() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [openMenu])
  useEffect(() => {
    if (!laneMenu) return
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.timeline-popover')) setLaneMenu(null) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [laneMenu])

  // Ctrl/Cmd + wheel (and trackpad pinch, which Chromium reports as ctrl+wheel) zooms
  // around the cursor; a plain wheel scrolls the timeline sideways.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const wheel = (event: WheelEvent) => {
      if (trimGestureRef.current) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        changeZoomRef.current(zoomRef.current * wheelZoomFactor(event.deltaY, event.deltaMode), event.clientX)
      } else if (viewport.scrollWidth > viewport.clientWidth) {
        event.preventDefault()
        const unit = event.deltaMode === 1 ? 16 : 1
        viewport.scrollLeft += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit
      }
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [hasPreview])

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!video || duration <= 0) return

    if (video.paused) {
      if (currentTime >= duration) setVideoTime(0)
      try {
        await video.play()
      } catch {
        // no-op
      }
    } else {
      video.pause()
    }
  }, [currentTime, duration, setVideoTime])

  const seekBy = useCallback((delta: number) => {
    setVideoTime(currentTime + delta)
  }, [currentTime, setVideoTime])

  const startCropDrag = useCallback((event: React.MouseEvent<HTMLDivElement>, target: CropDragTarget) => {
    event.preventDefault()
    event.stopPropagation()
    cropDragRef.current = {
      target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      crop
    }
    setCropDragging(target)
  }, [crop])

  useEffect(() => {
    const preview = previewRef.current
    if (!preview || videoWidth <= 0 || videoHeight <= 0) {
      displayBoundsRef.current = null
      setDisplayBounds(null)
      return
    }

    const updateBounds = () => {
      const rect = preview.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const containerRatio = rect.width / rect.height
      const videoRatio = videoWidth / videoHeight
      let width = rect.width
      let height = rect.height
      let left = 0
      let top = 0

      if (containerRatio > videoRatio) {
        height = rect.height
        width = height * videoRatio
        left = (rect.width - width) / 2
      } else {
        width = rect.width
        height = width / videoRatio
        top = (rect.height - height) / 2
      }

      const nextBounds = { left, top, width, height }
      displayBoundsRef.current = nextBounds
      setDisplayBounds(nextBounds)
    }

    updateBounds()
    const resizeObserver = new ResizeObserver(updateBounds)
    resizeObserver.observe(preview)
    window.addEventListener('resize', updateBounds)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [videoHeight, videoWidth])

  useEffect(() => {
    if (!cropDragging) return

    const onMove = (event: MouseEvent) => {
      const drag = cropDragRef.current
      const bounds = displayBoundsRef.current
      if (!drag || !bounds || bounds.width <= 0 || bounds.height <= 0) return

      const sourceScaleX = videoWidth / bounds.width
      const sourceScaleY = videoHeight / bounds.height
      const deltaX = (event.clientX - drag.startClientX) * sourceScaleX
      const deltaY = (event.clientY - drag.startClientY) * sourceScaleY

      if (drag.target === 'move') {
        onCropChange(clampCropToVideo({
          ...drag.crop,
          enabled: true,
          x: drag.crop.x + deltaX,
          y: drag.crop.y + deltaY
        }))
        return
      }

      const maxWidth = Math.max(2, videoWidth - drag.crop.x)
      const maxHeight = Math.max(2, videoHeight - drag.crop.y)
      const minWidth = Math.min(maxWidth, 32)
      const minHeight = Math.min(maxHeight, 32)

      onCropChange(clampCropToVideo({
        ...drag.crop,
        enabled: true,
        width: clamp(drag.crop.width + deltaX, minWidth, maxWidth),
        height: clamp(drag.crop.height + deltaY, minHeight, maxHeight)
      }))
    }

    const onUp = () => {
      cropDragRef.current = null
      setCropDragging(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [clampCropToVideo, cropDragging, onCropChange, videoHeight, videoWidth])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])

  const timeAtClientX = (clientX: number) => {
    const strip = stripRef.current
    if (!strip) return 0
    const rect = strip.getBoundingClientRect()
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width * renderSpan, 0, renderSpan) : 0
  }

  const updateDrop = (x: number) => dropBoundary(clips, timeAtClientX(x))
  useEffect(() => {
    if (dropIndex === null) return
    let frame: number
    const tick = () => {
      const viewport = viewportRef.current
      if (viewport && dragX.current !== null) {
        const rect = viewport.getBoundingClientRect()
        if (dragX.current > rect.right - 48) viewport.scrollLeft += 8
        else if (dragX.current < rect.left + 48) viewport.scrollLeft -= 8
        setDropIndex(updateDrop(dragX.current))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dropIndex !== null, clips, renderSpan])
  const finishDrop = () => { setDropIndex(null); setDraggingIds([]); dragX.current = null }

  // Page the view forward during playback so the playhead never runs off screen.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!isPlaying || scrubbing.current !== null || !viewport || view.stripWidth <= 0) return
    const x = currentTime / renderSpan * view.stripWidth
    if (x > viewport.scrollLeft + viewport.clientWidth - 24 || x < viewport.scrollLeft) viewport.scrollLeft = x - viewport.clientWidth * 0.1
  }, [currentTime, isPlaying, renderSpan, view.stripWidth])

  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || trimPreview) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubbing.current = event.pointerId
    setVideoTime(timeAtClientX(event.clientX))
  }
  const moveScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === event.pointerId) setVideoTime(timeAtClientX(event.clientX))
  }
  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === event.pointerId) scrubbing.current = null
  }

  // Rubber-band selection over empty timeline space; a click without dragging seeks.
  const contentPoint = (event: { clientX: number; clientY: number }) => {
    const rect = contentRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const startMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || trimPreview || !contentRef.current) return
    if ((event.target as HTMLElement).closest('.timeline-clip, .lane-clip, .timeline-ruler, button')) return
    const viewport = viewportRef.current
    if (viewport && event.clientY > viewport.getBoundingClientRect().top + viewport.clientTop + viewport.clientHeight) return // scrollbar
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
      setVideoTime(timeAtClientX(event.clientX))
      return
    }
    const origin = contentRef.current.getBoundingClientRect()
    const box = { left: Math.min(current.x, current.currentX), right: Math.max(current.x, current.currentX), top: Math.min(current.y, current.currentY), bottom: Math.max(current.y, current.currentY) }
    const hits = (selector: string) => Array.from(contentRef.current!.querySelectorAll<HTMLElement>(selector))
      .filter(element => {
        const rect = element.getBoundingClientRect()
        return rectsIntersect(box, { left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top })
      })
      .map(element => element.dataset.id)
      .filter((id): id is string => Boolean(id))
    onMarqueeSelect(hits('.timeline-clip'), hits('.lane-clip'), current.additive)
  }

  const openMenuAt = (menu: 'insert' | 'more', element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setMenuAt({ x: rect.left, y: rect.top - 6, up: true })
    setOpenMenu(openMenu === menu ? null : menu)
  }
  const menuStyle: React.CSSProperties | undefined = menuAt ? { left: menuAt.x, top: menuAt.y, transform: menuAt.up ? 'translateY(-100%)' : undefined } : undefined

  // --- Stacked video: drag to move, corner handle to resize, inside the preview frame ---
  const displayOverlays = overlays.map(clip => overlayDraft?.id === clip.id ? overlayDraft : clip)
  const activeOverlays = displayOverlays
    .filter(clip => !hiddenTracks.includes(clip.track) && currentTime >= clip.timelineStart - 1e-6 && currentTime < clip.timelineStart + (clip.endSeconds - clip.startSeconds))
    .sort((a, b) => a.track - b.track)
  const startOverlayDrag = (event: React.PointerEvent<HTMLElement>, clip: OverlayClip, mode: 'move' | 'resize') => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    onSelectLane(clip.id, 'replace')
    overlayDragRef.current = { clip, mode, startX: event.clientX, startY: event.clientY, next: clip }
    setOverlayDraft(clip)
  }
  useEffect(() => {
    if (!overlayDraft) return
    const move = (event: PointerEvent) => {
      const drag = overlayDragRef.current
      const bounds = displayBoundsRef.current
      if (!drag || !bounds || bounds.width <= 0) return
      const dx = (event.clientX - drag.startX) / bounds.width
      const dy = (event.clientY - drag.startY) / bounds.height
      const asset = media.find(item => item.id === drag.clip.mediaId)?.metadata
      const aspect = asset && asset.width > 0 && asset.height > 0 ? asset.height / asset.width : 9 / 16
      const frameAspect = videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 9 / 16
      const heightFraction = (scale: number) => scale * aspect / frameAspect
      let next: OverlayClip
      if (drag.mode === 'move') {
        const h = heightFraction(drag.clip.scale)
        next = { ...drag.clip, x: clamp(drag.clip.x + dx, -drag.clip.scale * 0.9, 1 - drag.clip.scale * 0.1), y: clamp(drag.clip.y + dy, -h * 0.9, 1 - h * 0.1) }
      } else {
        const scale = clamp(drag.clip.scale + dx, 0.05, 1)
        next = { ...drag.clip, scale }
      }
      drag.next = next
      setOverlayDraft(next)
    }
    const end = () => {
      const drag = overlayDragRef.current
      overlayDragRef.current = null
      setOverlayDraft(null)
      if (!drag) return
      const { next, clip } = drag
      if (next.x !== clip.x || next.y !== clip.y || next.scale !== clip.scale) onOverlayChange(overlays.map(item => item.id === clip.id ? next : item))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end) }
  }, [Boolean(overlayDraft), overlays, media, videoWidth, videoHeight, onOverlayChange])

  // Track headers scroll with the lanes.
  useEffect(() => {
    const viewport = viewportRef.current
    const headers = headersRef.current
    if (!viewport || !headers) return
    const sync = () => { headers.style.transform = `translateY(${-viewport.scrollTop}px)` }
    sync()
    viewport.addEventListener('scroll', sync, { passive: true })
    return () => viewport.removeEventListener('scroll', sync)
  }, [hasPreview])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = timelineHeight
    const move = (e: PointerEvent) => onTimelineHeightChange(clamp(startHeight - (e.clientY - startY), 140, 520))
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const pixelsPerSecond = view.stripWidth > 0 ? view.stripWidth / renderSpan : 0
  const step = pixelsPerSecond > 0 ? rulerStep(pixelsPerSecond) : 1
  const ticks: number[] = []
  if (pixelsPerSecond > 0) {
    const first = Math.max(0, Math.floor((view.scrollLeft - view.width) / pixelsPerSecond / step))
    const last = Math.min(renderSpan, (view.scrollLeft + view.width * 2) / pixelsPerSecond)
    for (let i = first; i * step <= last + 1e-9 && ticks.length < 500; i++) ticks.push(Math.round(i * step * 1000) / 1000)
  }

  const src = previewPath ? `safe-file://video?path=${encodeURIComponent(previewPath)}` : null
  const playPct = clamp((currentTime / renderSpan) * 100, 0, 100)
  const cropBoxStyle = crop.enabled && displayBounds && videoWidth > 0 && videoHeight > 0
    ? {
        left: displayBounds.left + (crop.x / videoWidth) * displayBounds.width,
        top: displayBounds.top + (crop.y / videoHeight) * displayBounds.height,
        width: (crop.width / videoWidth) * displayBounds.width,
        height: (crop.height / videoHeight) * displayBounds.height
      }
    : null
  const tracks = overlayTracks(overlays)
  const videoLanes = tracks.map(track => ({ key: `v${track}`, track, clips: overlays.filter(clip => clip.track === track), hidden: hiddenTracks.includes(track) }))
  const audioLanes = audioClips.length ? audioClips.map(clip => ({ key: clip.id, clips: [clip] })) : [{ key: 'a-empty', clips: [] as AudioClip[] }]
  const laneHeight = LANE_HEIGHT + LANE_GAP
  const toolbarDisabled = Boolean(trimPreview) || !src
  const selectedMenuClip = laneMenu?.clip
  const menuOverlay = selectedMenuClip && 'track' in selectedMenuClip ? selectedMenuClip as OverlayClip : null
  const menuAudio = selectedMenuClip && 'volume' in selectedMenuClip ? selectedMenuClip as AudioClip : null

  return (
    <div className="editor-grid" style={{ '--timeline-height': `${timelineHeight}px` } as React.CSSProperties}>
      <aside className="panel panel-media">{mediaPanel}</aside>

      <section className="panel panel-preview">
        <div ref={previewRef} className="video-preview-frame">
          {src ? <video
            key={src}
            ref={videoRef}
            src={src}
            muted={muteAudio}
            onLoadedMetadata={() => {
              const video = videoRef.current
              const seek = pendingSeek.current
              if (!video) return
              video.playbackRate = playbackRate
              if (seek) { pendingSeek.current = null; video.currentTime = seek.time; if (seek.play) void video.play().catch(() => {}) }
              else { const active = clipAtTime(clips, currentTime); if (active) video.currentTime = active.sourceTime }
            }}
            playsInline
            preload="metadata"
            onClick={togglePlayback}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              const index = activeClipIndexRef.current
              if (index + 1 < clips.length) {
                activeClipIndexRef.current = index + 1
                loadClip(clips[index + 1], clips[index + 1].startSeconds, true)
                onTimeUpdate(timelineDuration(clips.slice(0, index + 1)))
              } else { setIsPlaying(false); onTimeUpdate(duration) }
            }}
            onTimeUpdate={(event) => handleSourceTimeUpdate((event.target as HTMLVideoElement).currentTime)}
            className="video-preview"
          /> : <div className="preview-empty">
            <div className="preview-empty-mark"><Icon name="video" size={26} /></div>
            <div className="preview-empty-title">Drop video or audio anywhere</div>
            <div className="surface-note">Or paste a YouTube / X link, or import from the media pool.</div>
            <button className="btn-primary" onClick={onImport}><Icon name="plus" size={14} /><span>Import media</span></button>
          </div>}

          {displayBounds && activeOverlays.map(clip => {
            const asset = media.find(item => item.id === clip.mediaId)
            const aspect = asset && asset.metadata.width > 0 ? asset.metadata.height / asset.metadata.width : 9 / 16
            const width = clip.scale * displayBounds.width
            const selected = selectedLaneIds.includes(clip.id)
            return <div key={clip.id} className={`overlay-layer${selected ? ' is-selected' : ''}`} data-id={clip.id}
              style={{ left: displayBounds.left + clip.x * displayBounds.width, top: displayBounds.top + clip.y * displayBounds.height, width, height: width * aspect, opacity: clip.opacity }}
              onPointerDown={event => startOverlayDrag(event, clip, 'move')}
              onClick={event => event.stopPropagation()}
              title={`${asset?.metadata.fileName ?? 'Stacked video'} · drag to move, corner to resize`}>
              <OverlayVideo clip={clip} asset={asset} time={currentTime} playing={isPlaying} rate={playbackRate} />
              {selected && <div className="overlay-resize-handle" onPointerDown={event => startOverlayDrag(event, clip, 'resize')} />}
            </div>
          })}

          {trimPreview && <output className="trim-timecode">{trimPreview.clip.startSeconds.toFixed(2)} – {trimPreview.clip.endSeconds.toFixed(2)}</output>}

          {cropBoxStyle && (
            <div className="crop-overlay-layer">
              <div
                className={`crop-box ${cropDragging ? 'is-dragging' : ''}`}
                onMouseDown={(event) => startCropDrag(event, 'move')}
                onClick={(event) => event.stopPropagation()}
                style={cropBoxStyle}
              >
                <div className="crop-grid" />
                <div
                  className="crop-resize-handle"
                  onMouseDown={(event) => startCropDrag(event, 'resize')}
                  title="Resize crop"
                />
              </div>
            </div>
          )}

          {src && !isPlaying && !trimPreview && duration > 0 && (
            <button className="preview-play" onClick={togglePlayback} aria-label="Play preview" title={currentTime > 0 ? 'Resume' : 'Play'}>
              <Icon name="play" size={22} />
            </button>
          )}
        </div>

        <div className="timeline-toolbar" ref={toolbarRef} role="toolbar" aria-label="Timeline editing">
          <button className="icon-button is-primary" onClick={togglePlayback} disabled={!src} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}><Icon name={isPlaying ? 'pause' : 'play'} size={15} /></button>
          <button className="icon-button" onClick={() => seekBy(-5)} disabled={!src} aria-label="Back five seconds" title="Back 5 seconds"><Icon name="skip-back" size={15} /></button>
          <button className="icon-button" onClick={() => seekBy(5)} disabled={!src} aria-label="Forward five seconds" title="Forward 5 seconds"><Icon name="skip-forward" size={15} /></button>
          <span className="timeline-time"><b>{formatDuration(currentTime)}</b> / {formatDuration(duration)}</span>
          <span className="timeline-divider" />
          <button className="icon-button" onClick={() => markTrim('start')} disabled={!activeClip || toolbarDisabled} aria-label="Set in point" title="Set in point (I)"><Icon name="mark-in" size={15} /></button>
          <button className="icon-button" onClick={() => markTrim('end')} disabled={!activeClip || toolbarDisabled} aria-label="Set out point" title="Set out point (O)"><Icon name="mark-out" size={15} /></button>
          <button className="icon-button" onClick={onSplit} disabled={!canSplit || toolbarDisabled} aria-label="Split" title="Split at playhead (S)"><Icon name="scissors" size={15} /></button>
          <button className="icon-button" onClick={onRemoveClip} disabled={!(selectedClipIds.length || selectedLaneIds.length) || toolbarDisabled} aria-label="Remove clip" title="Remove selected (Delete)"><Icon name="trash" size={15} /></button>
          <button className="icon-button" onClick={event => openMenuAt('more', event.currentTarget)} disabled={toolbarDisabled} aria-label="Clip actions" title="More clip actions" aria-expanded={openMenu === 'more'}>⋯</button>
          <span className="timeline-toolbar-spacer" />
          <button className="icon-button" onClick={onUndo} disabled={!canUndo || Boolean(trimPreview)} title="Undo (Ctrl+Z)" aria-label="Undo edit">↶</button>
          <button className="icon-button" onClick={onRedo} disabled={!canRedo || Boolean(trimPreview)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo edit">↷</button>
          <span className="timeline-divider" />
          <select
            className={`speed-select${playbackRate !== 1 ? ' speed-select--active' : ''}`}
            value={playbackRate}
            onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
            aria-label="Playback speed"
            title="Playback speed"
          >
            {SPEED_OPTIONS.map((rate) => (
              <option key={rate} value={rate}>{rate}×</option>
            ))}
          </select>
          <div className="timeline-zoom-controls">
            <button className="icon-button" onClick={() => changeZoom(zoom / ZOOM_STEP)} disabled={zoom <= 1 || toolbarDisabled} aria-label="Zoom out" title="Zoom out (−)">−</button>
            <button className="timeline-zoom" onClick={() => changeZoom(1)} disabled={toolbarDisabled} title="Fit timeline (\) · Ctrl + wheel or pinch to zoom">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</button>
            <button className="icon-button" onClick={() => changeZoom(zoom * ZOOM_STEP)} disabled={zoom >= maxZoom(axisSpan) || toolbarDisabled} aria-label="Zoom in" title="Zoom in (=)">+</button>
          </div>
          {openMenu === 'insert' && <div className="timeline-popover" role="dialog" aria-label="Insert clip" style={menuStyle}>
            <label>In<input aria-label="Source in seconds" type="number" min={0} max={sourceDuration} step={0.1} value={sourceIn} onChange={event => setSourceIn(Number(event.target.value))} /></label>
            <label>Out<input aria-label="Source out seconds" type="number" min={0} max={sourceDuration} step={0.1} value={sourceOut} onChange={event => setSourceOut(Number(event.target.value))} /></label>
            <button className="btn-primary" onClick={() => { onInsertClip(sourceIn, sourceOut); closeMenu() }} disabled={sourceOut - sourceIn < MIN_CLIP_SECONDS || sourceIn < 0 || sourceOut > sourceDuration}>Insert</button>
          </div>}
          {openMenu === 'more' && <div className="timeline-popover timeline-actions" role="menu" style={menuStyle}>
            <button role="menuitem" disabled={!selectedClip} onClick={() => { onDuplicate(); closeMenu() }}>Duplicate</button>
            <button role="menuitem" disabled={!selectedClip || selectedIndex <= 0} onClick={() => { onMoveClip(selectedIndex, selectedIndex - 1); closeMenu() }}>Move left</button>
            <button role="menuitem" disabled={!selectedClip || selectedIndex === clips.length - 1} onClick={() => { onMoveClip(selectedIndex, selectedIndex + 1); closeMenu() }}>Move right</button>
            <button role="menuitem" aria-label="Reset trim" disabled={!selectedClip} onClick={() => { if (selectedClip) onEditClip(selectedClip.id, 0, sourceLength(selectedClip)); closeMenu() }}>Reset trim</button>
            <span className="timeline-menu-divider" />
            <button role="menuitem" onClick={() => setOpenMenu('insert')}>Insert from source…</button>
          </div>}
        </div>
      </section>

      <aside className="panel panel-inspector">{inspector}</aside>

      <section className="panel panel-timeline">
        <div className="timeline-resize" onPointerDown={startResize} title="Drag to resize the timeline" />
        <div className="timeline-shell">
          <div className="track-headers-clip">
            <div ref={headersRef} className="track-headers">
              <div className="track-header track-header-ruler" />
              {videoLanes.map(lane => <div key={lane.key} className={`track-header${lane.hidden ? ' is-hidden' : ''}`} style={{ height: laneHeight }}>
                <span>V{lane.track + 1}</span>
                {lane.clips.length > 0 && <button className="track-toggle" onClick={() => onToggleTrack(lane.track)} aria-label={`${lane.hidden ? 'Show' : 'Hide'} track V${lane.track + 1}`} title={lane.hidden ? 'Show track' : 'Hide track'}>{lane.hidden ? '○' : '●'}</button>}
              </div>)}
              <div className="track-header track-header-v1" style={{ height: STRIP_HEIGHT + 4 }}><span>V1</span></div>
              {audioLanes.map((lane, index) => <div key={lane.key} className="track-header" style={{ height: laneHeight }}><span>A{index + 1}</span></div>)}
            </div>
          </div>
          <div ref={viewportRef} className="timeline-viewport"
            onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={event => endMarquee(event)} onPointerCancel={event => endMarquee(event, true)}
            onDragOver={event => {
              if (!event.dataTransfer.types.some(type => type === 'application/x-daxil-clips' || type === MEDIA_MIME || type === 'Files')) return
              event.preventDefault(); dragX.current = event.clientX; setDropIndex(updateDrop(event.clientX))
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setDropIndex(null); dragX.current = null } }}
            onDrop={event => {
              event.preventDefault()
              const boundary = updateDrop(event.clientX)
              const time = timeAtClientX(event.clientX)
              const lane = (event.target as HTMLElement).closest<HTMLElement>('.lane-video')
              const target: InsertTarget = lane?.dataset.track ? { track: Number(lane.dataset.track) } : 'sequence'
              if (event.dataTransfer.files.length) {
                event.stopPropagation()
                finishDrop()
                onDropFiles(Array.from(event.dataTransfer.files, file => window.electronAPI.getPathForFile(file)).filter(Boolean), boundary, time, target)
                return
              }
              const ids = parseMediaIds(event.dataTransfer.getData(MEDIA_MIME))
              if (ids.length) onInsertMedia(ids, boundary, time, target)
              else { try { onGroupMove(JSON.parse(event.dataTransfer.getData('application/x-daxil-clips')), boundary) } catch { /* unrelated drag */ } }
              finishDrop()
            }}>
            <div style={{ width: `calc(${zoom * 100 * renderSpan / axisSpan}% + ${zoom > 1 ? END_PAD : 0}px)` }}>
              <div ref={contentRef} className="timeline-content" style={{ width: `calc(100% - ${zoom > 1 ? END_PAD : 0}px)` }}>
                <div className="timeline-ruler" onPointerDown={startScrub} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub}
                  style={{ '--minor': `${Math.max(4, step * pixelsPerSecond / 5)}px` } as React.CSSProperties}>
                  {ticks.map(tick => <span key={tick} className="timeline-tick" style={{ left: `${tick / renderSpan * 100}%` }}>{formatRulerTime(tick, step)}</span>)}
                </div>
                <Lanes kind="video" lanes={videoLanes} media={media} span={renderSpan} duration={duration} time={currentTime} playing={isPlaying} rate={playbackRate} muted
                  selectedIds={selectedLaneIds} dropHint={dropIndex !== null} onSelect={onSelectLane} onChange={onOverlayChange}
                  onDropMedia={(ids, time, track) => { finishDrop(); onInsertMedia(ids, dropBoundary(clips, time), time, { track: track ?? 1 }) }}
                  onContextMenu={(clip, x, y) => setLaneMenu({ clip, x, y })} />
                <div ref={stripRef} className="timeline-strip" style={{ height: STRIP_HEIGHT }}>
                  {clips.length === 0 && <div className="timeline-empty-hint">{src ? 'Drop video here' : 'Drop video or audio here, or paste a link'}</div>}
                  {displayClips.map((clip, index) => {
                    const thumbIndex = sourceDuration > 0 ? Math.min(thumbnails.length - 1, Math.floor(((clip.startSeconds + clip.endSeconds) / 2 / sourceDuration) * thumbnails.length)) : -1
                    const thumbnail = media.find(asset => asset.id === clip.mediaId)?.thumbnail ?? (thumbIndex >= 0 ? thumbnails[thumbIndex] : undefined)
                    const selected = selectedClipIds.includes(clip.id)
                    return <div key={clip.id}
                      data-id={clip.id}
                      className={`timeline-clip${selected ? ' is-selected' : ''}`}
                      data-source-in={clip.startSeconds}
                      data-source-out={clip.endSeconds}
                      draggable={!trimPreview}
                      onDragStart={event => {
                        const ids = selected ? selectedClipIds : [clip.id]
                        onSelectClip(clip.id, 'preserve'); setDraggingIds(ids)
                        event.dataTransfer.setData('application/x-daxil-clips', JSON.stringify(ids)); event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={finishDrop}
                      onClick={event => { event.stopPropagation(); onSelectClip(clip.id, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace'); if (!event.shiftKey && !event.ctrlKey && !event.metaKey) setVideoTime(posFromClientX(event.clientX, stripRef.current!.getBoundingClientRect())) }}
                      onContextMenu={event => {
                        event.preventDefault()
                        if (!selected) onSelectClip(clip.id)
                        setMenuAt({ x: event.clientX, y: event.clientY, up: false }); setOpenMenu('more')
                      }}
                      style={{ width: `${(clip.endSeconds - clip.startSeconds) / renderSpan * 100}%`, opacity: draggingIds.includes(clip.id) ? 0.45 : 1, marginLeft: trimPreview?.clip.id === clip.id ? `${trimLeadingDelta / renderSpan * 100}%` : undefined }}
                      title={`Clip ${index + 1} · ${clip.startSeconds.toFixed(2)}–${clip.endSeconds.toFixed(2)}s · right-click for actions`}>
                      <div className="timeline-clip-thumb" style={{ backgroundImage: thumbnail ? `url(${thumbnail})` : undefined }} />
                      <div className="timeline-clip-label">{index + 1} · {formatDuration(clip.endSeconds - clip.startSeconds)}</div>
                      {(['start', 'end'] as const).map(edge => <button key={edge}
                        className={`timeline-trim-handle ${edge}`}
                        aria-label={`Trim clip ${index + 1} ${edge}`}
                        title={`Trim ${edge} · drag or use arrow keys`}
                        onPointerDown={event => startTrim(event, clip, edge)}
                        onClick={event => event.stopPropagation()}
                        onDragStart={event => { event.preventDefault(); event.stopPropagation() }}
                        onKeyDown={event => {
                          if (event.key === 'Escape') { event.stopPropagation(); finishTrim(true); return }
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                          event.preventDefault()
                          event.stopPropagation()
                          const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1) / (fps || 30)
                          const next = trimClipEdge(clip, edge, (edge === 'start' ? clip.startSeconds : clip.endSeconds) + delta, sourceLength(clip), sourceFps(clip))
                          onEditClip(next.id, next.startSeconds, next.endSeconds)
                        }}><span /></button>)}
                    </div>
                  })}
                  {dropIndex !== null && <div className="timeline-drop-marker" style={{ left: `${timelineDuration(clips.slice(0, dropIndex)) / renderSpan * 100}%` }} />}
                </div>
                <Lanes kind="audio" lanes={audioLanes} media={media} span={renderSpan} duration={duration} time={currentTime} playing={isPlaying} rate={playbackRate} muted={muteAudio}
                  selectedIds={selectedLaneIds} dropHint={dropIndex !== null} onSelect={onSelectLane} onChange={onAudioChange}
                  onDropMedia={(ids, time) => { finishDrop(); onInsertMedia(ids, dropBoundary(clips, time), time) }}
                  onContextMenu={(clip, x, y) => setLaneMenu({ clip, x, y })} />
                <div className="timeline-playhead" style={{ left: `${playPct}%` }} />
                {marquee?.active && <div className="timeline-marquee" style={{
                  left: Math.min(marquee.x, marquee.currentX), top: Math.min(marquee.y, marquee.currentY),
                  width: Math.abs(marquee.currentX - marquee.x), height: Math.abs(marquee.currentY - marquee.y)
                }} />}
              </div>
            </div>
          </div>
        </div>
        {laneMenu && <div className="timeline-popover timeline-actions" role="menu" style={{ left: laneMenu.x, top: laneMenu.y }}>
          {menuOverlay && <>
            <button role="menuitem" onClick={() => { onOverlayChange(overlays.map(item => item.id === menuOverlay.id ? { ...item, x: 0, y: 0, scale: 1 } : item)); setLaneMenu(null) }}>Fill frame</button>
            <button role="menuitem" onClick={() => { onOverlayChange(overlays.map(item => item.id === menuOverlay.id ? { ...item, x: 0.58, y: 0.05, scale: 0.4, opacity: 1 } : item)); setLaneMenu(null) }}>Reset size and position</button>
            <button role="menuitem" onClick={() => { onOverlayChange([...overlays, { ...menuOverlay, id: crypto.randomUUID(), track: menuOverlay.track + 1 }]); setLaneMenu(null) }}>Duplicate to V{menuOverlay.track + 2}</button>
            <span className="timeline-menu-divider" />
            <button role="menuitem" onClick={() => { onOverlayChange(overlays.filter(item => item.id !== menuOverlay.id)); setLaneMenu(null) }}>Remove</button>
          </>}
          {menuAudio && <>
            <button role="menuitem" onClick={() => { onAudioChange(audioClips.map(item => item.id === menuAudio.id ? { ...item, volume: item.volume ? 0 : 1 } : item)); setLaneMenu(null) }}>{menuAudio.volume ? 'Mute' : 'Unmute'}</button>
            <button role="menuitem" onClick={() => { onAudioChange(audioClips.filter(item => item.id !== menuAudio.id)); setLaneMenu(null) }}>Remove</button>
          </>}
        </div>}
      </section>
    </div>
  )
}

// A stacked clip's picture, kept in step with the timeline like the audio previews.
function OverlayVideo({ clip, asset, time, playing, rate }: { clip: OverlayClip; asset?: MediaAsset; time: number; playing: boolean; rate: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const target = clip.startSeconds + (time - clip.timelineStart)
    video.playbackRate = rate
    if (!playing) { video.pause(); if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target; return }
    if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target
    if (video.paused) void video.play().catch(() => {})
  }, [clip, time, playing, rate])
  return <video ref={ref} muted playsInline preload="auto" className="overlay-video" src={asset ? `safe-file://video?path=${encodeURIComponent(asset.metadata.filePath)}` : undefined} />
}
