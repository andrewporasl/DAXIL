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

type FormatOption = { label: string; sub: string; mode: ExportMode; mute: boolean }

const FORMAT_OPTIONS: FormatOption[] = [
  { label: 'MP4 Video', sub: 'H.264 with audio', mode: 'video', mute: false },
  { label: 'MP4 No Audio', sub: 'Video only, no sound', mode: 'video', mute: true },
  { label: 'MP3 Audio', sub: 'Audio track only', mode: 'audio', mute: false },
  { label: 'GIF', sub: 'Animated image', mode: 'gif', mute: false }
]

const MP3_BITRATES: Mp3Bitrate[] = [128, 192, 320]
const GIF_SCALES: GifScale[] = [320, 480, 640]

export default function ExportPanel({
  mode, muteAudio, mp3Bitrate, gifScale, estimatedSizeBytes, outputDir,
  onModeChange, onMuteAudioChange, onMp3BitrateChange, onGifScaleChange,
  onOutputDirChange, onExport, exporting, disabled
}: Props) {
  const handlePickFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) onOutputDirChange(dir)
  }

  const isSelected = (opt: FormatOption) => opt.mode === mode && opt.mute === muteAudio

  const handleFormat = (opt: FormatOption) => {
    onModeChange(opt.mode)
    onMuteAudioChange(opt.mute)
  }

  const exportLabel = mode === 'audio' ? 'Export MP3' : mode === 'gif' ? 'Export GIF' : 'Export MP4'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Format */}
      <div>
        <div className="section-title">Format</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {FORMAT_OPTIONS.map((opt) => {
            const sel = isSelected(opt)
            return (
              <button
                key={`${opt.mode}-${opt.mute}`}
                onClick={() => handleFormat(opt)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: sel ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${sel ? 'var(--accent-border)' : 'transparent'}`,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s'
                }}
              >
                <div style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--text-dim)'}`,
                  background: sel ? 'var(--accent)' : 'transparent',
                  flexShrink: 0,
                  transition: 'all 0.12s'
                }} />
                <div>
                  <div style={{ fontSize: 12, color: sel ? 'var(--text)' : 'var(--text-muted)', fontWeight: sel ? 500 : 400 }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{opt.sub}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* MP3 quality */}
      {mode === 'audio' && (
        <div>
          <div className="section-title">Quality</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {MP3_BITRATES.map((br) => (
              <button
                key={br}
                onClick={() => onMp3BitrateChange(br)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${mp3Bitrate === br ? 'var(--accent)' : 'var(--border)'}`,
                  background: mp3Bitrate === br ? 'var(--accent-dim)' : 'transparent',
                  color: mp3Bitrate === br ? 'var(--accent)' : 'var(--text-dim)',
                  fontWeight: mp3Bitrate === br ? 600 : 400,
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'all 0.12s'
                }}
              >
                {br}k
              </button>
            ))}
          </div>
        </div>
      )}

      {/* GIF scale */}
      {mode === 'gif' && (
        <div>
          <div className="section-title">GIF Width</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {GIF_SCALES.map((s) => (
              <button
                key={s}
                onClick={() => onGifScaleChange(s)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${gifScale === s ? 'var(--accent)' : 'var(--border)'}`,
                  background: gifScale === s ? 'var(--accent-dim)' : 'transparent',
                  color: gifScale === s ? 'var(--accent)' : 'var(--text-dim)',
                  fontWeight: gifScale === s ? 600 : 400,
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'all 0.12s'
                }}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Estimated size */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Est. size
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          {formatBytes(estimatedSizeBytes)}
        </span>
      </div>

      {/* Output folder */}
      <div>
        <label>Output folder</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={outputDir}
            onChange={(e) => onOutputDirChange(e.target.value)}
            placeholder="Choose a folder..."
            readOnly
            style={{ flex: 1, fontSize: 11 }}
          />
          <button className="btn-ghost" onClick={handlePickFolder} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
            Browse
          </button>
        </div>
      </div>

      {/* Export button */}
      <button
        className="btn-primary"
        onClick={onExport}
        disabled={disabled || exporting}
        style={{ width: '100%', padding: '11px 0', fontSize: 13, letterSpacing: '0.01em' }}
      >
        {exporting ? 'Exporting...' : exportLabel}
      </button>
    </div>
  )
}
