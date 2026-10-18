import React, { useEffect, useRef, useState } from 'react'
import type { ExportMode } from '@shared/types'
import Icon from './Icon'

const FORMATS: Array<{ mode: ExportMode; label: string; note: string }> = [
  { mode: 'video', label: 'MP4', note: 'Video with sound' },
  { mode: 'audio', label: 'MP3', note: 'Sound only' },
  { mode: 'gif', label: 'GIF', note: 'Looping, no sound' }
]

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// Asked whenever a link arrives: bring it into the project to edit, or just convert it and save.
export default function LinkModal({ url, defaultFormat, onPool, onConvert, onClose }: {
  url: string; defaultFormat: ExportMode
  onPool: () => void; onConvert: (mode: ExportMode) => void; onClose: () => void
}) {
  const [format, setFormat] = useState<ExportMode>(defaultFormat)
  const poolButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { poolButton.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return <div className="settings-backdrop" onClick={onClose}>
    <div className="link-modal" role="dialog" aria-label="What to do with this link" onClick={event => event.stopPropagation()}>
      <div className="settings-head">
        <div className="link-modal-title">
          <b>Download from {hostOf(url)}</b>
          <span title={url}>{url}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" size={14} /></button>
      </div>
      <div className="link-modal-choices">
        <button ref={poolButton} className="link-choice" onClick={onPool}>
          <span className="link-choice-icon"><Icon name="video" size={20} /></span>
          <b>Add to media pool</b>
          <span>Download it into this project to cut, stack and edit. It's added to the end of the timeline.</span>
          <span className="link-choice-key">Enter</span>
        </button>
        <div className="link-choice is-convert">
          <span className="link-choice-icon"><Icon name="export" size={20} /></span>
          <b>Convert and save</b>
          <span>Download it and save it straight to a file. Your project isn't touched.</span>
          <div className="prop-segment link-choice-formats" role="radiogroup" aria-label="Convert to">
            {FORMATS.map(item => <button key={item.mode} role="radio" aria-checked={format === item.mode} className={format === item.mode ? 'is-on' : ''}
              onClick={() => setFormat(item.mode)} title={item.note}>{item.label}</button>)}
          </div>
          <button className="btn-primary link-choice-go" onClick={() => onConvert(format)}>
            <Icon name="export" size={13} /><span>Save as {FORMATS.find(item => item.mode === format)?.label}</span>
          </button>
        </div>
      </div>
      <div className="link-modal-foot">The downloaded original is temporary. Converted files go to your Converted links folder (Settings) and are kept.</div>
    </div>
  </div>
}
