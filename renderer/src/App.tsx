import React, { useState, useEffect, useCallback, useRef } from 'react'
import brandIcon from '../../resources/icon.png'
import type {
  VideoMetadata, TrimRange, ExportMode, Mp3Bitrate, GifScale, GifFps,
  CompressionLevel, ProgressEvent, CompletionEvent, FFmpegEvent, CropSelection, MediaAsset, AudioClip, OverlayClip, ExportOptions, DownloadProgress
} from '../../shared/types'
import MediaPool from './components/MediaPool'
import { exportPlan } from '../../shared/exportPlan'
import Editor from './components/Editor'
import Inspector from './components/Inspector'
import LinkBox from './components/LinkBox'
import CompressionPresets from './components/CompressionPresets'
import CropPanel from './components/CropPanel'
import ExportPanel from './components/ExportPanel'
import ProgressPanel from './components/ProgressPanel'
import ResultPanel from './components/ResultPanel'
import SettingsModal from './components/SettingsModal'
import Icon from './components/Icon'
import { splitClip, moveClip, moveClips, selectClips, timelineDuration, updateClipRange, remapPlayhead, type TimelineClip } from './lib/clips'
import { formatDuration } from './lib/sizeEstimator'
import { insertAssets, MEDIA_EXTENSIONS, type InsertTarget } from './lib/timeline'
import type { LaneSelectMode } from './components/Lanes'

type Snapshot = { clips: TimelineClip[]; audio: AudioClip[]; overlays: OverlayClip[] }
const TIMELINE_HEIGHT_KEY = 'daxil-timeline-height'

type ExportState = 'idle' | 'running' | 'done' | 'error'
type ThemeName = 'cloud' | 'mint' | 'rose' | 'amber' | 'mist' | 'sage' | 'blush' | 'linen'

const THEME_GROUPS: Array<{ label: string; themes: Array<{ id: ThemeName; label: string }> }> = [
  {
    label: 'Dark',
    themes: [
      { id: 'cloud', label: 'Cloud' },
      { id: 'mint', label: 'Mint' },
      { id: 'rose', label: 'Rose' },
      { id: 'amber', label: 'Amber' }
    ]
  },
  {
    label: 'Light',
    themes: [
      { id: 'mist', label: 'Mist' },
      { id: 'sage', label: 'Sage' },
      { id: 'blush', label: 'Blush' },
      { id: 'linen', label: 'Linen' }
    ]
  }
]

const THEMES = THEME_GROUPS.flatMap((group) => group.themes)

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function defaultCrop(metadata: VideoMetadata, enabled = false): CropSelection {
  const width = Math.max(2, Math.round(metadata.width * 0.8))
  const height = Math.max(2, Math.round(metadata.height * 0.8))
  return {
    enabled,
    x: Math.round((metadata.width - width) / 2),
    y: Math.round((metadata.height - height) / 2),
    width,
    height
  }
}

