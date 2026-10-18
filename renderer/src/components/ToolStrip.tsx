import React, { useRef } from 'react'
import type { Clip, CropSelection, TextStyle } from '@shared/types'
import { FULL_FRAME, PIP_FRAME } from '../lib/edit'
import { fontFamily, TEXT_FONTS } from '../lib/text'

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

// A small labelled number box. Drag the label left/right to scrub, or type a value.
export function Field({ label, value, min, max, step, suffix, title, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; title?: string; onChange: (value: number) => void
}) {
  const scrub = useRef<{ x: number; value: number } | null>(null)
  const set = (next: number) => { if (Number.isFinite(next)) onChange(clamp(Math.round(next / step) * step, min, max)) }
  return <label className="tool-field" title={title}>
    <span
      className="tool-field-label"
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrub.current = { x: event.clientX, value } }}
      onPointerMove={event => { if (scrub.current) set(scrub.current.value + (event.clientX - scrub.current.x) * step) }}
      onPointerUp={() => { scrub.current = null }}
    >{label}</span>
    <input type="number" value={Math.round(value * 100) / 100} min={min} max={max} step={step} onChange={event => set(Number(event.target.value))} />
    {suffix && <span className="tool-field-suffix">{suffix}</span>}
  </label>
}

// Clip transforms are stored as fractions (0–1); the strip shows them as whole percents.
export function TransformStrip({ clip, onChange }: { clip: Clip | null; onChange: (clip: Clip) => void }) {
  if (!clip) return <div className="tool-strip"><span className="tool-strip-tag">Transform</span><span className="tool-strip-hint">Select a video clip to move or resize it, or a text clip to edit it.</span></div>
  const update = (patch: Partial<Clip>) => onChange({ ...clip, ...patch })
  const pct = (key: 'scale' | 'x' | 'y' | 'opacity' | 'volume', label: string, min: number, max: number, title?: string) =>
    <Field label={label} value={clip[key] * 100} min={min} max={max} step={1} suffix="%" title={title} onChange={value => update({ [key]: value / 100 })} />
  return <div className="tool-strip">
    <span className="tool-strip-tag">Transform · V{clip.track + 1}</span>
    {pct('scale', 'Size', 5, 100)}
    {pct('x', 'X', -50, 100, 'Left edge')}
    {pct('y', 'Y', -50, 100, 'Top edge')}
    {pct('opacity', 'Opacity', 0, 100)}
    <span className="tool-strip-spacer" />
    <button className="tool-chip" onClick={() => update(FULL_FRAME)}>Fill</button>
    <button className="tool-chip" onClick={() => update(PIP_FRAME)} title="Picture-in-picture">Corner</button>
  </div>
}

const TEXT_EFFECTS: Array<{ id: TextStyle['effect']; label: string; title: string }> = [
  { id: 'none', label: 'Plain', title: 'No effect' }, { id: 'shadow', label: 'Shadow', title: 'Soft drop shadow' },
  { id: 'outline', label: 'Outline', title: 'Contrasting outline' }, { id: 'box', label: 'Box', title: 'Dark box behind the text' }
]
const TEXT_ALIGNS: Array<TextStyle['align']> = ['left', 'center', 'right']
const TEXT_SPOTS: Array<{ label: string; title: string; x: number; y: number }> = [
  { label: 'Top', title: 'Centre near the top', x: 0.5, y: 0.14 }, { label: 'Middle', title: 'Centre of the frame', x: 0.5, y: 0.5 }, { label: 'Bottom', title: 'Lower third', x: 0.5, y: 0.82 }
]

