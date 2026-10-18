import React, { useEffect, useRef, useState } from 'react'
import type { MediaAsset, Project } from '@shared/types'

const PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: 'Landscape 1080p', width: 1920, height: 1080 },
  { label: 'Landscape 720p', width: 1280, height: 720 },
  { label: 'Portrait (phone)', width: 1080, height: 1920 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Portrait 4:5', width: 1080, height: 1350 }
]

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

function ratioLabel(width: number, height: number): string {
  const r = width / height
  const known: Array<[number, string]> = [[16 / 9, '16:9'], [9 / 16, '9:16'], [1, '1:1'], [4 / 5, '4:5'], [4 / 3, '4:3'], [21 / 9, '21:9']]
  return known.find(([value]) => Math.abs(r - value) < 0.02)?.[1] ?? `${width}×${height}`
}

// The canvas is the output frame. It starts at the first video's size and can be changed any time.
export default function CanvasMenu({ project, media, disabled, onChange }: {
  project: Project | null; media: MediaAsset[]; disabled: boolean; onChange: (project: Project) => void
}) {
  const [open, setOpen] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null)
  const [custom, setCustom] = useState({ width: 0, height: 0 })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  if (!project) return null

  const pick = (width: number, height: number) => {
    onChange({ ...project, width: even(width), height: even(height) })
    setOpen(null)
  }
  const isCurrent = (width: number, height: number) => even(width) === project.width && even(height) === project.height
  const videos = media.filter(asset => asset.kind === 'video' && asset.metadata.width > 0)

  return <div className="canvas-menu" ref={ref}>
    <button className={`canvas-button${open ? ' is-on' : ''}`} disabled={disabled} aria-expanded={Boolean(open)} aria-haspopup="menu"
      onClick={event => {
        // Fixed position so a scrolling toolbar can't clip the menu.
        const rect = event.currentTarget.getBoundingClientRect()
        setCustom({ width: project.width, height: project.height })
        setOpen(open ? null : { left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(160, rect.top - 16) })
      }}
      title={`Canvas: ${project.width} × ${project.height}. Click to change.`}>
      <span className="canvas-glyph" style={{ aspectRatio: `${project.width} / ${project.height}` }} />
      <span className="canvas-button-text">{ratioLabel(project.width, project.height)}</span>
    </button>
    {open && <div className="canvas-popover" role="menu" style={open}>
      <div className="canvas-popover-title">Canvas size</div>
      {PRESETS.map(preset => <button key={preset.label} role="menuitemradio" aria-checked={isCurrent(preset.width, preset.height)}
        className={isCurrent(preset.width, preset.height) ? 'is-on' : ''} onClick={() => pick(preset.width, preset.height)}>
        <span className="canvas-glyph" style={{ aspectRatio: `${preset.width} / ${preset.height}` }} />
        <span>{preset.label}</span><small>{preset.width}×{preset.height}</small>
      </button>)}
      {videos.length > 0 && <>
        <div className="canvas-popover-title">Match a clip</div>
        {videos.map(asset => <button key={asset.id} role="menuitemradio" aria-checked={isCurrent(asset.metadata.width, asset.metadata.height)}
          className={isCurrent(asset.metadata.width, asset.metadata.height) ? 'is-on' : ''} onClick={() => pick(asset.metadata.width, asset.metadata.height)}>
          <span className="canvas-glyph" style={{ aspectRatio: `${asset.metadata.width} / ${asset.metadata.height}` }} />
          <span className="canvas-clip-name">{asset.name ?? asset.metadata.fileName}</span><small>{asset.metadata.width}×{asset.metadata.height}</small>
        </button>)}
      </>}
      <div className="canvas-popover-title">Custom</div>
      <form className="canvas-custom" onSubmit={event => { event.preventDefault(); if (custom.width >= 16 && custom.height >= 16) pick(custom.width, custom.height) }}>
        <input type="number" min={16} max={7680} value={custom.width} aria-label="Canvas width" onChange={event => setCustom({ ...custom, width: Number(event.target.value) })} />
        <span>×</span>
        <input type="number" min={16} max={7680} value={custom.height} aria-label="Canvas height" onChange={event => setCustom({ ...custom, height: Number(event.target.value) })} />
        <button type="submit" className="tool-chip">Set</button>
      </form>
    </div>}
  </div>
}
