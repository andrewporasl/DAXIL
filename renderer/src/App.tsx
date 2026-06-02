import React, { useState, useEffect, useCallback } from 'react'
import brandIcon from '../../resources/icon.png'
import type {
  VideoMetadata, TrimRange, ExportMode, Mp3Bitrate, GifScale, GifFps,
  CompressionLevel, ProgressEvent, CompletionEvent, FFmpegEvent, CropSelection
} from '../../shared/types'
import FileDropZone from './components/FileDropZone'
import VideoTimeline from './components/VideoTimeline'
import MetadataCard from './components/MetadataCard'
import CompressionPresets from './components/CompressionPresets'
import CropPanel from './components/CropPanel'
import ExportPanel from './components/ExportPanel'
import ProgressPanel from './components/ProgressPanel'
import ResultPanel from './components/ResultPanel'
import SettingsModal from './components/SettingsModal'
import Icon from './components/Icon'
import {
  estimateCompressedSize,
  estimateTrimmedSize,
  estimateMp3Size,
  estimateGifSize,
  formatBytes,
  formatDuration
} from './lib/sizeEstimator'

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

const REDUCTION_MAP: Record<CompressionLevel, number> = {
  none: 0, '25': 0.25, '50': 0.50, '75': 0.75, '90': 0.90
}

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
  const isBusy = exportState === 'running' || loadingMeta

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

  const handleFilePicked = useCallback(async (fp: string) => {
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
    setCompressionLevel('none')
    setPlaybackRate(1)
    setGifFps(12)

    try {
      const meta = await window.electronAPI.getMetadata(fp)
      setMetadata(meta)
      setTrim({ enabled: false, startSeconds: 0, endSeconds: meta.durationSeconds })
      setCrop(defaultCrop(meta))

      window.electronAPI.getThumbnails(fp, meta.durationSeconds, 16)
        .then(setThumbnails)
        .catch(() => setThumbnails([]))
    } catch (error: unknown) {
      setMetaError(error instanceof Error ? error.message : 'Failed to read file metadata')
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrim(() => {
      const fullEnd = metadata?.durationSeconds ?? 0
      const atFullRange = start <= 0.05 && end >= fullEnd - 0.05
      return {
        enabled: !atFullRange,
        startSeconds: start,
        endSeconds: end
      }
    })
  }, [metadata])

  const handleCropChange = useCallback((nextCrop: CropSelection) => {
    setCrop(() => metadata ? clampCrop(nextCrop, metadata) : nextCrop)
  }, [metadata])

  const handleOpenVideo = useCallback(async () => {
    if (isBusy) return
    const nextFilePath = await window.electronAPI.openFile()
    if (nextFilePath) await handleFilePicked(nextFilePath)
  }, [handleFilePicked, isBusy])

  const handleOpenNewWindow = useCallback(() => {
    void window.electronAPI.openNewWindow()
  }, [])

  const estimatedSize = metadata
    ? exportMode === 'audio'
      ? estimateMp3Size(metadata, mp3Bitrate, trim)
      : exportMode === 'gif'
        ? estimateGifSize(metadata, gifScale, trim, crop)
        : REDUCTION_MAP[compressionLevel] > 0
          ? estimateCompressedSize(metadata, REDUCTION_MAP[compressionLevel], trim, crop)
          : estimateTrimmedSize(metadata, trim, crop)
    : 0

  const handleExport = useCallback(async () => {
    if (!metadata || !filePath) return
    if (!outputDir) {
      alert('Please choose an output folder first.')
      return
    }

    setExportState('running')
    setProgress(null)
    setFfmpegLog([])
    setResult(null)
    setExportError(null)

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
      await window.electronAPI.runFFmpeg({
        mode: exportMode,
        inputPath: filePath,
        outputDir,
        outputFileName,
        trim,
        crop,
        compressionLevel,
        muteAudio,
        mp3Bitrate,
        gifScale,
        gifFps,
        playbackRate
      })
    } catch {
      // handled via onFFmpegEvent
    }
  }, [metadata, filePath, outputDir, exportMode, muteAudio, compressionLevel, trim, crop, mp3Bitrate, gifScale, gifFps, playbackRate])

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
        trim,
        crop,
        compressionLevel: 'none',
        muteAudio: false,
        gifScale,
        gifFps,
        playbackRate
      })
      setGifPreviewUrl(url)
    } catch {
      // silently ignore preview failures
    } finally {
      setIsGeneratingGifPreview(false)
    }
  }, [metadata, filePath, trim, crop, gifScale, gifFps, playbackRate])

  const compressionLabel = compressionLevel === 'none' ? 'Original' : `${compressionLevel}% smaller`
  const timelineEnd = metadata ? (trim.enabled ? trim.endSeconds : metadata.durationSeconds) : 0
  const selectionDuration = metadata ? Math.max(timelineEnd - trim.startSeconds, 0) : 0
  const cropLabel = crop.enabled && exportMode !== 'audio' ? ' cropped' : ''
  const modeLabel = exportMode === 'audio'
    ? `MP3 ${mp3Bitrate}k`
    : exportMode === 'gif'
      ? `GIF ${gifScale}px${cropLabel}`
      : muteAudio
        ? `MP4 mute${cropLabel}`
        : `${compressionLevel === 'none' ? 'MP4 original' : `MP4 ${compressionLevel}%`}${cropLabel}`

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="card-soft app-header">
        <div className="brand-lockup">
          <img src={brandIcon} alt="" className="brand-icon" />
          <div className="brand-copy">
            <div className="brand-wordmark">DAXIL</div>
            <div className="brand-subtitle">
              {metadata ? metadata.fileName : 'Trim, compress, and export local video.'}
            </div>
          </div>
        </div>

        <div className="app-actions">
          <label className="theme-picker" aria-label="Theme">
            <span>Theme</span>
            <select
              className="theme-select"
              value={theme}
              onChange={(event) => setTheme(event.target.value as ThemeName)}
            >
              {THEME_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.themes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <button
            className="icon-button icon-button-accent"
            onClick={handleOpenVideo}
            disabled={isBusy}
            aria-label={metadata ? 'Open another video' : 'Open video'}
            title={metadata ? 'Open another video' : 'Open video'}
          >
            <Icon name="folder-plus" />
          </button>
          <button
            className="icon-button"
            onClick={handleOpenNewWindow}
            aria-label="New window"
            title="New window"
          >
            <Icon name="window" />
          </button>
          <button
            className="icon-button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <main className="app-layout">
        <aside className="card-soft side-rail">
          <div className="side-rail-stack">
            <FileDropZone
              onFilePicked={handleFilePicked}
              disabled={isBusy}
              hasVideo={Boolean(filePath)}
            />

            {loadingMeta && (
              <div className="card">
                <div className="section-title" style={{ marginBottom: 6 }}>Loading</div>
                <div className="surface-note">Reading file metadata and building thumbnails.</div>
              </div>
            )}

            {metaError && (
              <div className="card" style={{ borderColor: 'var(--danger)' }}>
                <div className="section-title" style={{ marginBottom: 6, color: 'var(--danger)' }}>Error</div>
                <div className="surface-note" style={{ color: 'var(--danger)' }}>{metaError}</div>
              </div>
            )}

            {metadata && <MetadataCard metadata={metadata} />}
          </div>
        </aside>

        <section className="card-soft preview-panel">
          {metadata && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <div className="badge">{modeLabel}</div>
              <div className="badge badge-accent">{formatDuration(selectionDuration)}</div>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0 }}>
            <VideoTimeline
              filePath={filePath}
              duration={metadata?.durationSeconds ?? 0}
              thumbnails={thumbnails}
              videoWidth={metadata?.width ?? 0}
              videoHeight={metadata?.height ?? 0}
              start={trim.startSeconds}
              end={timelineEnd}
              crop={crop}
              currentTime={videoCurrentTime}
              playbackRate={playbackRate}
              onTimeUpdate={setVideoCurrentTime}
              onTrimChange={handleTrimChange}
              onCropChange={handleCropChange}
              onPlaybackRateChange={setPlaybackRate}
            />
          </div>
        </section>

        <aside className="card-soft side-rail">
          {metadata ? (
            <div className="side-rail-stack">
              <CropPanel
                metadata={metadata}
                crop={crop}
                onCropChange={handleCropChange}
              />

              <div className="card" style={{ padding: 12 }}>
                <button
                  className="collapse-toggle"
                  onClick={() => setCompressionExpanded(v => !v)}
                >
                  <span className="section-title" style={{ margin: 0 }}>Compression</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!compressionExpanded && (
                      <span className="badge" style={{ fontSize: 10 }}>{compressionLabel}</span>
                    )}
                    <span className={`section-chevron ${compressionExpanded ? 'open' : ''}`} />
                  </div>
                </button>
                {compressionExpanded && (
                  <div style={{ marginTop: 10 }}>
                    <CompressionPresets
                      metadata={metadata}
                      trim={trim}
                      crop={crop}
                      selected={compressionLevel}
                      onChange={setCompressionLevel}
                    />
                  </div>
                )}
              </div>

              <ExportPanel
                mode={exportMode}
                muteAudio={muteAudio}
                mp3Bitrate={mp3Bitrate}
                gifScale={gifScale}
                gifFps={gifFps}
                estimatedSizeBytes={estimatedSize}
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
                disabled={!metadata}
              />

              {exportState === 'running' && (
                <ProgressPanel
                  progress={progress}
                  logLines={ffmpegLog}
                  onCancel={handleCancel}
                  exporting={true}
                />
              )}

              {exportState === 'done' && result && (
                <ResultPanel
                  result={result}
                  onOpenFolder={() => window.electronAPI.openFolder(result.outputPath)}
                  onReset={handleReset}
                />
              )}

              {exportState === 'error' && exportError && (
                <div className="card" style={{ borderColor: 'var(--danger)' }}>
                  <div className="section-title" style={{ marginBottom: 6, color: 'var(--danger)' }}>Export error</div>
                  <pre className="mono-block" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {exportError}
                  </pre>
                  <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 10 }}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="section-title" style={{ marginBottom: 8 }}>Export</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Load a video to start.</div>
              <div className="surface-note">
                Compression, format, and export controls show up here once a source is selected.
              </div>
            </div>
          )}
        </aside>
      </main>

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
            <div className="surface-note" style={{ marginTop: 10 }}>Preview at 240px wide, up to 3 s. Click outside to close.</div>
          </div>
        </div>
      )}
    </div>
  )
}
