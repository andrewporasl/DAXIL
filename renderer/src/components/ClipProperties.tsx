import React from 'react'
import type { Clip, MediaAsset } from '@shared/types'
import { clipSpeed, dbToGain, gainToDb, MAX_CLIP_SPEED, MAX_VOLUME_DB, MIN_CLIP_SPEED, MIN_VOLUME_DB } from '@shared/exportPlan'
import { clipLength } from '../lib/edit'
import { assetName } from '../lib/media'
import { formatDuration } from '../lib/sizeEstimator'
import { Field } from './ToolStrip'

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4]
const trackLabel = (clip: Clip) => `${clip.kind === 'video' ? 'V' : clip.kind === 'audio' ? 'A' : 'T'}${clip.track + 1}`
const seconds = (value: number) => `${value.toFixed(2)} s`
const times = (value: number) => `${Number(value.toFixed(3))}×`

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="prop-row"><span className="prop-label">{label}</span><div className="prop-value">{children}</div></div>
}

// Properties of one selected clip (one piece of a split, say). Speed, sound and placement set
// here apply to that clip only; the project speed in the toolbar multiplies on top.
export default function ClipProperties({ clips, media, selectedIds, projectRate, onChange }: {
  clips: Clip[]; media: MediaAsset[]; selectedIds: string[]; projectRate: number; onChange: (clip: Clip) => void
}) {
  const selected = clips.filter(clip => selectedIds.includes(clip.id))
  if (selected.length !== 1) {
    return <div className="surface-note">{selected.length ? `${selected.length} clips selected. Select one clip to see its properties.` : 'Select a clip on the timeline to see its properties. Split a clip (S) to give part of it its own speed or volume.'}</div>
  }
  const clip = selected[0]
  const asset = media.find(item => item.id === clip.mediaId)
  const meta = asset?.metadata
  const update = (patch: Partial<Clip>) => onChange({ ...clip, ...patch })
  const speed = clipSpeed(clip)
  const setSpeed = (value: number) => {
    const next = Math.max(MIN_CLIP_SPEED, Math.min(MAX_CLIP_SPEED, value))
    update({ speed: Math.abs(next - 1) < 1e-6 ? undefined : next })
  }

  if (clip.kind === 'text') {
    return <div className="clip-properties">
      <div className="clip-properties-head"><span className="clip-kind is-text">{trackLabel(clip)}</span><b>{clip.text?.content.replace(/\s+/g, ' ').trim() || 'Text'}</b></div>
      <Row label="Starts">{formatDuration(clip.timelineStart)}</Row>
      <Row label="Length">{seconds(clipLength(clip))}</Row>
      <div className="surface-note">Edit the words, font and style in the text bar under the preview.</div>
    </div>
  }

  const hasSound = clip.kind === 'audio' || (meta?.audioCodec ?? 'none') !== 'none'
  const db = Math.max(MIN_VOLUME_DB, gainToDb(clip.volume))
  const setDb = (value: number) => {
    const next = Math.round(Math.max(MIN_VOLUME_DB, Math.min(MAX_VOLUME_DB, value)) * 10) / 10
    update({ volume: Math.abs(next) < 0.05 ? 1 : dbToGain(next) })
  }
  const dbText = db <= MIN_VOLUME_DB ? 'Silent' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)} dB`
  const overall = speed * projectRate
  return <div className="clip-properties">
    <div className="clip-properties-head">
      <span className={`clip-kind is-${clip.kind}`}>{trackLabel(clip)}</span>
      <b title={assetName(asset)}>{assetName(asset, 'Clip')}</b>
    </div>
    {meta && <div className="clip-properties-source">
      {clip.kind === 'video' && <span>{meta.width}×{meta.height}</span>}
      {clip.kind === 'video' && meta.fps > 0 && <span>{Number(meta.fps.toFixed(2))} fps</span>}
      {clip.kind === 'video' && <span>{meta.videoCodec}</span>}
      {hasSound && <span>{meta.audioCodec}</span>}
      <span>{formatDuration(meta.durationSeconds)} source</span>
    </div>}

    <div className="clip-properties-group">Timing</div>
    <Row label="In / out">{seconds(clip.startSeconds)} – {seconds(clip.endSeconds)}</Row>
    <Row label="Length">{seconds(clipLength(clip))}{speed !== 1 && <span className="prop-dim">from {seconds(clip.endSeconds - clip.startSeconds)} of source</span>}</Row>
    <Row label="Speed">
      <div className="prop-segment" role="radiogroup" aria-label="Clip speed">
        {SPEEDS.map(value => <button key={value} role="radio" aria-checked={Math.abs(speed - value) < 1e-6} className={Math.abs(speed - value) < 1e-6 ? 'is-on' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}
      </div>
    </Row>
    <Row label="">
      <Field label="Custom" value={speed * 100} min={MIN_CLIP_SPEED * 100} max={MAX_CLIP_SPEED * 100} step={5} suffix="%" title="This clip's speed as a percent of normal" onChange={value => setSpeed(value / 100)} />
    </Row>
    {projectRate !== 1 && <div className="clip-properties-note">Plays at <b>{times(overall)}</b>: this clip's {times(speed)} × the project's {times(projectRate)}.</div>}

    {clip.kind === 'video' && <>
      <div className="clip-properties-group">Picture</div>
      <div className="clip-properties-fields">
        <Field label="Size" value={clip.scale * 100} min={5} max={100} step={1} suffix="%" onChange={value => update({ scale: value / 100 })} />
        <Field label="Opacity" value={clip.opacity * 100} min={0} max={100} step={1} suffix="%" onChange={value => update({ opacity: value / 100 })} />
        <Field label="X" value={clip.x * 100} min={-50} max={100} step={1} suffix="%" title="Left edge" onChange={value => update({ x: value / 100 })} />
        <Field label="Y" value={clip.y * 100} min={-50} max={100} step={1} suffix="%" title="Top edge" onChange={value => update({ y: value / 100 })} />
      </div>
    </>}

    <div className="clip-properties-group">Sound</div>
    {hasSound ? <>
      <Row label="Gain">
        <input className="clip-volume" type="range" min={MIN_VOLUME_DB} max={MAX_VOLUME_DB} step={0.5} value={db} aria-label="Clip gain in decibels" disabled={clip.muted}
          onChange={event => setDb(Number(event.target.value))} />
        <span className="prop-dim clip-volume-value">{dbText}</span>
      </Row>
      <Row label="">
        <div className="tool-segment" role="group" aria-label="Adjust gain">
          <button onClick={() => setDb(db - 3)} disabled={clip.muted} title="Quieter by 3 dB">−3 dB</button>
          <button onClick={() => setDb(0)} disabled={clip.muted} className={Math.abs(db) < 0.05 ? 'is-on' : ''} title="Original level">0 dB</button>
          <button onClick={() => setDb(db + 3)} disabled={clip.muted} title="Louder by 3 dB">+3 dB</button>
        </div>
      </Row>
      <Row label="">
        <label className="settings-check clip-mute"><input type="checkbox" checked={clip.muted} onChange={event => update({ muted: event.target.checked })} /> Mute this clip</label>
      </Row>
    </> : <div className="surface-note">This clip's source has no sound.</div>}
  </div>
}
