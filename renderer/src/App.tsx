import React, { useState, useEffect, useCallback, useRef } from 'react'
import brandIcon from '../../resources/icon.png'
import type {
  VideoMetadata, ExportMode, Mp3Bitrate, GifScale, GifFps,
  CompressionLevel, ProgressEvent, CompletionEvent, FFmpegEvent, CropSelection, MediaAsset, Clip, Project, ExportOptions, DownloadProgress
} from '../../shared/types'
import MediaPool from './components/MediaPool'
import { exportPlan, sliceTimeline, soundOnly } from '../../shared/exportPlan'
import Editor, { type SelectMode } from './components/Editor'
import Inspector from './components/Inspector'
import ClipProperties from './components/ClipProperties'
import LinkModal from './components/LinkModal'
import LinkBox from './components/LinkBox'
import CompressionPresets from './components/CompressionPresets'
import ExportPanel from './components/ExportPanel'
import ProgressPanel from './components/ProgressPanel'
import ResultPanel from './components/ResultPanel'
import SettingsModal from './components/SettingsModal'
import PreviewModal, { type VideoPreview } from './components/PreviewModal'
import Icon from './components/Icon'
import { clipFromAsset, clipLength, compactTracks, DEFAULT_TEXT_SECONDS, freeTrack, insertAssets, pasteClips, removeMedia, selectClips, splitAt, textClip, timelineEnd, toggleTrack, trackCount, type Placement } from './lib/edit'
import { renderTextImages } from './lib/text'
import { MEDIA_EXTENSIONS } from './lib/timeline'
import { formatDuration } from './lib/sizeEstimator'
import { assetName, canPreviewVideo } from './lib/media'
import { useUpdateStatus } from './lib/updates'

type ExportState = 'idle' | 'running' | 'done' | 'error'
type ThemeName = 'cloud' | 'mint' | 'rose' | 'amber' | 'mist' | 'sage' | 'blush' | 'linen'
type Snapshot = { clips: Clip[]; media: MediaAsset[] }
const TIMELINE_HEIGHT_KEY = 'daxil-timeline-height'

const THEME_GROUPS: Array<{ label: string; themes: Array<{ id: ThemeName; label: string }> }> = [
  { label: 'Dark', themes: [{ id: 'cloud', label: 'Cloud' }, { id: 'mint', label: 'Mint' }, { id: 'rose', label: 'Rose' }, { id: 'amber', label: 'Amber' }] },
  { label: 'Light', themes: [{ id: 'mist', label: 'Mist' }, { id: 'sage', label: 'Sage' }, { id: 'blush', label: 'Blush' }, { id: 'linen', label: 'Linen' }] }
]
const THEMES = THEME_GROUPS.flatMap(group => group.themes)

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function defaultCrop(project: Project, enabled = false): CropSelection {
  const width = Math.max(2, Math.round(project.width * 0.8))
  const height = Math.max(2, Math.round(project.height * 0.8))
  return { enabled, x: Math.round((project.width - width) / 2), y: Math.round((project.height - height) / 2), width, height }
}

function clampCrop(crop: CropSelection, project: Project): CropSelection {
  const width = clamp(Math.round(crop.width || project.width), Math.min(project.width, 32), Math.max(project.width, 2))
  const height = clamp(Math.round(crop.height || project.height), Math.min(project.height, 32), Math.max(project.height, 2))
  return { enabled: crop.enabled, width, height, x: Math.round(clamp(crop.x, 0, project.width - width)), y: Math.round(clamp(crop.y, 0, project.height - height)) }
}

const projectMetadata = (project: Project, source: MediaAsset | undefined): VideoMetadata => source?.metadata ?? {
  filePath: '', fileName: 'Project', durationSeconds: 0, width: project.width, height: project.height, format: 'mp4', videoCodec: 'h264', audioCodec: 'none', videoBitrate: 0, audioBitrate: 0, totalBitrate: 0, fileSizeBytes: 0, fps: project.fps
}

const PREVIEW_SECONDS = 5
// A project started from sound alone gets a standard frame; the canvas menu can change it.
const AUDIO_PROJECT: Project = { width: 1920, height: 1080, fps: 30 }
const CLIPBOARD_TAG = 'daxil-clips:'