function clampCrop(crop: CropSelection, metadata: VideoMetadata): CropSelection {
  const width = clamp(Math.round(crop.width || metadata.width), Math.min(metadata.width, 32), Math.max(metadata.width, 2))
  const height = clamp(Math.round(crop.height || metadata.height), Math.min(metadata.height, 32), Math.max(metadata.height, 2))

  return {
    enabled: crop.enabled,
    width,
    height,
    x: Math.round(clamp(crop.x, 0, metadata.width - width)),
    y: Math.round(clamp(crop.y, 0, metadata.height - height))
  }
}

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<string[]>([])

  const [trim, setTrim] = useState<TrimRange>({ enabled: false, startSeconds: 0, endSeconds: 0 })
  const [crop, setCrop] = useState<CropSelection>({ enabled: false, x: 0, y: 0, width: 0, height: 0 })
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [clips, setClips] = useState<TimelineClip[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [audioClips, setAudioClips] = useState<AudioClip[]>([])
  const [overlays, setOverlays] = useState<OverlayClip[]>([])
  const [hiddenTracks, setHiddenTracks] = useState<number[]>([])
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(() => { try { return Number(window.localStorage.getItem(TIMELINE_HEIGHT_KEY)) || 230 } catch { return 230 } })
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const [selectedLaneIds, setSelectedLaneIds] = useState<string[]>([])
  const [fileDrag, setFileDrag] = useState(false)
  const selectionAnchor = useRef<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [clipHistory, setClipHistory] = useState<Snapshot[]>([])
  const [clipFuture, setClipFuture] = useState<Snapshot[]>([])

  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>('none')
  const [exportMode, setExportMode] = useState<ExportMode>('video')
  const [muteAudio, setMuteAudio] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [mp3Bitrate, setMp3Bitrate] = useState<Mp3Bitrate>(192)
  const [gifScale, setGifScale] = useState<GifScale>(480)
  const [gifFps, setGifFps] = useState<GifFps>(12)
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null)
  const [isGeneratingGifPreview, setIsGeneratingGifPreview] = useState(false)
  const [outputDir, setOutputDir] = useState('')

  const [exportState, setExportState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [ffmpegLog, setFfmpegLog] = useState<string[]>([])
  const [result, setResult] = useState<CompletionEvent | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [compressionExpanded, setCompressionExpanded] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => {
    const savedTheme = window.localStorage.getItem('daxil-theme')
    return THEMES.some((item) => item.id === savedTheme) ? savedTheme as ThemeName : 'cloud'
  })
  const [importing, setImporting] = useState(false)
  const measureCancelled = useRef(false)
  const [measuring, setMeasuring] = useState(false)
  const [measurement, setMeasurement] = useState<{ key: string; bytes: number } | null>(null)
  const isBusy = importing || measuring || isGeneratingGifPreview || exportState === 'running' || loadingMeta || downloading
  useEffect(() => { try { window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight)) } catch { /* private mode */ } }, [timelineHeight])
  useEffect(() => window.electronAPI.onDownloadProgress(setDownloadProgress), [])

  useEffect(() => {
    window.localStorage.setItem('daxil-theme', theme)
  }, [theme])

  useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      if (settings.defaultOutputDir) setOutputDir(settings.defaultOutputDir)
    })
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onFFmpegEvent((evt: FFmpegEvent) => {
      if (evt.type === 'progress') {
        setProgress(evt)
        setFfmpegLog((prev) => [...prev.slice(-499), evt.logLine])
      } else if (evt.type === 'complete') {
        setResult(evt)
        setExportState('done')
      } else if (evt.type === 'error') {
        setExportError(evt.message + (evt.raw ? `\n\n${evt.raw}` : ''))
        setExportState('error')
      }
    })
    return unsub
  }, [])

  // keepMedia: the video becomes the project source while the bin keeps everything already imported.
  const handleFilePicked = useCallback(async (fp: string, keepMedia = false) => {
    setFilePath(fp)
    setMetadata(null)
    setMetaError(null)
    setLoadingMeta(true)
    setThumbnails([])
    setExportState('idle')
    setResult(null)
    setProgress(null)
    setFfmpegLog([])
    setExportError(null)
    setVideoCurrentTime(0)
    setClips([])
    if (!keepMedia) setMedia([])
    setAudioClips([])
    setOverlays([])
    setHiddenTracks([])
    setSelectedClipIds([])
    setSelectedLaneIds([])
    setClipHistory([])
    setClipFuture([])
    setCompressionLevel('none')
    setPlaybackRate(1)
    setGifFps(12)

    try {
      const meta = await window.electronAPI.getMetadata(fp)
      setMetadata(meta)
      setTrim({ enabled: false, startSeconds: 0, endSeconds: meta.durationSeconds })
      const asset: MediaAsset = { id: crypto.randomUUID(), kind: 'video', metadata: meta }
      setMedia(items => keepMedia ? [asset, ...items.filter(item => item.metadata.filePath !== fp)] : [asset])
      const initialClip = { id: crypto.randomUUID(), mediaId: asset.id, startSeconds: 0, endSeconds: meta.durationSeconds }
      setClips([initialClip])
      setSelectedClipId(initialClip.id)
      setSelectedClipIds([initialClip.id])
      setCrop(defaultCrop(meta))

      window.electronAPI.getThumbnails(fp, meta.durationSeconds, 16)
        .then(images => { setThumbnails(images); setMedia(items => items.map(item => item.id === asset.id ? { ...item, thumbnail: images[0] } : item)) })
        .catch(() => setThumbnails([]))
    } catch (error: unknown) {
      setMetaError(error instanceof Error ? error.message : 'Failed to read file metadata')
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  const commitClips = useCallback((next: TimelineClip[], audio = audioClips, nextOverlays = overlays) => {
    if (next === clips && audio === audioClips && nextOverlays === overlays) return
    setClipHistory(history => [...history, { clips, audio: audioClips, overlays }])
    setAudioClips(audio)
    setOverlays(nextOverlays)
    setClipFuture([])
    setClips(next)
    setVideoCurrentTime(time => Math.min(time, timelineDuration(next)))
  }, [clips, audioClips, overlays])
  const handleOverlayChange = useCallback((next: OverlayClip[]) => commitClips(clips, audioClips, next), [commitClips, clips, audioClips])
  const handleToggleTrack = (track: number) => setHiddenTracks(tracks => tracks.includes(track) ? tracks.filter(item => item !== track) : [...tracks, track])

  const handleSelect = useCallback((id: string, mode: 'replace' | 'toggle' | 'range' | 'preserve' = 'replace') => {
    setSelectedClipIds(selected => selectClips(clips, selected, id, mode, selectionAnchor.current))
    if (mode === 'replace' || (mode === 'preserve' && !selectedClipIds.includes(id))) setSelectedLaneIds([])
    if (mode !== 'range') selectionAnchor.current = id
    setSelectedClipId(id)
  }, [clips, selectedClipIds])
  const handleSelectLane = useCallback((id: string, mode: LaneSelectMode) => {
    if (mode === 'toggle') { setSelectedLaneIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]); return }
    if (mode === 'add') { setSelectedLaneIds(ids => ids.includes(id) ? ids : [...ids, id]); return }
    if (mode === 'preserve' && selectedLaneIds.includes(id)) return
    setSelectedLaneIds([id]); setSelectedClipIds([]); setSelectedClipId(null)
  }, [selectedLaneIds])
  const handleMarqueeSelect = useCallback((videoIds: string[], audioIds: string[], additive: boolean) => {
    const union = (current: string[], added: string[]) => additive ? [...current, ...added.filter(id => !current.includes(id))] : added
    const nextVideo = union(selectedClipIds, videoIds)
    setSelectedClipIds(nextVideo)
    setSelectedLaneIds(ids => union(ids, audioIds))
    setSelectedClipId(id => id && nextVideo.includes(id) ? id : nextVideo[0] ?? null)
    if (videoIds[0]) selectionAnchor.current = videoIds[0]
  }, [selectedClipIds])
  const handleClearSelection = useCallback(() => {
    setSelectedClipIds([]); setSelectedLaneIds([]); setSelectedClipId(null)
  }, [])
  const handleGroupMove = (ids: string[], boundary: number) => {
    const next = moveClips(clips, ids, boundary)
    commitClips(next)
    setVideoCurrentTime(remapPlayhead(clips, next, videoCurrentTime))
  }
  // Place assets in order as one undoable edit, selecting what was added.
  const insertAssetList = (assets: MediaAsset[], boundary = clips.length, time = videoCurrentTime, target: InsertTarget = 'sequence') => {
    if (!assets.length) return
    if (!metadata) {
      const video = assets.find(asset => asset.kind === 'video')
      if (video) void handleFilePicked(video.metadata.filePath, true)
      else setMetaError('Add a video before placing audio on the timeline.')
      return
    }
    const result = insertAssets(clips, audioClips, overlays, assets, boundary, time, () => crypto.randomUUID(), target)
    if (!result.videoIds.length && !result.audioIds.length && !result.overlayIds.length) return
    commitClips(result.clips, result.audio, result.overlays)
    setSelectedClipIds(result.videoIds); setSelectedLaneIds([...result.overlayIds, ...result.audioIds])
    setSelectedClipId(result.videoIds[0] ?? null)
    if (result.videoIds[0]) selectionAnchor.current = result.videoIds[0]
  }
  const handleInsertMedia = (ids: string[], boundary = clips.length, time = videoCurrentTime, target: InsertTarget = 'sequence') => {
    insertAssetList(ids.map(id => media.find(item => item.id === id)).filter((asset): asset is MediaAsset => Boolean(asset)), boundary, time, target)
  }

  // One import path for the dialog, OS drops and timeline drops. The first video opens
  // the project when none is loaded; everything else lands in the media bin.
  const importPaths = async (paths: string[], placement?: { boundary: number; time: number; target?: InsertTarget }) => {
    const files = [...new Set(paths)].filter(file => MEDIA_EXTENSIONS.test(file))
    if (!files.length) { if (paths.length) setMetaError('Those files are not a supported video or audio format.'); return }
    setImporting(true)
    setMetaError(null)
    const added: MediaAsset[] = []
    const placed: MediaAsset[] = []
    const failed: string[] = []
    let hasVideo = Boolean(metadata)
    let opened = false
    try {
      for (const file of files) {
        const existing = media.find(item => item.metadata.filePath === file)
        if (existing) { placed.push(existing); continue }
        try {
          const meta = await window.electronAPI.getMetadata(file)
          if (meta.durationSeconds < 0.1) throw new Error('no playable media')
          const kind = meta.width > 0 ? 'video' : 'audio'
          if (!hasVideo && kind === 'video') { await handleFilePicked(file, true); hasVideo = true; opened = true; continue }
          const thumbnail = kind === 'video' ? (await window.electronAPI.getThumbnails(file, meta.durationSeconds, 1).catch(() => []))[0] : undefined
          const asset: MediaAsset = { id: crypto.randomUUID(), kind, metadata: meta, thumbnail }
          added.push(asset); placed.push(asset)
        } catch { failed.push(file.split(/[\\/]/).pop() ?? file) }
      }
      setMedia(items => [...items, ...added.filter(asset => !items.some(item => item.metadata.filePath === asset.metadata.filePath))])
      if (placement && !opened) insertAssetList(placed, placement.boundary, placement.time, placement.target)
      if (failed.length) setMetaError(`Couldn't read ${failed.join(', ')}.`)
    } finally { setImporting(false) }
  }
  const importPathsRef = useRef(importPaths)
  importPathsRef.current = importPaths

  const handleImportMedia = async () => {
    if (isBusy) return
    const paths = await window.electronAPI.openMedia()
    if (paths.length) await importPaths(paths)
  }
  const handleImportMediaRef = useRef(handleImportMedia)
  handleImportMediaRef.current = handleImportMedia

  // Paste a link: download with yt-dlp, then it lands at the end of V1 like any import.
  const downloadFromLink = async (url: string) => {
    setDownloadError(null)
    setDownloading(true)
    setDownloadProgress({ phase: 'media', percent: null, message: 'Starting…' })
    try { return await window.electronAPI.downloadLink(url) }
    catch (error) { setDownloadError(error instanceof Error ? error.message : String(error)); return null }
    finally { setDownloading(false); setDownloadProgress(null) }
  }
  const handleLinkAdd = async (url: string) => {
    if (downloading) return
    const result = await downloadFromLink(url)
    if (result) await importPathsRef.current([result.filePath], { boundary: clips.length, time: timelineDuration(clips) })
  }
  // One click to GIF: download, pick a file, encode the whole clip. Nothing touches the timeline.
  const handleLinkGif = async (url: string) => {
    if (downloading || exportState === 'running') return
    const result = await downloadFromLink(url)
    if (!result) return
    try {
      const meta = await window.electronAPI.getMetadata(result.filePath)
      const asset: MediaAsset = { id: crypto.randomUUID(), kind: 'video', metadata: meta, thumbnail: (await window.electronAPI.getThumbnails(result.filePath, meta.durationSeconds, 1).catch(() => []))[0] }
      setMedia(items => items.some(item => item.metadata.filePath === meta.filePath) ? items : [...items, asset])
      if (meta.durationSeconds > 60 && !window.confirm(`This clip is ${formatDuration(meta.durationSeconds)} long, which makes a very large GIF. Continue?`)) return
      const baseName = (result.title || meta.fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'clip'
      const outputPath = await window.electronAPI.saveExportDialog('gif', outputDir ? `${outputDir}/${baseName}.gif` : `${baseName}.gif`)
      if (!outputPath) return
      setExportState('running'); setProgress(null); setFfmpegLog([]); setResult(null); setExportError(null)
      await window.electronAPI.runFFmpeg({
        mode: 'gif', inputPath: meta.filePath, outputDir, outputFileName: baseName, outputPath,
        clips: [{ id: 'link', mediaId: asset.id, startSeconds: 0, endSeconds: meta.durationSeconds }], media: [asset], audioClips: [], overlays: [],
        hasAudio: false, trim: { enabled: false, startSeconds: 0, endSeconds: meta.durationSeconds }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
        compressionLevel: 'none', muteAudio: true, gifScale, gifFps, playbackRate: 1
      })
    } catch (error) {
      setExportError(previous => previous ?? (error instanceof Error ? error.message : String(error)))
      setExportState('error')
    }
  }
  const handleLinkAddRef = useRef(handleLinkAdd)
  handleLinkAddRef.current = handleLinkAdd
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (/^\s*https?:\/\/\S+/i.test(text)) { event.preventDefault(); void handleLinkAddRef.current(text.trim()) }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  const usedMediaIds = new Set([clips, audioClips, overlays, ...clipHistory.flatMap(entry => [entry.clips, entry.audio, entry.overlays]), ...clipFuture.flatMap(entry => [entry.clips, entry.audio, entry.overlays])]
    .flatMap(list => list.map(item => item.mediaId).filter((id): id is string => Boolean(id))))
  for (const asset of media) if (asset.metadata.filePath === filePath) usedMediaIds.add(asset.id)
  const handleRemoveMedia = (ids: string[]) => setMedia(items => items.filter(item => !ids.includes(item.id) || usedMediaIds.has(item.id)))

  // Files dropped anywhere in the window are imported; the timeline handles its own drops
  // so it can also place them. The capture listener always clears the overlay.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'))
    const enter = (event: DragEvent) => { if (hasFiles(event)) { depth++; setFileDrag(true) } }
    const leave = (event: DragEvent) => { if (hasFiles(event) && --depth <= 0) { depth = 0; setFileDrag(false) } }
    const over = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy' } }
    const reset = () => { depth = 0; setFileDrag(false) }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      const paths = Array.from(event.dataTransfer.files, file => window.electronAPI.getPathForFile(file)).filter(Boolean)
      if (paths.length) void importPathsRef.current(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', reset, true)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', reset, true)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const handleSplit = useCallback(() => {
    const newId = crypto.randomUUID()
    const next = splitClip(clips, videoCurrentTime, newId)
    if (!next) return
    commitClips(next)
    handleSelect(newId)
  }, [clips, videoCurrentTime, commitClips, handleSelect])

  const handleInsertClip = useCallback((start: number, end: number) => {
    if (!metadata || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > metadata.durationSeconds || end - start < 0.1) return
    const id = crypto.randomUUID()
    const selectedIndex = clips.findIndex(clip => clip.id === selectedClipId)
    const next = [...clips]
    next.splice(selectedIndex + 1, 0, { id, mediaId: media[0]?.id, startSeconds: start, endSeconds: end })
    commitClips(next)
    handleSelect(id)
  }, [clips, commitClips, metadata, selectedClipId, media, handleSelect])

  const handleRemoveClip = useCallback(() => {
    const next = clips.filter(clip => !selectedClipIds.includes(clip.id))
    const nextAudio = audioClips.filter(clip => !selectedLaneIds.includes(clip.id))
    const nextOverlays = overlays.filter(clip => !selectedLaneIds.includes(clip.id))
    if (next.length === clips.length && nextAudio.length === audioClips.length && nextOverlays.length === overlays.length) return
    commitClips(next.length === clips.length ? clips : next, nextAudio.length === audioClips.length ? audioClips : nextAudio, nextOverlays.length === overlays.length ? overlays : nextOverlays)
    setSelectedClipId(null)
    setSelectedClipIds([])
    setSelectedLaneIds([])
  }, [clips, audioClips, overlays, commitClips, selectedClipIds, selectedLaneIds])

  const handleDuplicate = () => {
    const selected = clips.filter(clip => selectedClipIds.includes(clip.id))
    if (!selected.length) return
    const copies = selected.map(clip => ({ ...clip, id: crypto.randomUUID() }))
    const at = Math.max(...selected.map(clip => clips.indexOf(clip))) + 1
    commitClips([...clips.slice(0, at), ...copies, ...clips.slice(at)])
    setSelectedClipIds(copies.map(clip => clip.id)); setSelectedClipId(copies[0].id)
  }

  const handleMoveClip = useCallback((from: number, to: number) => {
    const next = selectedClipIds.length > 1 ? moveClips(clips, selectedClipIds, to > from ? to + 1 : to) : moveClip(clips, from, to)
    commitClips(next)
    setVideoCurrentTime(remapPlayhead(clips, next, videoCurrentTime))
  }, [clips, commitClips, selectedClipIds, videoCurrentTime])

  const handleEditClip = useCallback((id: string, start: number, end: number) => {
    if (!metadata) return
    const source = media.find(asset => asset.id === clips.find(clip => clip.id === id)?.mediaId)?.metadata ?? metadata
    const next = updateClipRange(clips, id, start, end, source.durationSeconds)
    if (next === clips) return
    commitClips(next)
    setVideoCurrentTime(remapPlayhead(clips, next, videoCurrentTime))
  }, [clips, commitClips, metadata, videoCurrentTime, media])

  const restore = (snapshot: Snapshot) => {
    setClips(snapshot.clips); setAudioClips(snapshot.audio); setOverlays(snapshot.overlays)
    setVideoCurrentTime(time => Math.min(time, timelineDuration(snapshot.clips)))
    setSelectedClipIds(ids => { const retained = ids.filter(id => snapshot.clips.some(clip => clip.id === id)); return retained.length ? retained : snapshot.clips[0] ? [snapshot.clips[0].id] : [] })
    setSelectedClipId(id => snapshot.clips.some(clip => clip.id === id) ? id : snapshot.clips[0]?.id ?? null)
    setSelectedLaneIds(ids => ids.filter(id => snapshot.audio.some(clip => clip.id === id) || snapshot.overlays.some(clip => clip.id === id)))
  }
  const handleUndo = useCallback(() => {
    if (!clipHistory.length) return
    setClipFuture(future => [{ clips, audio: audioClips, overlays }, ...future])
    restore(clipHistory[clipHistory.length - 1]); setClipHistory(clipHistory.slice(0, -1))
  }, [clipHistory, clips, audioClips, overlays])
  const handleRedo = useCallback(() => {
    if (!clipFuture.length) return
    setClipHistory(history => [...history, { clips, audio: audioClips, overlays }])
    restore(clipFuture[0]); setClipFuture(clipFuture.slice(1))
  }, [clipFuture, clips, audioClips, overlays])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); setSelectedClipIds(clips.map(clip => clip.id)); setSelectedLaneIds([...overlays, ...audioClips].map(clip => clip.id))
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault(); void handleImportMediaRef.current()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        handleRedo()
      } else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSplit()
      } else if (!event.ctrlKey && !event.metaKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault()
        handleRemoveClip()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleRedo, handleSplit, handleUndo, handleRemoveClip, clips, audioClips, overlays])

  const handleCropChange = useCallback((nextCrop: CropSelection) => {
    setCrop(() => metadata ? clampCrop(nextCrop, metadata) : nextCrop)
  }, [metadata])

  const handleOpenNewWindow = useCallback(() => {
    void window.electronAPI.openNewWindow()
  }, [])

  const exportOptions: ExportOptions = { mode: exportMode, inputPath: filePath ?? '', outputDir, outputFileName: 'export', clips, media, audioClips, overlays, hiddenTracks, hasAudio: metadata?.audioCodec !== 'none', trim, crop, compressionLevel, muteAudio, mp3Bitrate, gifScale, gifFps, playbackRate }
  const estimateKey = JSON.stringify(exportOptions)
  const measuredSize = measurement?.key === estimateKey ? measurement.bytes : null
  const estimatedSize = metadata ? exportPlan(exportOptions, metadata).targetBytes : null
  const handleMeasure = async () => {
    measureCancelled.current = false
    setMeasuring(true)
    try { setMeasurement({ key: estimateKey, bytes: await window.electronAPI.measureExport(exportOptions) }) }
    catch (error) { if (!measureCancelled.current) { setExportError(error instanceof Error ? error.message : String(error)); setExportState('error') } }
    finally { setMeasuring(false) }
  }

  const handleExport = useCallback(async () => {
    if (!metadata || !filePath || clips.length === 0) return

    const baseName = metadata.fileName.replace(/\.[^.]+$/, '')
    const speedSuffix = playbackRate !== 1 ? `_${playbackRate}x` : ''
    const videoModifiers = [
      muteAudio ? 'muted' : null,
      compressionLevel !== 'none' ? `${compressionLevel}pct` : null,
      trim.enabled ? 'trimmed' : null,
      crop.enabled ? 'cropped' : null
    ].filter(Boolean)

    const suffix =
      exportMode === 'audio' ? `_audio${speedSuffix}` :
        exportMode === 'gif' ? `_animated${crop.enabled ? '_cropped' : ''}${speedSuffix}` :
          videoModifiers.length > 0 ? `_${videoModifiers.join('_')}${speedSuffix}` : `_export${speedSuffix}`

    const outputFileName = `${baseName}${suffix}`

    try {
      const ext = exportMode === 'audio' ? '.mp3' : exportMode === 'gif' ? '.gif' : '.mp4'
      const defaultPath = outputDir ? `${outputDir}/${outputFileName}${ext}` : `${outputFileName}${ext}`
      const outputPath = await window.electronAPI.saveExportDialog(exportMode, defaultPath)
      if (!outputPath) return
      setExportState('running')
      setProgress(null)
      setFfmpegLog([])
      setResult(null)
      setExportError(null)
      await window.electronAPI.runFFmpeg({
        mode: exportMode,
        inputPath: filePath,
        outputDir,
        outputFileName,
        outputPath,
        clips, media, audioClips, overlays, hiddenTracks,
        hasAudio: metadata.audioCodec !== 'none',
        trim,
        crop,
        compressionLevel,
        muteAudio,
        mp3Bitrate,
        gifScale,
        gifFps,
        playbackRate
      })
    } catch (error) {
      setExportError(previous => previous ?? (error instanceof Error ? error.message : String(error)))
      setExportState('error')
    }
  }, [metadata, filePath, outputDir, exportMode, muteAudio, compressionLevel, trim, crop, mp3Bitrate, gifScale, gifFps, playbackRate, clips, media, audioClips, overlays, hiddenTracks])

  const handleCancel = useCallback(() => {
    window.electronAPI.cancelFFmpeg()
    setExportState('idle')
  }, [])

  const handleReset = useCallback(() => {
    setExportState('idle')
    setResult(null)
    setProgress(null)
    setFfmpegLog([])
    setExportError(null)
  }, [])

  const handleGifPreview = useCallback(async () => {
    if (!metadata || !filePath) return
    setIsGeneratingGifPreview(true)
    try {
      const url = await window.electronAPI.previewGif({
        mode: 'gif',
        inputPath: filePath,
        outputDir: '',
        outputFileName: 'preview',
        clips, media, audioClips, overlays, hiddenTracks,
        hasAudio: metadata.audioCodec !== 'none',
        trim,
        crop,
        compressionLevel: 'none',
        muteAudio: false,
        gifScale,
        gifFps,
        playbackRate
      })
      setGifPreviewUrl(url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error)); setExportState('error')
    } finally {
      setIsGeneratingGifPreview(false)
    }
  }, [metadata, filePath, trim, crop, gifScale, gifFps, playbackRate, clips, media, audioClips, overlays, hiddenTracks])

  const compressionLabel = compressionLevel === 'none' ? 'High quality' : `${compressionLevel}% target reduction`
  const timelineEnd = timelineDuration(clips)
  const selectedAsset = (() => {
    const lane = [...overlays, ...audioClips].find(clip => selectedLaneIds.includes(clip.id))
    const mediaId = lane?.mediaId ?? clips.find(clip => clip.id === selectedClipId)?.mediaId
    return media.find(asset => asset.id === mediaId) ?? null
  })()
  const selectedOverlay = overlays.find(clip => selectedLaneIds.includes(clip.id)) ?? null

  const mediaPanel = <>
    <LinkBox busy={downloading || exportState === 'running'} progress={downloadProgress} error={downloadError}
      onAdd={url => void handleLinkAdd(url)} onGif={url => void handleLinkGif(url)} onCancel={() => void window.electronAPI.cancelDownload()} />
    <MediaPool media={media} inUse={usedMediaIds} onImport={handleImportMedia} onInsert={ids => handleInsertMedia(ids)} onRemove={handleRemoveMedia} busy={isBusy} />
    {loadingMeta && <div className="surface-note panel-note">Reading file metadata and building thumbnails…</div>}
    {metaError && <div className="panel-note panel-note-error" role="alert">{metaError}<button className="icon-button" onClick={() => setMetaError(null)} aria-label="Dismiss"><Icon name="x" size={12} /></button></div>}
  </>

  const inspector = <Inspector
    source={metadata}
    selectedAsset={selectedAsset}
    selectedOverlay={selectedOverlay}
    onOverlayChange={next => handleOverlayChange(overlays.map(item => item.id === next.id ? next : item))}
    crop={metadata && <CropPanel metadata={metadata} crop={crop} onCropChange={handleCropChange} />}
    compression={metadata && <>
      <div className="surface-note" style={{ marginBottom: 8 }}>{compressionLabel}</div>
      <CompressionPresets metadata={metadata} options={exportOptions} selected={compressionLevel} onChange={setCompressionLevel} />
    </>}
    deliver={<>
      <ExportPanel
        mode={exportMode}
        muteAudio={muteAudio}
        mp3Bitrate={mp3Bitrate}
        gifScale={gifScale}
        gifFps={gifFps}
        estimatedSizeBytes={measuredSize ?? estimatedSize}
        measured={measuredSize !== null}
        onMeasure={handleMeasure}
        onCancelMeasure={() => { measureCancelled.current = true; void window.electronAPI.cancelFFmpeg() }}
        measuring={measuring}
        outputDir={outputDir}
        onModeChange={setExportMode}
        onMuteAudioChange={setMuteAudio}
        onMp3BitrateChange={setMp3Bitrate}
        onGifScaleChange={setGifScale}
        onGifFpsChange={setGifFps}
        onOutputDirChange={setOutputDir}
        onExport={handleExport}
        onPreviewGif={handleGifPreview}
        isGeneratingGifPreview={isGeneratingGifPreview}
        exporting={exportState === 'running'}
        disabled={!metadata || clips.length === 0 || measuring || isGeneratingGifPreview}
      />
      {exportState === 'running' && (
        <ProgressPanel progress={progress} logLines={ffmpegLog} onCancel={handleCancel} exporting={true} />
      )}
      {exportState === 'done' && result && (
        <ResultPanel result={result} onOpenFolder={() => window.electronAPI.openFolder(result.outputPath)} onReset={handleReset} />
      )}
      {exportState === 'error' && exportError && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="section-title" style={{ marginBottom: 6, color: 'var(--danger)' }}>Export error</div>
          <pre className="mono-block" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{exportError}</pre>
          <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 10 }}>Dismiss</button>
        </div>
      )}
    </>}
  />

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="app-header">
        <div className="brand-lockup">
          <img src={brandIcon} alt="" className="brand-icon" />
          <div className="brand-copy">
            <div className="brand-wordmark">DAXIL</div>
            <div className="brand-subtitle">{metadata ? metadata.fileName : 'Trim, stack, compress and export local video.'}</div>
          </div>
        </div>

        <div className="app-actions">
          <label className="theme-picker" aria-label="Theme">
            <span>Theme</span>
            <select className="theme-select" value={theme} onChange={(event) => setTheme(event.target.value as ThemeName)}>
              {THEME_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="icon-button" onClick={handleOpenNewWindow} aria-label="New window" title="New window"><Icon name="window" /></button>
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings"><Icon name="settings" /></button>
        </div>
      </header>

      <Editor
        filePath={filePath}
        duration={timelineEnd}
        sourceDuration={metadata?.durationSeconds ?? 0}
        fps={metadata?.fps ?? 30}
        thumbnails={thumbnails}
        videoWidth={metadata?.width ?? 0}
        videoHeight={metadata?.height ?? 0}
        crop={crop}
        currentTime={videoCurrentTime}
        playbackRate={playbackRate}
        clips={clips}
        selectedClipId={selectedClipId}
        selectedClipIds={selectedClipIds}
        selectedLaneIds={selectedLaneIds}
        media={media}
        audioClips={audioClips}
        overlays={overlays}
        hiddenTracks={hiddenTracks}
        muteAudio={muteAudio}
        onAudioChange={next => commitClips(clips, next)}
        onOverlayChange={handleOverlayChange}
        onToggleTrack={handleToggleTrack}
        onInsertMedia={handleInsertMedia}
        onDropFiles={(paths, boundary, time, target) => void importPaths(paths, { boundary, time, target })}
        onSelectLane={handleSelectLane}
        onMarqueeSelect={handleMarqueeSelect}
        onClearSelection={handleClearSelection}
        onGroupMove={handleGroupMove}
        onSelectClip={handleSelect}
        onInsertClip={handleInsertClip}
        onRemoveClip={handleRemoveClip}
        onDuplicate={handleDuplicate}
        onMoveClip={handleMoveClip}
        onEditClip={handleEditClip}
        onSplit={handleSplit}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={clipHistory.length > 0}
        canRedo={clipFuture.length > 0}
        onTimeUpdate={setVideoCurrentTime}
        onCropChange={handleCropChange}
        onPlaybackRateChange={setPlaybackRate}
        onImport={handleImportMedia}
        mediaPanel={mediaPanel}
        inspector={inspector}
        timelineHeight={timelineHeight}
        onTimelineHeightChange={setTimelineHeight}
      />

      {fileDrag && (
        <div className="file-drop-overlay" aria-hidden="true">
          <div><Icon name="plus" size={22} /><span>Drop to add media</span></div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {gifPreviewUrl && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,16,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setGifPreviewUrl(null)}
        >
          <div className="card" style={{ maxWidth: 360, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-title">GIF Preview</div>
              <button className="icon-button" onClick={() => setGifPreviewUrl(null)} aria-label="Close preview"><Icon name="x" /></button>
            </div>
            <img src={gifPreviewUrl} alt="GIF preview" style={{ maxWidth: '100%', borderRadius: 'var(--radius-sm)', display: 'block' }} />
            <div className="surface-note" style={{ marginTop: 10 }}>Preview at 320px wide.</div>
          </div>
        </div>
      )}
    </div>
  )
}
