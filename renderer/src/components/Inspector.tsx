import React, { useState } from 'react'
import type { Clip } from '@shared/types'
import { FULL_FRAME, PIP_FRAME } from '../lib/edit'

interface Props {
  hasProject: boolean
  selectedVideoClip: Clip | null
  onClipChange: (clip: Clip) => void
  crop: React.ReactNode
  compression: React.ReactNode
  deliver: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return <section className={`inspector-section${open ? ' is-open' : ''}`}>
    <button className="inspector-heading" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span className="section-title">{title}</span>
      <span className={`section-chevron ${open ? 'open' : ''}`} />
    </button>
    {open && <div className="inspector-body">{children}</div>}
  </section>
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return <label className="inspector-slider">
    <span>{label}<b>{format(value)}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>
}

// Just the controls: transform for the selected video clip, then crop, compression and deliver.
export default function Inspector({ hasProject, selectedVideoClip, onClipChange, crop, compression, deliver }: Props) {
  const clip = selectedVideoClip
  const update = (patch: Partial<Clip>) => { if (clip) onClipChange({ ...clip, ...patch }) }
  const percent = (value: number) => `${Math.round(value * 100)}%`
  return <div className="inspector">
    {clip && <Section title={`Transform · V${clip.track + 1}`}>
      <div className="inspector-transform">
        <Slider label="Size" value={clip.scale} min={0.05} max={1} step={0.01} format={percent} onChange={scale => update({ scale })} />
        <Slider label="X" value={clip.x} min={-0.5} max={1} step={0.005} format={percent} onChange={x => update({ x })} />
        <Slider label="Y" value={clip.y} min={-0.5} max={1} step={0.005} format={percent} onChange={y => update({ y })} />
        <Slider label="Opacity" value={clip.opacity} min={0} max={1} step={0.01} format={percent} onChange={opacity => update({ opacity })} />
        <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.05} format={percent} onChange={volume => update({ volume })} />
        <div className="inspector-actions">
          <button className="btn-ghost" onClick={() => update(FULL_FRAME)}>Fill frame</button>
          <button className="btn-ghost" onClick={() => update(PIP_FRAME)}>Picture-in-picture</button>
        </div>
        <div className="surface-note">Drag the clip in the preview to move it; drag its corner to resize.</div>
      </div>
    </Section>}
    <Section title="Crop" defaultOpen={false}>{hasProject ? crop : <div className="surface-note">Import a video first.</div>}</Section>
    <Section title="Compression" defaultOpen={false}>{hasProject ? compression : <div className="surface-note">Import a video first.</div>}</Section>
    <Section title="Deliver">{hasProject ? deliver : <div className="surface-note">Import a video to see export options.</div>}</Section>
  </div>
}
