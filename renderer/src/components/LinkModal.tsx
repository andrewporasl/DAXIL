import React, { useEffect, useRef, useState } from 'react'
import type { AppSettings, ExportMode } from '@shared/types'
import { convertDirFor } from '@shared/convertDir'
import Icon from './Icon'

const FORMATS: Array<{ mode: ExportMode; label: string; note: string; ext: string }> = [
  { mode: 'video', label: 'MP4', note: 'Video with sound', ext: '.mp4' },
  { mode: 'audio', label: 'MP3', note: 'Sound only', ext: '.mp3' },
  { mode: 'gif', label: 'GIF', note: 'Looping, no sound', ext: '.gif' }
]

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

type Dirs = Pick<AppSettings, 'convertOutputDir' | 'mp3OutputDir'>

// Asked whenever a link arrives: bring it into the project to edit, or just convert it and save.
// Converting asks for a file name first; `quick` (the link box's GIF button) skips straight to that.
export default function LinkModal({ url, defaultFormat, quick, onPool, onConvert, onClose }: {
  url: string; defaultFormat: ExportMode; quick?: ExportMode
  onPool: () => void; onConvert: (mode: ExportMode, name: string) => void; onClose: () => void
}) {
  const [step, setStep] = useState<'choose' | 'name'>(quick ? 'name' : 'choose')
  const [format, setFormat] = useState<ExportMode>(quick ?? defaultFormat)
  const [name, setName] = useState('')
  const [dirs, setDirs] = useState<Dirs>({})
  const poolButton = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (step === 'choose') poolButton.current?.focus() }, [step])
  useEffect(() => {
    let live = true
    window.electronAPI.getSettings().then(settings => { if (live) setDirs({ convertOutputDir: settings.convertOutputDir, mp3OutputDir: settings.mp3OutputDir }) }).catch(() => {})
    return () => { live = false }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const chosen = FORMATS.find(item => item.mode === format) ?? FORMATS[0]
  const folder = convertDirFor(format, dirs, '') || 'Your Downloads folder'
  const mp3Folder = convertDirFor('audio', dirs, '') || 'Your Downloads folder'
  const changeMp3Folder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) {
      await window.electronAPI.saveSettings({ mp3OutputDir: dir })
      setDirs(state => ({ ...state, mp3OutputDir: dir }))
    }
    nameInput.current?.focus()
  }

  return <div className="settings-backdrop" onClick={onClose}>
    <div className="link-modal" role="dialog" aria-label="What to do with this link" onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation() /* the timeline's shortcuts must not see keys typed here */}>
      <div className="settings-head">
        <div className="link-modal-title">
          <b>Download from {hostOf(url)}</b>
          <span title={url}>{url}</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" size={14} /></button>
      </div>
      {step === 'choose' && <div className="link-modal-choices">
        <button ref={poolButton} className="link-choice" onClick={onPool}>
          <span className="link-choice-icon"><Icon name="video" size={20} /></span>
          <b>Add to media pool</b>
          <span>Download it into this project to cut, stack and edit. It's added to the end of the timeline.</span>
          <span className="link-choice-key">Enter</span>
        </button>
        <div className="link-choice is-convert">
          <span className="link-choice-icon"><Icon name="export" size={20} /></span>
          <b>Convert and save</b>
          <span>Download it and save it straight to a file. Nothing is added to your project.</span>
          <div className="prop-segment link-choice-formats" role="radiogroup" aria-label="Convert to">
            {FORMATS.map(item => <button key={item.mode} role="radio" aria-checked={format === item.mode} className={format === item.mode ? 'is-on' : ''}
              onClick={() => setFormat(item.mode)} title={item.note}>{item.label}</button>)}
          </div>
          <button className="btn-primary link-choice-go" onClick={() => setStep('name')}>
            <Icon name="export" size={13} /><span>Save as {chosen.label}</span>
          </button>
        </div>
      </div>}
      {step === 'name' && <form className="link-name-step" onSubmit={event => { event.preventDefault(); onConvert(format, name) }}>
        <b className="link-name-title">Name your {chosen.label}</b>
        <div className="link-name-row">
          <input ref={nameInput} className="link-name-input" autoFocus value={name} onChange={event => setName(event.target.value)}
            placeholder="clip" maxLength={120} aria-label="File name" spellCheck={false} />
          <span className="link-name-ext">{chosen.ext}</span>
        </div>
        <div className="link-name-where">
          <span className="link-name-folder" title={folder}>Saves to {folder}</span>
          {format === 'audio' && <button type="button" className="btn-ghost link-name-change" onClick={() => void changeMp3Folder()}>Change…</button>}
        </div>
        {format !== 'audio' && mp3Folder !== folder && <div className="link-name-hint" title={mp3Folder}>If this link only has sound, it's saved as an MP3 to {mp3Folder}.</div>}
        <div className="link-name-hint">Leave it empty to use a generic name. Existing files are never overwritten.</div>
        <div className="link-name-actions">
          <button type="button" className="btn-ghost link-name-back" onClick={() => quick ? onClose() : setStep('choose')}>Back</button>
          <button type="submit" className="btn-primary link-name-save"><Icon name="export" size={13} /><span>Save</span></button>
        </div>
      </form>}
      <div className="link-modal-foot">The downloaded original is temporary. MP4 and GIF go to your Converted links folder; MP3s go to your MP3 folder. Both are set in Settings.</div>
    </div>
  </div>
}
