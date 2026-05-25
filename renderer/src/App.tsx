import React, { useState, useEffect, useCallback } from 'react'
import type {
  VideoMetadata, TrimRange, ExportMode, Mp3Bitrate, GifScale,
  CompressionLevel, ProgressEvent, CompletionEvent, FFmpegEvent
} from '../../shared/types'
import FileDropZone from './components/FileDropZone'
import VideoTimeline from './components/VideoTimeline'
import MetadataCard from './components/MetadataCard'
import CompressionPresets from './components/CompressionPresets'
import ExportPanel from './components/ExportPanel'
import ProgressPanel from './components/ProgressPanel'
import ResultPanel from './components/ResultPanel'
import SettingsModal from './components/SettingsModal'
import {
  estimateCompressedSize,
  estimateTrimmedSize,
  estimateMp3Size,
  estimateGifSize,
  formatBytes,
  formatDuration
} from './lib/sizeEstimator'

type ExportState = 'idle' | 'running' | 'done' | 'error'

const REDUCTION_MAP: Record<CompressionLevel, number> = {
  none: 0, '25': 0.25, '50': 0.50, '75': 0.75, '90': 0.90
}

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<string[]>([])

  const [trim, setTrim] = useState<TrimRange>({ enabled: false, startSeconds: 0, endSeconds: 0 })
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)

  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>('none')
  const [exportMode, setExportMode] = useState<ExportMode>('video')
  const [muteAudio, setMuteAudio] = useState(false)
  const [mp3Bitrate, setMp3Bitrate] = useState<Mp3Bitrate>(192)
  const [gifScale, setGifScale] = useState<GifScale>(480)
  const [outputDir, setOutputDir] = useState('')

  const [exportState, setExportState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [ffmpegLog, setFfmpegLog] = useState<string[]>([])
  const [result, setResult] = useState<CompletionEvent | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [showSettings, setShowSettings] = useState(false)
  const isBusy = exportState === 'running' || loadingMeta

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

    try {
      const meta = await window.electronAPI.getMetadata(fp)
      setMetadata(meta)
      setTrim({ enabled: false, startSeconds: 0, endSeconds: meta.durationSeconds })

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
        ? estimateGifSize(metadata, gifScale, trim)
        : REDUCTION_MAP[compressionLevel] > 0
          ? estimateCompressedSize(metadata, REDUCTION_MAP[compressionLevel], trim)
          : estimateTrimmedSize(metadata, trim)
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
    const suffix =
      exportMode === 'audio' ? '_audio' :
        exportMode === 'gif' ? '_animated' :
          muteAudio ? '_muted' :
            compressionLevel !== 'none' ? `_${compressionLevel}pct` :
              trim.enabled ? '_trimmed' : '_export'

    const outputFileName = `${baseName}${suffix}`

    try {
      await window.electronAPI.runFFmpeg({
        mode: exportMode,
        inputPath: filePath,
        outputDir,
        outputFileName,
        trim,
        compressionLevel,
        muteAudio,
        mp3Bitrate,
        gifScale
      })
    } catch {
      // handled via onFFmpegEvent
    }
  }, [metadata, filePath, outputDir, exportMode, muteAudio, compressionLevel, trim, mp3Bitrate, gifScale])

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

  const timelineEnd = metadata ? (trim.enabled ? trim.endSeconds : metadata.durationSeconds) : 0
  const selectionDuration = metadata ? Math.max(timelineEnd - trim.startSeconds, 0) : 0
  const modeLabel = exportMode === 'audio'
    ? `MP3 ${mp3Bitrate}k`
    : exportMode === 'gif'
      ? `GIF ${gifScale}px`
      : muteAudio
        ? 'MP4 mute'
        : compressionLevel === 'none'
          ? 'MP4 original'
          : `MP4 ${compressionLevel}%`

  return (
    <div style={{ height: '100vh', overflow: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header className="card-soft" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 60 }}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true" />
          <div className="brand-copy">
            <div className="brand-wordmark">DAXIL</div>
            <div className="brand-subtitle">
              {metadata ? metadata.fileName : 'Trim, compress, and export local video.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {metadata && <div className="badge badge-accent">{formatDuration(selectionDuration)}</div>}
          {metadata && <div className="badge">{formatBytes(estimatedSize)}</div>}
          <button className="btn-primary" onClick={handleOpenVideo} disabled={isBusy}>
            {metadata ? 'Open Another' : 'Open Video'}
          </button>
          <button className="btn-ghost" onClick={handleOpenNewWindow}>
            New Window
          </button>
          <button className="btn-ghost" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '236px minmax(0, 1fr) 316px', gap: 12, flex: 1, minHeight: 0 }}>
        <aside className="card-soft" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
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
        </aside>

        <section className="card-soft" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Preview</div>
              <div className="surface-note">Range {formatDuration(trim.startSeconds)} to {formatDuration(timelineEnd)}</div>
            </div>

            {metadata && (
              <div style={{ display: 'flex', gap: 8 }}>
                <div className="badge">{modeLabel}</div>
                <div className="badge">{formatDuration(selectionDuration)}</div>
              </div>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <VideoTimeline
              filePath={filePath}
              duration={metadata?.durationSeconds ?? 0}
              thumbnails={thumbnails}
              start={trim.startSeconds}
              end={timelineEnd}
              currentTime={videoCurrentTime}
              onTimeUpdate={setVideoCurrentTime}
              onTrimChange={handleTrimChange}
            />
          </div>
        </section>

        <aside className="card-soft" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {metadata ? (
            <>
              <div className="card" style={{ padding: 12 }}>
                <div className="section-title" style={{ marginBottom: 8 }}>Compression</div>
                <CompressionPresets
                  metadata={metadata}
                  trim={trim}
                  selected={compressionLevel}
                  onChange={setCompressionLevel}
                />
              </div>

              <ExportPanel
                mode={exportMode}
                muteAudio={muteAudio}
                mp3Bitrate={mp3Bitrate}
                gifScale={gifScale}
                estimatedSizeBytes={estimatedSize}
                outputDir={outputDir}
                onModeChange={setExportMode}
                onMuteAudioChange={setMuteAudio}
                onMp3BitrateChange={setMp3Bitrate}
                onGifScaleChange={setGifScale}
                onOutputDirChange={setOutputDir}
                onExport={handleExport}
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
            </>
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
    </div>
  )
}
