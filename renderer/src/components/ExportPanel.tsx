import React from 'react'
import type { ExportMode, Mp3Bitrate, GifScale, GifFps } from '@shared/types'
import { formatBytes } from '../lib/sizeEstimator'
import Icon from './Icon'

interface Props {
  mode: ExportMode
  soundOnly: boolean       // nothing visible on the timeline: MP3 is the only format
  muteAudio: boolean
  mp3Bitrate: Mp3Bitrate
  gifScale: GifScale
  gifFps: GifFps
  measured: boolean
  measuring: boolean
  onMeasure: () => void
  onCancelMeasure: () => void
  estimatedSizeBytes: number | null
  outputDir: string
  onModeChange: (m: ExportMode) => void
  onMuteAudioChange: (v: boolean) => void
  onMp3BitrateChange: (br: Mp3Bitrate) => void
  onGifScaleChange: (s: GifScale) => void
  onGifFpsChange: (fps: GifFps) => void
  onOutputDirChange: (d: string) => void
  onExport: () => void
  onPreviewGif: () => void
  onPreviewVideo: () => void
  isGeneratingVideoPreview: boolean
  isGeneratingGifPreview: boolean
  exporting: boolean
  disabled: boolean
}

const FORMAT_OPTIONS: Array<{ label: string; title: string; mode: ExportMode; mute: boolean }> = [
  { label: 'MP4', title: 'MP4 video with sound', mode: 'video', mute: false },
  { label: 'Silent', title: 'MP4 video without sound', mode: 'video', mute: true },
  { label: 'MP3', title: 'Sound only', mode: 'audio', mute: false },
  { label: 'GIF', title: 'Looping animated GIF', mode: 'gif', mute: false }
]

const MP3_BITRATES: Mp3Bitrate[] = [128, 192, 320]
const GIF_SCALES: GifScale[] = [320, 480, 640]
const GIF_FPS_OPTIONS: GifFps[] = [8, 12, 15, 20]

// One labelled row of the property list.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="prop-row"><span className="prop-label">{label}</span><div className="prop-value">{children}</div></div>
}

function Segments<T extends string | number>({ items, value, label, onChange, format = String }: {
  items: T[]; value: T; label: string; onChange: (value: T) => void; format?: (value: T) => string
}) {
  return <div className="prop-segment" role="radiogroup" aria-label={label}>
    {items.map(item => <button key={String(item)} role="radio" aria-checked={item === value} className={item === value ? 'is-on' : ''} onClick={() => onChange(item)}>{format(item)}</button>)}
  </div>
}

// Output settings as a compact property list: format, its options, size, destination, then actions.
export default function ExportPanel({
  mode, soundOnly, muteAudio, mp3Bitrate, gifScale, gifFps,
  estimatedSizeBytes, measured, measuring, onMeasure, onCancelMeasure,
  outputDir, onModeChange, onMuteAudioChange, onMp3BitrateChange, onGifScaleChange, onGifFpsChange, onOutputDirChange,
  onExport, onPreviewGif, onPreviewVideo, isGeneratingVideoPreview, isGeneratingGifPreview, exporting, disabled
}: Props) {
  const handlePickFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) onOutputDirChange(dir)
  }
  const exportLabel = mode === 'audio' ? 'Export MP3' : mode === 'gif' ? 'Export GIF' : 'Export MP4'
  const sizeText = estimatedSizeBytes === null ? 'Varies' : `${measured ? '' : '~'}${formatBytes(estimatedSizeBytes)}`

  return (
    <div className="export-panel">
      <Row label="Format">
        <div className="prop-segment" role="radiogroup" aria-label="Format">
          {FORMAT_OPTIONS.map(option => {
            const on = soundOnly ? option.mode === 'audio' : option.mode === mode && option.mute === muteAudio
            const locked = soundOnly && option.mode !== 'audio'
            return <button key={option.label} role="radio" aria-checked={on} className={on ? 'is-on' : ''} disabled={locked}
              title={locked ? 'The timeline only has sound, so it exports as MP3' : option.title}
              onClick={() => { onModeChange(option.mode); onMuteAudioChange(option.mute) }}>{option.label}</button>
          })}
        </div>
      </Row>
      {soundOnly && <div className="surface-note export-note">Only sound on the timeline, so this exports as MP3.</div>}

      {mode === 'audio' && <Row label="Bitrate"><Segments label="Audio bitrate" items={MP3_BITRATES} value={mp3Bitrate} onChange={onMp3BitrateChange} format={value => `${value}k`} /></Row>}
      {mode === 'gif' && <Row label="Width"><Segments label="GIF width" items={GIF_SCALES} value={gifScale} onChange={onGifScaleChange} format={value => `${value}px`} /></Row>}
      {mode === 'gif' && <Row label="FPS"><Segments label="GIF frame rate" items={GIF_FPS_OPTIONS} value={gifFps} onChange={onGifFpsChange} /></Row>}

      <Row label="Size">
        <div className="prop-size export-metric-card">
          <b>{sizeText}</b>
          <span>{measured ? 'Exact size' : estimatedSizeBytes === null ? 'depends on the video' : 'Estimate'}</span>
        </div>
        {measuring
          ? <button className="prop-link" onClick={onCancelMeasure}>Cancel</button>
          : <button className="prop-link" onClick={onMeasure} disabled={disabled || exporting} title="Do a test export to get the exact file size">Get exact</button>}
      </Row>

      <Row label="Save to">
        <button className="prop-path" onClick={handlePickFolder} title={outputDir ? `${outputDir} (click to change)` : 'Choose a folder'} aria-label="Choose folder">
          <span>{outputDir || 'Choose a folder'}</span>
          <Icon name="folder" size={13} />
        </button>
      </Row>

      <div className="export-actions">
        {mode === 'video' && (
          <button className="btn-ghost" onClick={onPreviewVideo} disabled={disabled || exporting || isGeneratingVideoPreview}
            title="Render 5 seconds from the playhead exactly as the export will look">
            <Icon name="play" size={13} />
            <span>{isGeneratingVideoPreview ? 'Rendering…' : 'Preview 5s'}</span>
          </button>
        )}
        {mode === 'gif' && (
          <button className="btn-ghost" onClick={onPreviewGif} disabled={disabled || exporting || isGeneratingGifPreview} title="Render a quick GIF sample">
            <Icon name="play" size={13} />
            <span>{isGeneratingGifPreview ? 'Rendering…' : 'Preview'}</span>
          </button>
        )}
        <button className="btn-primary" onClick={onExport} disabled={disabled || exporting}>
          <Icon name="export" size={14} />
          <span>{exporting ? 'Exporting…' : exportLabel}</span>
        </button>
      </div>
    </div>
  )
}
