import React, { useState } from 'react'
import type { MediaAsset, OverlayClip, VideoMetadata } from '@shared/types'
import { formatBytes, formatDuration } from '../lib/sizeEstimator'

interface Props {
  source: VideoMetadata | null
  selectedAsset: MediaAsset | null
  selectedOverlay: OverlayClip | null
  onOverlayChange: (overlay: OverlayClip) => void
  crop: React.ReactNode
  compression: React.ReactNode
  deliver: React.ReactNode
}

function Section({ title, badge, defaultOpen = true, children }: { title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`inspector-section${open ? ' is-open' : ''}`}>
    <button className="inspector-heading" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="section-title">{title}</span>
      <span className="inspector-heading-right">{!open && badge}<span className={`section-chevron ${open ? 'open' : ''}`} /></span>
    </button>
    {open && <div className="inspector-body">{children}</div>}
  </section>
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="inspector-row"><span>{label}</span><b>{value}</b></div>
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return <label className="inspector-slider">
    <span>{label}<b>{format(value)}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>
}

// Resolve-style inspector: what is selected, then crop, compression and deliver.
export default function Inspector({ source, selectedAsset, selectedOverlay, onOverlayChange, crop, compression, deliver }: Props) {
  const meta = selectedAsset?.metadata ?? source
  const update = (patch: Partial<OverlayClip>) => { if (selectedOverlay) onOverlayChange({ ...selectedOverlay, ...patch }) }
  return <div className="inspector">
    <Section title={selectedOverlay ? 'Stacked clip' : 'Clip'} badge={meta && <small className="inspector-badge">{meta.fileName}</small>}>
      {meta ? <>
        <div className="inspector-filename" title={meta.filePath}>{meta.fileName}</div>
        <div className="inspector-metrics">
          <div><span>Duration</span><b>{formatDuration(meta.durationSeconds)}</b></div>
          <div><span>Size</span><b>{formatBytes(meta.fileSizeBytes)}</b></div>
        </div>
        <Row label="Resolution" value={meta.width && meta.height ? `${meta.width} × ${meta.height}` : '—'} />
        <Row label="Video" value={meta.videoCodec || '—'} />
        <Row label="Audio" value={meta.audioCodec && meta.audioCodec !== 'none' ? meta.audioCodec : 'None'} />
        <Row label="FPS" value={meta.fps > 0 ? `${meta.fps}` : '—'} />
        {selectedOverlay && <div className="inspector-transform">
          <div className="section-title" style={{ marginTop: 10 }}>Transform · V{selectedOverlay.track + 1}</div>
          <Slider label="Size" value={selectedOverlay.scale} min={0.05} max={1} step={0.01} format={value => `${Math.round(value * 100)}%`} onChange={scale => update({ scale })} />
          <Slider label="X" value={selectedOverlay.x} min={-0.5} max={1} step={0.005} format={value => `${Math.round(value * 100)}%`} onChange={x => update({ x })} />
          <Slider label="Y" value={selectedOverlay.y} min={-0.5} max={1} step={0.005} format={value => `${Math.round(value * 100)}%`} onChange={y => update({ y })} />
          <Slider label="Opacity" value={selectedOverlay.opacity} min={0} max={1} step={0.01} format={value => `${Math.round(value * 100)}%`} onChange={opacity => update({ opacity })} />
          <div className="inspector-actions">
            <button className="btn-ghost" onClick={() => update({ x: 0, y: 0, scale: 1 })}>Fill frame</button>
            <button className="btn-ghost" onClick={() => update({ x: 0.58, y: 0.05, scale: 0.4, opacity: 1 })}>Reset</button>
          </div>
          <div className="surface-note">Drag the clip in the preview to move it; drag its corner to resize. Stacked clips are picture-only — drop the same file on an audio lane to hear it.</div>
        </div>}
      </> : <div className="surface-note">Import or drop media to see its details here.</div>}
    </Section>
    {source && <Section title="Crop" defaultOpen={false}>{crop}</Section>}
    {source && <Section title="Compression" defaultOpen={false}>{compression}</Section>}
    <Section title="Deliver">{source ? deliver : <div className="surface-note">Load a video to see export options.</div>}</Section>
  </div>
}
