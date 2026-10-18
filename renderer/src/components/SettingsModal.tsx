import React, { useState, useEffect } from 'react'
import type { AppSettings, StorageLocation } from '@shared/types'
import Icon from './Icon'
import { updateSummary, useUpdateStatus } from '../lib/updates'

interface Props {
  onClose: () => void
}

type Tab = 'general' | 'storage' | 'advanced'

// Storage shows only what lives outside the install folder (what an uninstall leaves behind);
// tool and settings-file locations are under Advanced.
const OUTSIDE_KEYS = ['appdata', 'downloads', 'scratch', 'exports', 'conversions']
const ADVANCED_KEYS = ['settings', 'ytdlp', 'ffmpeg', 'ffprobe']

function StorageList({ items }: { items: StorageLocation[] }) {
  return <div className="storage-list">
    {items.map(item => <div key={item.key} className="storage-row">
      <div className="storage-text">
        <div className="storage-label">{item.label}</div>
        <div className="storage-path" title={item.path}>{item.path}</div>
        <div className="storage-note">{item.note}</div>
      </div>
      <button className="icon-button" onClick={() => void window.electronAPI.revealStorage(item.key)} disabled={!item.exists}
        aria-label={`Open ${item.label}`} title={item.exists ? 'Open in file explorer' : 'Not there yet'}><Icon name="folder" size={14} /></button>
    </div>)}
  </div>
}

// Current version, update state and the one action that fits it.
function UpdatesField({ auto, onAutoChange }: { auto: boolean; onAutoChange: (value: boolean) => void }) {
  const status = useUpdateStatus()
  if (!status) return null
  const api = window.electronAPI
  const busy = status.state === 'checking' || status.state === 'downloading'
  let action: React.ReactNode = <button className="btn-ghost" onClick={() => void api.checkForUpdates()} disabled={busy}>{status.state === 'checking' ? 'Checking…' : 'Check now'}</button>
  if (status.state === 'available' && status.mode === 'auto') action = <button className="btn-primary" onClick={() => void api.downloadUpdate()}>Download {status.version}</button>
  else if (status.state === 'available' && status.mode === 'manual') action = <button className="btn-primary" onClick={() => void api.openReleasePage()}>Get {status.version}</button>
  else if (status.state === 'ready') action = <button className="btn-primary" onClick={() => void api.installUpdate()}>Restart and update</button>
  return <div className="settings-field update-field">
    <label>Updates</label>
    <div className="update-row">
      <div className="update-text">
        <b>DAXIL {status.current}</b>
        <span className={status.state === 'error' ? 'is-error' : ''} role="status">{updateSummary(status)}</span>
      </div>
      {action}
    </div>
    {status.state === 'downloading' && <div className="update-bar"><div style={{ width: `${status.percent ?? 0}%` }} /></div>}
    <label className="settings-check"><input type="checkbox" checked={auto} onChange={event => onAutoChange(event.target.checked)} /> Check for updates when DAXIL starts</label>
  </div>
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>({ ffmpegPath: 'auto', ffprobePath: 'auto', ytDlpPath: 'auto', defaultOutputDir: '' })
  const [tab, setTab] = useState<Tab>('general')
  const [saved, setSaved] = useState(false)
  const [storage, setStorage] = useState<StorageLocation[]>([])
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.getStorage().then(setStorage).catch(() => setStorage([]))
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleUpdateTool = async () => {
    setUpdating(true); setToolStatus(null)
    try { setToolStatus(await window.electronAPI.updateDownloader()) }
    catch (error) { setToolStatus(error instanceof Error ? error.message : String(error)) }
    finally { setUpdating(false) }
  }
  const handleSave = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  const handlePickFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) setSettings(state => ({ ...state, defaultOutputDir: dir }))
  }
  const handlePickConvertFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) setSettings(state => ({ ...state, convertOutputDir: dir }))
  }
  const pick = (keys: string[]) => keys.map(key => storage.find(item => item.key === key)).filter((item): item is StorageLocation => Boolean(item))

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-window" role="dialog" aria-label="Settings" onClick={event => event.stopPropagation()}>
        <div className="settings-head">
          <b>Settings</b>
          <button className="icon-button" onClick={onClose} aria-label="Close settings" title="Close (Esc)"><Icon name="x" size={14} /></button>
        </div>

        <div className="settings-tabs" role="tablist">
          {(['general', 'storage', 'advanced'] as Tab[]).map(item => <button key={item} role="tab" aria-selected={tab === item}
            className={tab === item ? 'is-on' : ''} onClick={() => setTab(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>

        <div className="settings-body">
          {tab === 'general' && <>
            <div className="settings-field">
              <label>Export folder</label>
              <div className="settings-input-row">
                <input value={settings.defaultOutputDir} onChange={event => setSettings(state => ({ ...state, defaultOutputDir: event.target.value }))} placeholder="Videos folder" />
                <button className="icon-button" onClick={handlePickFolder} aria-label="Browse export folder" title="Browse"><Icon name="folder" size={14} /></button>
              </div>
              <div className="settings-hint">Where the save dialog opens when you export your project.</div>
            </div>
            <div className="settings-field">
              <label>Converted links folder</label>
              <div className="settings-input-row">
                <input value={settings.convertOutputDir ?? ''} onChange={event => setSettings(state => ({ ...state, convertOutputDir: event.target.value }))} placeholder="Downloads folder" />
                <button className="icon-button" onClick={handlePickConvertFolder} aria-label="Browse converted links folder" title="Browse"><Icon name="folder" size={14} /></button>
              </div>
              <div className="settings-hint">Where <b>Convert and save</b> puts files made straight from a link, kept apart from your project exports. Existing files are never overwritten.</div>
            </div>
            <UpdatesField auto={settings.checkForUpdates !== false} onAutoChange={value => {
              setSettings(state => ({ ...state, checkForUpdates: value }))
              void window.electronAPI.saveSettings({ checkForUpdates: value })
            }} />
          </>}

          {tab === 'storage' && <>
            <div className="settings-hint">Everything DAXIL keeps outside its install folder. After uninstalling, delete <b>App data</b> to remove it all; temporary files clean themselves up.</div>
            <StorageList items={pick(OUTSIDE_KEYS)} />
          </>}

          {tab === 'advanced' && <>
            <div className="settings-field">
              <label>FFmpeg</label>
              <input value={settings.ffmpegPath} onChange={event => setSettings(state => ({ ...state, ffmpegPath: event.target.value }))} placeholder="auto" />
            </div>
            <div className="settings-field">
              <label>FFprobe</label>
              <input value={settings.ffprobePath} onChange={event => setSettings(state => ({ ...state, ffprobePath: event.target.value }))} placeholder="auto" />
            </div>
            <div className="settings-field">
              <label>yt-dlp</label>
              <div className="settings-input-row">
                <input value={settings.ytDlpPath} onChange={event => setSettings(state => ({ ...state, ytDlpPath: event.target.value }))} placeholder="auto" />
                <button className="btn-ghost" onClick={handleUpdateTool} disabled={updating} title="Fetch the newest yt-dlp release">{updating ? 'Updating…' : 'Update'}</button>
              </div>
              <div className="settings-hint">{toolStatus ?? '`auto` uses the bundled FFmpeg and FFprobe, and downloads yt-dlp on first use. Enter a path to use your own.'}</div>
            </div>
            <StorageList items={pick(ADVANCED_KEYS)} />
          </>}
        </div>

        {tab !== 'storage' && <div className="settings-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>{saved ? 'Saved' : 'Save'}</button>
        </div>}
      </div>
    </div>
  )
}