export default function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectionAnchor = useRef<string | null>(null)
  const [hiddenVideoTracks, setHiddenVideoTracks] = useState<number[]>([])
  const [mutedAudioTracks, setMutedAudioTracks] = useState<number[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [crop, setCrop] = useState<CropSelection>({ enabled: false, x: 0, y: 0, width: 0, height: 0 })
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>('none')
  const [exportMode, setExportMode] = useState<ExportMode>('video')
  const [muteAudio, setMuteAudio] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [mp3Bitrate, setMp3Bitrate] = useState<Mp3Bitrate>(192)
  const [gifScale, setGifScale] = useState<GifScale>(480)
  const [gifFps, setGifFps] = useState<GifFps>(12)
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null)
  const [isGeneratingGifPreview, setIsGeneratingGifPreview] = useState(false)
  const [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null)
  const [isGeneratingVideoPreview, setIsGeneratingVideoPreview] = useState(false)
  const [outputDir, setOutputDir] = useState('')

  const [exportState, setExportState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [ffmpegLog, setFfmpegLog] = useState<string[]>([])
  const [result, setResult] = useState<CompletionEvent | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const update = useUpdateStatus()
  const updateWaiting = update && (update.state === 'ready' || (update.state === 'available' && update.mode !== 'dev'))
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = window.localStorage.getItem('daxil-theme')
    return THEMES.some(item => item.id === saved) ? saved as ThemeName : 'cloud'
  })
  const [importing, setImporting] = useState(false)
  const [fileDrag, setFileDrag] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(() => { try { return Number(window.localStorage.getItem(TIMELINE_HEIGHT_KEY)) || 250 } catch { return 250 } })
  const clipboard = useRef<{ tag: string; marked: boolean; clips: Clip[]; media: MediaAsset[] } | null>(null)
  const measureCancelled = useRef(false)
  const [measuring, setMeasuring] = useState(false)
  const [measurement, setMeasurement] = useState<{ key: string; bytes: number } | null>(null)
  const isBusy = importing || measuring || isGeneratingGifPreview || isGeneratingVideoPreview || exportState === 'running' || loadingMeta || downloading

  useEffect(() => { window.localStorage.setItem('daxil-theme', theme) }, [theme])
  useEffect(() => { try { window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight)) } catch { /* private mode */ } }, [timelineHeight])
  useEffect(() => window.electronAPI.onDownloadProgress(setDownloadProgress), [])
  useEffect(() => {
    window.electronAPI.getSettings().then(settings => { if (settings.defaultOutputDir) setOutputDir(settings.defaultOutputDir) })
  }, [])
  useEffect(() => {
    const unsub = window.electronAPI.onFFmpegEvent((evt: FFmpegEvent) => {
      if (evt.type === 'progress') { setProgress(evt); setFfmpegLog(prev => [...prev.slice(-499), evt.logLine]) }
      else if (evt.type === 'complete') { setResult(evt); setExportState('done') }
      else if (evt.type === 'error') { setExportError(evt.message + (evt.raw ? `\n\n${evt.raw}` : '')); setExportState('error') }
    })
    return unsub
  }, [])

  // ---------- history ----------
  const commit = useCallback((proposed: Clip[], nextMedia = media) => {
    if (proposed === clips && nextMedia === media) return
    // Tracks never keep empty rows below used ones, so clips can't leapfrog their way upward forever.
    const { clips: nextClips, remap } = compactTracks(proposed)
    if (nextClips !== proposed) {
      const follow = (kind: Clip['kind']) => (list: number[]) => [...new Set(list.map(track => remap(kind, track)))]
      setHiddenVideoTracks(follow('video'))
      setMutedAudioTracks(follow('audio'))
    }
    setHistory(items => [...items, { clips, media }])
    setFuture([])
    setClips(nextClips)
    if (nextMedia !== media) setMedia(nextMedia)
    setVideoCurrentTime(time => Math.min(time, Math.max(0, timelineEnd(nextClips))))
  }, [clips, media])
  const restore = (snapshot: Snapshot) => {
    setClips(snapshot.clips); setMedia(snapshot.media)
    setVideoCurrentTime(time => Math.min(time, Math.max(0, timelineEnd(snapshot.clips))))
    setSelectedIds(ids => ids.filter(id => snapshot.clips.some(clip => clip.id === id)))
  }
  const handleUndo = useCallback(() => {
    if (!history.length) return
    setFuture(items => [{ clips, media }, ...items])
    restore(history[history.length - 1]); setHistory(history.slice(0, -1))
  }, [history, clips, media])
  const handleRedo = useCallback(() => {
    if (!future.length) return
    setHistory(items => [...items, { clips, media }])
    restore(future[0]); setFuture(future.slice(1))
  }, [future, clips, media])

  // ---------- selection ----------
  const handleSelect = useCallback((id: string, mode: SelectMode = 'replace') => {
    setSelectedIds(selected => selectClips(clips, selected, id, mode, selectionAnchor.current))
    if (mode !== 'range') selectionAnchor.current = id
  }, [clips])
  const handleMarqueeSelect = useCallback((ids: string[], additive: boolean) => {
    setSelectedIds(current => additive ? [...current, ...ids.filter(id => !current.includes(id))] : ids)
    if (ids[0]) selectionAnchor.current = ids[0]
  }, [])
  const handleClearSelection = useCallback(() => setSelectedIds([]), [])

  // ---------- project & import ----------
  const startProject = useCallback((meta: VideoMetadata | null) => {
    const next = meta ? { width: meta.width, height: meta.height, fps: meta.fps || 30 } : AUDIO_PROJECT
    setProject(next)
    setCrop(defaultCrop(next))
    setExportState('idle'); setResult(null); setProgress(null); setFfmpegLog([]); setExportError(null)
    return next
  }, [])

  // One import path for the dialog, OS drops, timeline drops and links. The first video sets
  // the project frame; everything lands in the pool, and optionally on the timeline.
  // Preview copies for sources Chromium can't show, keyed by original path. Kept outside undo history
  // because they're a property of the file, not of the edit.
  const [previewPaths, setPreviewPaths] = useState<Record<string, string>>({})
  const [preparing, setPreparing] = useState<string[]>([])
  const ensurePreviews = async (assets: MediaAsset[]) => {
    for (const asset of assets) {
      const file = asset.metadata.filePath
      if (asset.kind !== 'video' || await canPreviewVideo(file)) continue
      // A dev session started before an update has the old preload until it restarts.
      if (typeof window.electronAPI.makePreviewProxy !== 'function') { setMetaError(`${assetName(asset)} can't play in the preview yet. Restart DAXIL to finish updating; export still works.`); continue }
      setPreparing(list => [...list, assetName(asset)])
      try {
        const proxy = await window.electronAPI.makePreviewProxy(file)
        setPreviewPaths(map => ({ ...map, [file]: proxy }))
      } catch (error) { setMetaError(`${assetName(asset)} imported, but its preview couldn't be prepared. It will still export. ${error instanceof Error ? error.message : ''}`) }
      finally { setPreparing(list => list.filter(name => name !== assetName(asset))) }
    }
  }
  const importPaths = async (paths: string[], placement?: Placement, labels: Record<string, string> = {}, temporary: string[] = []) => {
    const files = [...new Set(paths)].filter(file => MEDIA_EXTENSIONS.test(file))
    if (!files.length) { if (paths.length) setMetaError('Those files are not a supported video or audio format.'); return [] }
    setImporting(true)
    setLoadingMeta(true)
    setMetaError(null)
    const added: MediaAsset[] = []
    const placed: MediaAsset[] = []
    const failed: string[] = []
    let currentProject = project
    try {
      for (const file of files) {
        const existing = media.find(item => item.metadata.filePath === file)
        if (existing) { placed.push(existing); continue }
        try {
          const meta = await window.electronAPI.getMetadata(file)
          if (meta.durationSeconds < 0.1) throw new Error('no playable media')
          const kind = meta.width > 0 ? 'video' : 'audio'
          const thumbnail = kind === 'video' ? (await window.electronAPI.getThumbnails(file, meta.durationSeconds, 1).catch(() => []))[0] : undefined
          const asset: MediaAsset = { id: crypto.randomUUID(), kind, metadata: meta, thumbnail, name: labels[file], ...(temporary.includes(file) ? { temporary: true } : {}) }
          if (!currentProject && kind === 'video') currentProject = startProject(meta)
          added.push(asset); placed.push(asset)
        } catch { failed.push(file.split(/[\\/]/).pop() ?? file) }
      }
      const nextMedia = [...media, ...added.filter(asset => !media.some(item => item.metadata.filePath === asset.metadata.filePath))]
      // Sound on its own still makes a project, so music can be cut and exported as MP3.
      if (!currentProject && placed.length) currentProject = startProject(null)
      // The very first video (or, with no video, the first sound) goes straight onto the timeline so there is something to play.
      const firstKind = placed.some(asset => asset.kind === 'video') ? 'video' as const : 'audio' as const
      const autoPlace = !placement && clips.length === 0 && currentProject && placed.length ? { kind: firstKind, track: 0, time: 0 } : placement
      if (autoPlace && currentProject) {
        const assets = autoPlace === placement ? placed : placed.filter(asset => asset.kind === firstKind).slice(0, 1)
        const result = insertAssets(clips, assets, autoPlace, () => crypto.randomUUID())
        commit(result.clips, nextMedia)
        setSelectedIds(result.ids)
      } else if (nextMedia !== media) commit(clips, nextMedia)
      if (failed.length) setMetaError(`Couldn't read ${failed.join(', ')}.`)
      void ensurePreviews(added)
      return placed
    } finally { setImporting(false); setLoadingMeta(false) }
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

  const handleInsertMedia = (ids: string[], placement?: Placement) => {
    const assets = ids.map(id => media.find(item => item.id === id)).filter((asset): asset is MediaAsset => Boolean(asset))
    if (!assets.length) return
    let currentProject = project
    if (!currentProject) currentProject = startProject(assets.find(asset => asset.kind === 'video')?.metadata ?? null)
    const target = placement ?? { kind: assets[0].kind, track: 0, time: timelineEnd(clips) }
    const result = insertAssets(clips, assets, target, () => crypto.randomUUID())
    commit(result.clips)
    setSelectedIds(result.ids)
    if (result.ids[0]) selectionAnchor.current = result.ids[0]
  }

  const usage: Record<string, number> = {}
  for (const clip of clips) usage[clip.mediaId] = (usage[clip.mediaId] ?? 0) + 1
  const handleRemoveMedia = (ids: string[]) => {
    const assets = media.filter(asset => ids.includes(asset.id))
    if (!assets.length) return
    const used = clips.filter(clip => ids.includes(clip.mediaId)).length
    if (used > 0) {
      const names = assets.length === 1 ? assetName(assets[0]) : `${assets.length} items`
      if (!window.confirm(`Remove ${names} and the ${used} clip${used === 1 ? '' : 's'} that use${used === 1 ? 's' : ''} it from the timeline?`)) return
    }
    commit(removeMedia(clips, ids), media.filter(asset => !ids.includes(asset.id)))
    setSelectedIds(selected => selected.filter(id => !clips.some(clip => clip.id === id && ids.includes(clip.mediaId))))
    forgetDownloads(assets)
  }
  // Link downloads are temporary: once they leave the project their files are deleted, and they're
  // scrubbed from undo history so undo can't bring back a clip whose file is gone.
  const forgetDownloads = (assets: MediaAsset[]) => {
    const downloads = assets.filter(asset => asset.temporary)
    if (!downloads.length) return
    const ids = downloads.map(asset => asset.id)
    const strip = (snapshot: Snapshot): Snapshot => ({ clips: removeMedia(snapshot.clips, ids), media: snapshot.media.filter(asset => !ids.includes(asset.id)) })
    setHistory(items => items.map(strip))
    setFuture(items => items.map(strip))
    // Give the preview a moment to release the files before deleting them.
    setTimeout(() => { void window.electronAPI.discardDownloads(downloads.map(asset => asset.metadata.filePath)) }, 250)
  }
  const downloadedMedia = media.filter(asset => asset.temporary)
  const handleDeleteDownloads = () => {
    const ids = downloadedMedia.map(asset => asset.id)
    setClips(items => removeMedia(items, ids))
    setMedia(items => items.filter(asset => !ids.includes(asset.id)))
    setSelectedIds(selected => selected.filter(id => !clips.some(clip => clip.id === id && ids.includes(clip.mediaId))))
    forgetDownloads(downloadedMedia)
  }
  const handleRenameMedia = (id: string, name: string) => commit(clips, media.map(asset => asset.id === id ? { ...asset, name } : asset))

  // Files dropped anywhere in the window are imported; the timeline handles its own drops so it can place them.
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
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('dragover', over)
    window.addEventListener('drop', reset, true); window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over)
      window.removeEventListener('drop', reset, true); window.removeEventListener('drop', drop)
    }
  }, [])

  // ---------- links ----------
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
    if (result) await importPathsRef.current([result.filePath], { kind: 'video', track: 0, time: timelineEnd(clips) }, { [result.filePath]: result.title }, [result.filePath])
  }
  // One click to GIF: download, pick a file, encode the whole clip. Nothing touches the timeline.
  // Convert a link straight to a file: download, pick where to save, encode the whole clip.
  // Nothing touches the timeline. Sound-only links always become MP3.
  const handleLinkConvert = async (url: string, requested: ExportMode) => {
    if (downloading || exportState === 'running') return
    const result = await downloadFromLink(url)
    if (!result) return
    try {
      const meta = await window.electronAPI.getMetadata(result.filePath)
      const hasVideo = meta.width > 0
      const mode: ExportMode = hasVideo ? requested : 'audio'
      const asset: MediaAsset = { id: crypto.randomUUID(), kind: hasVideo ? 'video' : 'audio', metadata: meta, thumbnail: (await window.electronAPI.getThumbnails(result.filePath, meta.durationSeconds, 1).catch(() => []))[0], name: result.title, temporary: true }
      setMedia(items => items.some(item => item.metadata.filePath === meta.filePath) ? items : [...items, asset])
      if (mode === 'gif' && meta.durationSeconds > 60 && !window.confirm(`This clip is ${formatDuration(meta.durationSeconds)} long, which makes a very large GIF. Continue?`)) return
      const baseName = (result.title || meta.fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'clip'
      const ext = mode === 'audio' ? 'mp3' : mode === 'gif' ? 'gif' : 'mp4'
      const outputPath = await window.electronAPI.convertOutputPath(mode, baseName)
      setExportState('running'); setProgress(null); setFfmpegLog([]); setResult(null); setExportError(null)
      const sound = meta.audioCodec !== 'none'
      await window.electronAPI.runFFmpeg({
        mode, inputPath: meta.filePath, outputDir, outputFileName: baseName, outputPath,
        clips: [clipFromAsset(asset, 0, 0, 'link')], media: [asset], project: hasVideo ? { width: meta.width, height: meta.height, fps: meta.fps || 30 } : AUDIO_PROJECT,
        hasAudio: sound, trim: { enabled: false, startSeconds: 0, endSeconds: meta.durationSeconds }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
        compressionLevel: 'none', muteAudio: mode === 'gif' || !sound, mp3Bitrate, gifScale, gifFps, playbackRate: 1
      })
    } catch (error) {
      setExportError(previous => previous ?? (error instanceof Error ? error.message : String(error)))
      setExportState('error')
    }
  }
  // Every link (pasted anywhere or typed in the link box) asks first: edit it or just convert it.
  const requestLink = (url: string) => { if (!downloading && exportState !== 'running') setPendingLink(url.trim()) }
  const handleLinkAddRef = useRef(requestLink)
  handleLinkAddRef.current = requestLink
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

  // ---------- clip edits ----------
  const handleSplit = useCallback(() => {
    const ids: string[] = []
    const next = splitAt(clips, videoCurrentTime, selectedIds.length ? selectedIds : null, () => { const id = crypto.randomUUID(); ids.push(id); return id })
    if (next === clips) return
    commit(next)
    if (ids.length) setSelectedIds(ids)
  }, [clips, videoCurrentTime, selectedIds, commit])
  const handleRemoveSelected = useCallback(() => {
    const next = clips.filter(clip => !selectedIds.includes(clip.id))
    if (next.length === clips.length) return
    commit(next)
    setSelectedIds([])
  }, [clips, selectedIds, commit])
  const handleDuplicate = () => {
    const selected = clips.filter(clip => selectedIds.includes(clip.id))
    if (!selected.length) return
    const copies = selected.map(clip => ({ ...clip, id: crypto.randomUUID(), timelineStart: clip.timelineStart + clipLength(clip) }))
    commit([...clips, ...copies])
    setSelectedIds(copies.map(clip => clip.id))
  }
  const handleClipsChange = useCallback((next: Clip[]) => commit(next), [commit])
  // New text goes at the playhead on the lowest text track with room for it.
  const handleAddText = () => {
    if (!project) return
    const time = videoCurrentTime >= timelineEnd(clips) - 0.05 && clips.length ? Math.max(0, timelineEnd(clips) - DEFAULT_TEXT_SECONDS) : videoCurrentTime
    const clip = textClip(freeTrack(clips, 'text', time, DEFAULT_TEXT_SECONDS), time, crypto.randomUUID())
    commit([...clips, clip])
    setSelectedIds([clip.id])
    selectionAnchor.current = clip.id
  }

  // ---------- copy & paste ----------
  // Copied clips stay in memory; the system clipboard gets a marker so a link copied
  // afterwards still wins when pasting.
  const handleCopy = (cut = false) => {
    const selected = clips.filter(clip => selectedIds.includes(clip.id))
    if (!selected.length) return
    const tag = CLIPBOARD_TAG + crypto.randomUUID()
    const copied = { tag, marked: false, clips: selected, media: media.filter(asset => selected.some(clip => clip.mediaId === asset.id)) }
    clipboard.current = copied
    void navigator.clipboard?.writeText(tag).then(() => { copied.marked = true }, () => {})
    if (cut) handleRemoveSelected()
  }
  const handlePaste = () => {
    const copied = clipboard.current
    if (!copied || !project) return
    // Clips whose media was removed from the pool since copying come back with it.
    const missing = copied.media.filter(asset => !media.some(item => item.id === asset.id))
    const result = pasteClips(clips, copied.clips, videoCurrentTime, () => crypto.randomUUID())
    commit(result.clips, missing.length ? [...media, ...missing] : media)
    setSelectedIds(result.ids)
    if (result.ids[0]) selectionAnchor.current = result.ids[0]
  }
  const handlePasteKey = () => {
    const copied = clipboard.current
    if (!copied) return false
    // Without our marker on the system clipboard we can't tell what was copied last, so clips win.
    if (!copied.marked || !navigator.clipboard) { handlePaste(); return true }
    void navigator.clipboard.readText().then(text => {
      if (text !== copied.tag && /^\s*https?:\/\/\S+/i.test(text)) void handleLinkAddRef.current(text.trim())
      else handlePaste()
    }, () => handlePaste())
    return true
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'a') { event.preventDefault(); setSelectedIds(clips.map(clip => clip.id)) }
      else if ((event.ctrlKey || event.metaKey) && key === 'i') { event.preventDefault(); void handleImportMediaRef.current() }
      else if ((event.ctrlKey || event.metaKey) && key === 'd') { event.preventDefault(); handleDuplicate() }
      else if ((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'x') && selectedIds.length && !window.getSelection()?.toString()) { event.preventDefault(); handleCopy(key === 'x') }
      else if ((event.ctrlKey || event.metaKey) && key === 'v' && !event.shiftKey) { if (handlePasteKey()) event.preventDefault() }
      else if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) handleRedo(); else handleUndo() }
      else if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); handleRedo() }
      else if (!event.ctrlKey && !event.metaKey && key === 's') { event.preventDefault(); handleSplit() }
      else if (!event.ctrlKey && !event.metaKey && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); handleRemoveSelected() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Changing the canvas keeps clip positions (they're stored as fractions) but resets the crop,
  // since its pixel box belonged to the old frame.
  const handleProjectChange = useCallback((next: Project) => {
    setProject(next)
    setCrop(defaultCrop(next))
  }, [])
  const handleCropChange = useCallback((nextCrop: CropSelection) => { setCrop(() => project ? clampCrop(nextCrop, project) : nextCrop) }, [project])

  // ---------- export ----------
  // With nothing to see on the timeline, the only sensible export is sound.
  const audioOnly = soundOnly(clips)
  const effectiveMode: ExportMode = audioOnly ? 'audio' : exportMode
  const source = media.find(asset => asset.kind === 'video') ?? media.find(asset => clips.some(clip => clip.mediaId === asset.id)) ?? media[0]
  const sourceMeta = project ? projectMetadata(project, source) : null
  const exportOptions: ExportOptions = {
    mode: effectiveMode, inputPath: source?.metadata.filePath ?? '', outputDir, outputFileName: 'export', clips, media, project: project ?? undefined, hiddenVideoTracks, mutedAudioTracks,
    hasAudio: source ? source.metadata.audioCodec !== 'none' : false, trim: { enabled: false, startSeconds: 0, endSeconds: 0 }, crop, compressionLevel, muteAudio, mp3Bitrate, gifScale, gifFps, playbackRate
  }
  const estimateKey = JSON.stringify(exportOptions)
  const measuredSize = measurement?.key === estimateKey ? measurement.bytes : null
  const estimatedSize = sourceMeta ? exportPlan(exportOptions, sourceMeta).targetBytes : null
  // Text is drawn here, with the same code as the preview, and sent along as images.
  const withText = async (options: ExportOptions): Promise<ExportOptions> => {
    if (options.mode === 'audio' || !project || !options.clips?.some(clip => clip.kind === 'text')) return options
    return { ...options, textImages: await renderTextImages(options.clips, project.width, project.height) }
  }
  const handleMeasure = async () => {
    measureCancelled.current = false
    setMeasuring(true)
    try { setMeasurement({ key: estimateKey, bytes: await window.electronAPI.measureExport(await withText(exportOptions)) }) }
    catch (error) { if (!measureCancelled.current) { setExportError(error instanceof Error ? error.message : String(error)); setExportState('error') } }
    finally { setMeasuring(false) }
  }
  const handleExport = useCallback(async () => {
    if (!project || !source || clips.length === 0) return
    const baseName = (source.name?.trim() || source.metadata.fileName.replace(/\.[^.]+$/, ''))
    const speedSuffix = playbackRate !== 1 ? `_${playbackRate}x` : ''
    const videoModifiers = [muteAudio ? 'muted' : null, compressionLevel !== 'none' ? `${compressionLevel}pct` : null, crop.enabled ? 'cropped' : null].filter(Boolean)
    const exportMode = effectiveMode
    const suffix = exportMode === 'audio' ? `_audio${speedSuffix}` : exportMode === 'gif' ? `_animated${crop.enabled ? '_cropped' : ''}${speedSuffix}` : videoModifiers.length > 0 ? `_${videoModifiers.join('_')}${speedSuffix}` : `_export${speedSuffix}`
    const outputFileName = `${baseName}${suffix}`
    try {
      const ext = exportMode === 'audio' ? '.mp3' : exportMode === 'gif' ? '.gif' : '.mp4'
      const defaultPath = outputDir ? `${outputDir}/${outputFileName}${ext}` : `${outputFileName}${ext}`
      const outputPath = await window.electronAPI.saveExportDialog(exportMode, defaultPath)
      if (!outputPath) return
      setExportState('running'); setProgress(null); setFfmpegLog([]); setResult(null); setExportError(null)
      await window.electronAPI.runFFmpeg(await withText({ ...exportOptions, outputFileName, outputPath }))
    } catch (error) {
      setExportError(previous => previous ?? (error instanceof Error ? error.message : String(error)))
      setExportState('error')
    }
  }, [project, source, clips, playbackRate, muteAudio, compressionLevel, crop, effectiveMode, outputDir, estimateKey])
  const handleCancel = useCallback(() => { window.electronAPI.cancelFFmpeg(); setExportState('idle') }, [])
  const handleReset = useCallback(() => { setExportState('idle'); setResult(null); setProgress(null); setFfmpegLog([]); setExportError(null) }, [])
  // Render ~5 seconds of output from the playhead through the real export, so crop, canvas,
  // compression and speed all look exactly as they will in the final file.
  const handleVideoPreview = async () => {
    if (!project || !source || !clips.length) return
    const end = timelineEnd(clips)
    const length = Math.min(PREVIEW_SECONDS * playbackRate, end)
    const start = videoCurrentTime + length > end ? Math.max(0, end - length) : videoCurrentTime
    setIsGeneratingVideoPreview(true)
    try {
      const rendered = await window.electronAPI.previewVideo(await withText({ ...exportOptions, mode: 'video', clips: sliceTimeline(clips, start, length) }))
      const quality = compressionLevel === 'none' ? 'Best quality' : `${compressionLevel}% smaller`
      setVideoPreview({ ...rendered, start, end: start + length, width: project.width, height: project.height, quality })
    } catch (error) { setExportError(error instanceof Error ? error.message : String(error)); setExportState('error') }
    finally { setIsGeneratingVideoPreview(false) }
  }
  const handleGifPreview = useCallback(async () => {
    if (!project || !source) return
    setIsGeneratingGifPreview(true)
    try { setGifPreviewUrl(await window.electronAPI.previewGif(await withText({ ...exportOptions, mode: 'gif', compressionLevel: 'none', muteAudio: false }))) }
    catch (error) { setExportError(error instanceof Error ? error.message : String(error)); setExportState('error') }
    finally { setIsGeneratingGifPreview(false) }
  }, [project, source, estimateKey])


  const mediaPanel = <>
    <LinkBox busy={downloading || exportState === 'running'} progress={downloadProgress} error={downloadError}
      onAdd={requestLink} onGif={url => void handleLinkConvert(url, 'gif')} onCancel={() => void window.electronAPI.cancelDownload()} />
    <MediaPool media={media} usage={usage} onImport={handleImportMedia} onInsert={ids => handleInsertMedia(ids)} onRemove={handleRemoveMedia} onRename={handleRenameMedia} busy={isBusy} />
    {loadingMeta && <div className="surface-note panel-note">Reading file metadata and building thumbnails…</div>}
    {preparing.length > 0 && <div className="surface-note panel-note" role="status">Preparing a preview of {preparing.join(', ')}… (this format can't play directly; export uses the original)</div>}
    {metaError && <div className="panel-note panel-note-error" role="alert">{metaError}<button className="icon-button" onClick={() => setMetaError(null)} aria-label="Dismiss"><Icon name="x" size={12} /></button></div>}
  </>

  const inspector = <Inspector
    hasProject={Boolean(project)}
    clip={<ClipProperties clips={clips} media={media} selectedIds={selectedIds} projectRate={playbackRate}
      onChange={next => commit(clips.map(clip => clip.id === next.id ? next : clip))} />}
    compression={sourceMeta && <CompressionPresets metadata={sourceMeta} options={exportOptions} selected={compressionLevel} onChange={setCompressionLevel} />}
    deliver={<>
      <ExportPanel
        mode={effectiveMode} soundOnly={audioOnly} muteAudio={muteAudio} mp3Bitrate={mp3Bitrate} gifScale={gifScale} gifFps={gifFps}
        estimatedSizeBytes={measuredSize ?? estimatedSize} measured={measuredSize !== null}
        onMeasure={handleMeasure} onCancelMeasure={() => { measureCancelled.current = true; void window.electronAPI.cancelFFmpeg() }} measuring={measuring}
        outputDir={outputDir} onModeChange={setExportMode} onMuteAudioChange={setMuteAudio} onMp3BitrateChange={setMp3Bitrate} onGifScaleChange={setGifScale} onGifFpsChange={setGifFps} onOutputDirChange={setOutputDir}
        onExport={handleExport} onPreviewGif={handleGifPreview} isGeneratingGifPreview={isGeneratingGifPreview}
        onPreviewVideo={() => void handleVideoPreview()} isGeneratingVideoPreview={isGeneratingVideoPreview} exporting={exportState === 'running'}
        disabled={!project || clips.length === 0 || measuring || isGeneratingGifPreview || isGeneratingVideoPreview}
      />
      {exportState === 'running' && <ProgressPanel progress={progress} logLines={ffmpegLog} onCancel={handleCancel} exporting={true} />}
      {exportState === 'done' && result && <ResultPanel result={result} onOpenFolder={() => window.electronAPI.openFolder(result.outputPath)} onReset={handleReset}
        downloads={downloadedMedia.length} onDeleteDownloads={handleDeleteDownloads} />}
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
            <div className="brand-subtitle">{project ? `${project.width} × ${project.height} · ${project.fps} fps · ${trackCount(clips, 'video') - 1}V / ${trackCount(clips, 'audio') - 1}A${clips.some(clip => clip.kind === 'text') ? ` / ${trackCount(clips, 'text') - 1}T` : ''}` : 'Trim, stack, compress and export local video.'}</div>
          </div>
        </div>
        <div className="app-actions">
          <label className="theme-picker" aria-label="Theme">
            <span>Theme</span>
            <select className="theme-select" value={theme} onChange={event => setTheme(event.target.value as ThemeName)}>
              {THEME_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.themes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
            </select>
          </label>
          <button className="icon-button" onClick={() => void window.electronAPI.openNewWindow()} aria-label="New window" title="New window"><Icon name="window" /></button>
          {updateWaiting && <button className="update-pill" onClick={() => setShowSettings(true)} title="Open Settings to update">
            {update.state === 'ready' ? `Restart to update to ${update.version}` : `Update ${update.version} available`}
          </button>}
          <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings"><Icon name="settings" /></button>
        </div>
      </header>

      <Editor
        project={project} media={media} clips={clips} selectedIds={selectedIds}
        hiddenVideoTracks={hiddenVideoTracks} mutedAudioTracks={mutedAudioTracks} muteAudio={muteAudio}
        crop={crop} currentTime={videoCurrentTime} playbackRate={playbackRate}
        canUndo={history.length > 0} canRedo={future.length > 0}
        onClipsChange={handleClipsChange} onSelect={handleSelect} onMarqueeSelect={handleMarqueeSelect} onClearSelection={handleClearSelection}
        onTimeUpdate={setVideoCurrentTime} onSplit={handleSplit} onRemoveSelected={handleRemoveSelected} onDuplicate={handleDuplicate} onAddText={handleAddText}
        onUndo={handleUndo} onRedo={handleRedo}
        onInsertMedia={handleInsertMedia} onDropFiles={(paths, placement) => void importPaths(paths, placement)}
        onToggleVideoTrack={track => setHiddenVideoTracks(list => toggleTrack(list, track))} onToggleAudioTrack={track => setMutedAudioTracks(list => toggleTrack(list, track))}
        onCropChange={handleCropChange} onProjectChange={handleProjectChange} onPlaybackRateChange={setPlaybackRate} onImport={handleImportMedia}
        mediaPanel={mediaPanel} inspector={inspector} timelineHeight={timelineHeight} onTimelineHeightChange={setTimelineHeight} previewPaths={previewPaths}
      />

      {fileDrag && <div className="file-drop-overlay" aria-hidden="true"><div><Icon name="plus" size={22} /><span>Drop to add media</span></div></div>}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {pendingLink && <LinkModal url={pendingLink} defaultFormat={exportMode}
        onPool={() => { const url = pendingLink; setPendingLink(null); void handleLinkAdd(url) }}
        onConvert={mode => { const url = pendingLink; setPendingLink(null); void handleLinkConvert(url, mode) }}
        onClose={() => setPendingLink(null)} />}
      {videoPreview && <PreviewModal preview={videoPreview} onClose={() => setVideoPreview(null)} onExport={() => void handleExport()} />}
      {gifPreviewUrl && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,16,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setGifPreviewUrl(null)}>
          <div className="card" style={{ maxWidth: 360, width: '100%' }} onClick={e => e.stopPropagation()}>
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
