import React, { useState } from 'react'
import type { DownloadProgress } from '@shared/types'
import Icon from './Icon'

interface Props {
  busy: boolean
  progress: DownloadProgress | null
  error: string | null
  onAdd: (url: string) => void
  onGif: (url: string) => void
  onCancel: () => void
}

const looksLikeLink = (text: string) => /^\s*https?:\/\/\S+/i.test(text)

// Paste a YouTube, X or other video link: "Add" downloads it onto the timeline,
// "GIF" turns the whole clip straight into a GIF without touching the timeline.
export default function LinkBox({ busy, progress, error, onAdd, onGif, onCancel }: Props) {
  const [value, setValue] = useState('')
  const ready = looksLikeLink(value) && !busy
  const submit = (action: (url: string) => void) => { if (ready) { action(value.trim()); setValue('') } }
  return <div className={`link-box${error ? ' has-error' : ''}`}>
    <div className="link-box-row">
      <input
        className="link-box-input"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(onAdd) } }}
        onPaste={event => { const text = event.clipboardData.getData('text'); if (looksLikeLink(text) && !busy) { event.preventDefault(); setValue(''); onAdd(text.trim()) } }}
        placeholder="Paste a YouTube or X link…"
        aria-label="Video link"
        disabled={busy}
        spellCheck={false}
      />
      <button className="btn-primary link-box-add" onClick={() => submit(onAdd)} disabled={!ready} title="Download and add to the end of the timeline (Enter)">Add</button>
      <button className="btn-ghost link-box-gif" onClick={() => submit(onGif)} disabled={!ready} title="Download and save straight to GIF">GIF</button>
    </div>
    {progress && <div className="link-box-progress" role="status">
      <div className="link-box-bar"><div style={{ width: `${progress.percent ?? 100}%` }} className={progress.percent === null ? 'is-indeterminate' : ''} /></div>
      <span>{progress.message}{progress.percent !== null ? ` ${Math.round(progress.percent)}%` : ''}</span>
      <button className="icon-button" onClick={onCancel} aria-label="Cancel download" title="Cancel download"><Icon name="x" size={12} /></button>
    </div>}
    {error && !progress && <div className="link-box-error" role="alert">{error}</div>}
  </div>
}
