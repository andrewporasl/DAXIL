import React, { useState, useEffect } from 'react'
import type { AppSettings } from '@shared/types'
import Icon from './Icon'
import brandIcon from '../../../resources/icon.png'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    ffmpegPath: 'auto',
    ffprobePath: 'auto',
    defaultOutputDir: ''
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
  }, [])

  const handleSave = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const handlePickFolder = async () => {
    const dir = await window.electronAPI.openFolderDialog()
    if (dir) setSettings((state) => ({ ...state, defaultOutputDir: dir }))
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 10, 16, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000
      }}
    >
      <div
        className="card"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div className="brand-lockup">
            <img src={brandIcon} alt="" className="settings-mark" />
            <div className="brand-copy">
              <div className="section-title" style={{ marginBottom: 8 }}>Preferences</div>
              <div className="brand-modal-title">
                DAXIL SETTINGS
              </div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings" title="Close settings">
            <Icon name="x" />
          </button>
        </div>

        <div>
          <label>FFmpeg path</label>
          <input
            value={settings.ffmpegPath}
            onChange={(event) => setSettings((state) => ({ ...state, ffmpegPath: event.target.value }))}
            placeholder="auto"
          />
          <div className="surface-note" style={{ marginTop: 6 }}>
            Leave this as `auto` to use the bundled FFmpeg in release builds, or enter a custom path to override it.
          </div>
        </div>

        <div>
          <label>FFprobe path</label>
          <input
            value={settings.ffprobePath}
            onChange={(event) => setSettings((state) => ({ ...state, ffprobePath: event.target.value }))}
            placeholder="auto"
          />
          <div className="surface-note" style={{ marginTop: 6 }}>
            `auto` uses the bundled FFprobe when available.
          </div>
        </div>

        <div>
          <label>Default output folder</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={settings.defaultOutputDir}
              onChange={(event) => setSettings((state) => ({ ...state, defaultOutputDir: event.target.value }))}
              placeholder="Videos folder"
              style={{ flex: 1 }}
            />
            <button className="icon-button" onClick={handlePickFolder} aria-label="Browse default output folder" title="Browse default output folder">
              <Icon name="folder" />
            </button>
          </div>
        </div>

        <div className="panel-divider" />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>
            {saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
