import React from 'react'
import type { ExportMode, Mp3Bitrate, GifScale } from '../../../../shared/types'
import { formatBytes } from '../lib/sizeEstimator'

interface Props {
  mode: ExportMode
  muteAudio: boolean
  mp3Bitrate: Mp3Bitrate
  gifScale: GifScale
  estimatedSizeBytes: number
  outputDir: string
  onModeChange: (m: ExportMode) => void
  onMuteAudioChange: (v: boolean) => void
  onMp3BitrateChange: (br: Mp3Bitrate) => void
  onGifScaleChange: (s: GifScale) => void
  onOutputDirChange: (d: string) => void
  onExport: () => void
  exporting: boolean
  disabled: boolean
}

const FORMAT_OPTIONS: Array<{ label: string; sub: string; mode: ExportMode; mute: boolean }> = [
  { label: 'MP4', sub: 'With audio', mode: 'video', mute: false },
  { label: 'MP4 mute', sub: 'Silent video', mode: 'video', mute: true },
  { label: 'MP3', sub: 'Audio only', mode: 'audio', mute: false },
  { label: 'GIF', sub: 'Animated loop', mode: 'gif', mute: false }
]

const MP3_BITRATES: Mp3Bitrate[] = [128, 192, 320]
const GIF_SCALES: GifScale[] = [320, 480, 640]

export default function ExportPanel({
  mode,
  muteAudio,
  mp3Bitrate,
  gifScale,
  estimatedSizeBytes,
  outputDir,
  onModeChange,
  onMuteAudioChange,
  onMp3BitrateChange,
  onGifScaleChange,
  onOutputDirChange,
  onExport,
  exporting,
  disabled
}: Props) {
  const handlePickFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) onOutputDirChange(dir)
  }

  const isSelected = (option: { mode: ExportMode; mute: boolean }) =>
    option.mode === mode && option.mute === muteAudio

  const exportLabel = mode === 'audio' ? 'Export MP3' : mode === 'gif' ? 'Export GIF' : 'Export MP4'

  return (
    <div className="card export-panel">
      <div className="export-panel-stack">
        <div>
          <div className="section-title" style={{ marginBottom: 10 }}>Format</div>
          <div className="export-format-grid">
            {FORMAT_OPTIONS.map((option) => {
              const selected = isSelected(option)
              return (
                <button
                  key={`${option.mode}-${option.mute}`}
                  className={`option-button export-option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    onModeChange(option.mode)
                    onMuteAudioChange(option.mute)
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div className="radio-dot" />
                    <div>
                      <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                        {option.label}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {option.sub}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {mode === 'audio' && (
          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>Audio Bitrate</div>
            <div className="segmented-row">
              {MP3_BITRATES.map((bitrate) => (
                <button
                  key={bitrate}
                  className={`segment-pill ${mp3Bitrate === bitrate ? 'selected' : ''}`}
                  onClick={() => onMp3BitrateChange(bitrate)}
                >
                  {bitrate}k
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'gif' && (
          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>GIF Width</div>
            <div className="segmented-row">
              {GIF_SCALES.map((scale) => (
                <button
                  key={scale}
                  className={`segment-pill ${gifScale === scale ? 'selected' : ''}`}
                  onClick={() => onGifScaleChange(scale)}
                >
                  {scale}px
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="metric-card export-metric-card">
          <span className="metric-label">Estimated Output</span>
          <span className="metric-value" style={{ fontSize: 22 }}>{formatBytes(estimatedSizeBytes)}</span>
        </div>

        <div>
          <label>Output folder</label>
          <div className="export-output-row">
            <input
              value={outputDir}
              onChange={(event) => onOutputDirChange(event.target.value)}
              placeholder="Choose a folder..."
              readOnly
            />
            <button className="btn-ghost" onClick={handlePickFolder}>
              Browse
            </button>
          </div>
        </div>
      </div>

      <div className="export-panel-footer">
        <button
          className="btn-primary"
          onClick={onExport}
          disabled={disabled || exporting}
          style={{ width: '100%' }}
        >
          {exporting ? 'Exporting...' : exportLabel}
        </button>
      </div>
    </div>
  )
}