// Text clips: what it says, how it looks, where it sits. Size is a percent of the frame height.
export function TextStrip({ clip, onChange }: { clip: Clip; onChange: (clip: Clip) => void }) {
  const style = clip.text!
  const set = (patch: Partial<TextStyle>) => onChange({ ...clip, text: { ...style, ...patch } })
  return <div className="tool-strip text-strip">
    <span className="tool-strip-tag is-text">Text · T{clip.track + 1}</span>
    <textarea className="text-strip-content" value={style.content} rows={Math.min(3, style.content.split('\n').length)} aria-label="Text" placeholder="Type your text"
      onChange={event => set({ content: event.target.value })} />
    <select className="text-strip-font" value={style.font} aria-label="Font" onChange={event => set({ font: event.target.value })} style={{ fontFamily: fontFamily(style.font) }}>
      {TEXT_FONTS.map(font => <option key={font.id} value={font.id} style={{ fontFamily: font.family }}>{font.label}</option>)}
    </select>
    <Field label="Size" value={style.size * 100} min={2} max={40} step={0.5} suffix="%" title="Text height as a percent of the frame" onChange={value => set({ size: value / 100 })} />
    <label className="text-strip-color" title="Text colour"><input type="color" value={style.color} aria-label="Text colour" onChange={event => set({ color: event.target.value })} /></label>
    <div className="tool-segment" role="group" aria-label="Weight and slant">
      <button className={style.bold ? 'is-on' : ''} aria-pressed={style.bold} onClick={() => set({ bold: !style.bold })} title="Bold"><b>B</b></button>
      <button className={style.italic ? 'is-on' : ''} aria-pressed={style.italic} onClick={() => set({ italic: !style.italic })} title="Italic"><i>I</i></button>
    </div>
    <div className="tool-segment" role="radiogroup" aria-label="Alignment">
      {TEXT_ALIGNS.map(align => <button key={align} role="radio" aria-checked={style.align === align} className={style.align === align ? 'is-on' : ''} onClick={() => set({ align })} title={`Align ${align}`}>{align[0].toUpperCase() + align.slice(1)}</button>)}
    </div>
    <div className="tool-segment" role="radiogroup" aria-label="Effect">
      {TEXT_EFFECTS.map(effect => <button key={effect.id} role="radio" aria-checked={style.effect === effect.id} className={style.effect === effect.id ? 'is-on' : ''} onClick={() => set({ effect: effect.id })} title={effect.title}>{effect.label}</button>)}
    </div>
    <Field label="Opacity" value={clip.opacity * 100} min={0} max={100} step={1} suffix="%" onChange={value => onChange({ ...clip, opacity: value / 100 })} />
    <span className="tool-strip-spacer" />
    {TEXT_SPOTS.map(spot => <button key={spot.label} className="tool-chip" title={spot.title} onClick={() => onChange({ ...clip, x: spot.x, y: spot.y })}>{spot.label}</button>)}
  </div>
}

const ASPECTS: Array<{ label: string; ratio: number | null }> = [
  { label: 'Free', ratio: null }, { label: '16:9', ratio: 16 / 9 }, { label: '1:1', ratio: 1 }, { label: '9:16', ratio: 9 / 16 }, { label: '4:5', ratio: 4 / 5 }
]

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)

export function CropStrip({ crop, frameWidth, frameHeight, onChange }: { crop: CropSelection; frameWidth: number; frameHeight: number; onChange: (crop: CropSelection) => void }) {
  // Resize around the current centre so the box doesn't jump.
  const resize = (width: number, height: number) => {
    const w = clamp(even(width), Math.min(32, frameWidth), frameWidth)
    const h = clamp(even(height), Math.min(32, frameHeight), frameHeight)
    const cx = crop.x + crop.width / 2, cy = crop.y + crop.height / 2
    onChange({ enabled: true, width: w, height: h, x: Math.round(clamp(cx - w / 2, 0, frameWidth - w)), y: Math.round(clamp(cy - h / 2, 0, frameHeight - h)) })
  }
  const aspect = (ratio: number) => {
    const w = frameWidth / frameHeight > ratio ? frameHeight * ratio : frameWidth
    const h = w / ratio
    onChange({ enabled: true, width: even(w), height: even(h), x: Math.round((frameWidth - even(w)) / 2), y: Math.round((frameHeight - even(h)) / 2) })
  }
  const current = crop.width / crop.height
  const matched = ASPECTS.find(item => item.ratio !== null && Math.abs(current - item.ratio) < 0.01)
  return <div className="tool-strip">
    <span className="tool-strip-tag is-crop">Crop</span>
    <Field label="W" value={crop.width} min={32} max={frameWidth} step={2} suffix="px" onChange={width => resize(width, crop.height)} />
    <Field label="H" value={crop.height} min={32} max={frameHeight} step={2} suffix="px" onChange={height => resize(crop.width, height)} />
    <div className="tool-segment" role="group" aria-label="Aspect ratio">
      {ASPECTS.map(item => <button key={item.label}
        className={(matched ?? ASPECTS[0]) === item ? 'is-on' : ''}
        onClick={() => item.ratio === null ? onChange({ ...crop, enabled: true }) : aspect(item.ratio)}>{item.label}</button>)}
    </div>
    <span className="tool-strip-spacer" />
    <button className="tool-chip" onClick={() => onChange({ ...crop, enabled: true, x: Math.round((frameWidth - crop.width) / 2), y: Math.round((frameHeight - crop.height) / 2) })}>Center</button>
    <button className="tool-chip" onClick={() => onChange({ enabled: false, x: 0, y: 0, width: frameWidth, height: frameHeight })} title="Remove the crop">Reset</button>
  </div>
}
