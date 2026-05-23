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
import { estimateCompressedSize, estimateTrimmedSize, estimateMp3Size, estimateGifSize } from './lib/sizeEstimator'

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

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      if (s.defaultOutputDir) setOutputDir(s.defaultOutputDir)
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

      // Generate thumbnails in background — don't block UI
      window.electronAPI.getThumbnails(fp, meta.durationSeconds, 16)
        .then(setThumbnails)
        .catch(() => setThumbnails([]))
    } catch (e: unknown) {
      setMetaError(e instanceof Error ? e.message : 'Failed to read file metadata')
    } finally {
      setLoadingMeta(false)
    }
  }, [])

  const handleTrimChange = useCallback((start: number, end: number) => {
    setTrim((prev) => {
      const fullEnd = metadata?.durationSeconds ?? 0
      const atFullRange = start <= 0.05 && end >= fullEnd - 0.05
      return {
        enabled: !atFullRange,
        startSeconds: start,
        endSeconds: end
      }
    })
  }, [metadata])

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

  const showProgress = exportState === 'running' || exportState === 'done' || exportState === 'error'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: 44,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--surface)'
      }}>
        <div style={{
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: '0.12em',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          DAXIL
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)'
          }} />
        </div>
        <button className="btn-ghost" onClick={() => setShowSettings(true)} style={{ fontSize: 11 }}>
          Settings
        </button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left panel */}
        <div style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          padding: 14,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <FileDropZone onFilePicked={handleFilePicked} disabled={exportState === 'running'} />

          {loadingMeta && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, textAlign: 'center', padding: 10 }}>
              Reading metadata...
            </div>
          )}

          {metaError && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <div style={{ color: 'var(--danger)', fontSize: 12 }}>{metaError}</div>
            </div>
          )}

          {metadata && <MetadataCard metadata={metadata} />}
        </div>

        {/* Center panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}>
            <VideoTimeline
              filePath={filePath}
              duration={metadata?.durationSeconds ?? 0}
              thumbnails={thumbnails}
              start={trim.startSeconds}
              end={trim.enabled ? trim.endSeconds : (metadata?.durationSeconds ?? 0)}
              currentTime={videoCurrentTime}
              onTimeUpdate={setVideoCurrentTime}
              onTrimChange={handleTrimChange}
            />

            {exportState === 'error' && exportError && (
              <div className="card" style={{ borderColor: 'var(--danger)' }}>
                <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 6, fontSize: 12 }}>Export failed</div>
                <pre style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                  {exportError}
                </pre>
                <button className="btn-ghost" onClick={handleReset} style={{ marginTop: 8, fontSize: 11 }}>Dismiss</button>
              </div>
            )}

            {exportState === 'done' && result && (
              <ResultPanel
                result={result}
                onOpenFolder={() => window.electronAPI.openFolder(result.outputPath)}
                onReset={handleReset}
              />
            )}

            {showProgress && exportState !== 'done' && exportState !== 'error' && (
              <ProgressPanel
                progress={progress}
                logLines={ffmpegLog}
                onCancel={handleCancel}
                exporting={exportState === 'running'}
              />
            )}
          </div>
        </div>

        {/* Right panel */}
        <div style={{
          width: 280,
          flexShrink: 0,
          borderLeft: '1px solid var(--border)',
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 0
        }}>
          {!metadata ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 60 }}>
              Select a video to get started
            </div>
          ) : (
            <>
              <CompressionPresets
                metadata={metadata}
                trim={trim}
                selected={compressionLevel}
                onChange={setCompressionLevel}
              />

              <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

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
            </>
          )}
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
