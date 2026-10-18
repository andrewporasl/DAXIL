import React, { useState } from 'react'
import type { DownloadProgress } from '@shared/types'
import Icon from './Icon'
import { LINK_SITE_EXAMPLES, LINK_SITE_GROUPS } from '../lib/linkSites'

interface Props {
  busy: boolean
  progress: DownloadProgress | null
  error: string | null
  onAdd: (url: string) => void
  onGif: (url: string) => void
  onCancel: () => void
}

const looksLikeLink = (text: string) => /^\s*https?:\/\/\S+/i.test(text)

// Paste a link from almost any video, social or music site (anything yt-dlp reads): "Add" downloads
// it onto the timeline, "GIF" turns the whole clip straight into a GIF without touching the timeline.
// Downloads are temporary; see App's forgetDownloads and main/tempDownloads.
export default function LinkBox({ busy, progress, error, onAdd, onGif, onCancel }: Props) {
  const [value, setValue] = useState('')
  const [showSites, setShowSites] = useState(false)
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
        placeholder="Paste a link…"
        aria-label="Video or audio link"
        disabled={busy}
        spellCheck={false}
      />
      <button className="btn-primary link-box-add" onClick={() => submit(onAdd)} disabled={!ready} title="Add to the media pool, or convert it straight to a file (Enter)">Add</button>
      <button className="btn-ghost link-box-gif" onClick={() => submit(onGif)} disabled={!ready} title="Download and save straight to GIF">GIF</button>
    </div>
    {!progress && !error && <button className="link-box-hint" onClick={() => setShowSites(!showSites)} aria-expanded={showSites}>
      <span>{LINK_SITE_EXAMPLES} + 1,000 more</span>
      <b>{showSites ? 'Hide' : 'What works?'}</b>
    </button>}
    {showSites && <div className="link-sites" role="note">
      {LINK_SITE_GROUPS.map(group => <div key={group.label}>
        <div className="link-sites-label">{group.label}</div>
        <div className="link-sites-chips">{group.sites.map(site => <span key={site}>{site}</span>)}</div>
      </div>)}
      <p>Almost any public video or audio post works. Private, paid or DRM content won't.</p>
      <p>Downloads are temporary: they're deleted when you remove them, when you close the window, or after export if you choose.</p>
    </div>}
    {progress && <div className="link-box-progress" role="status">
      <div className="link-box-bar"><div style={{ width: `${progress.percent ?? 100}%` }} className={progress.percent === null ? 'is-indeterminate' : ''} /></div>
      <span>{progress.message}{progress.percent !== null ? ` ${Math.round(progress.percent)}%` : ''}</span>
      <button className="icon-button" onClick={onCancel} aria-label="Cancel download" title="Cancel download"><Icon name="x" size={12} /></button>
    </div>}
    {error && !progress && <div className="link-box-error" role="alert">{error}</div>}
  </div>
}
