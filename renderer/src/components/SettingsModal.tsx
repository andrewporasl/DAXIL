import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../../../../shared/types'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>({
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
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
    if (dir) setSettings((s) => ({ ...s, defaultOutputDir: dir }))
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000
    }} onClick={onClose}>
      <div
        className="card"
        style={{ width: 420, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Settings</div>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div>
          <label>FFmpeg path</label>
          <input
            value={settings.ffmpegPath}
            onChange={(e) => setSettings((s) => ({ ...s, ffmpegPath: e.target.value }))}
            placeholder="ffmpeg"
          />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Leave as "ffmpeg" if it's in your system PATH
          </div>
        </div>

        <div>
          <label>FFprobe path</label>
          <input
            value={settings.ffprobePath}
            onChange={(e) => setSettings((s) => ({ ...s, ffprobePath: e.target.value }))}
            placeholder="ffprobe"
          />
        </div>

        <div>
          <label>Default output folder</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={settings.defaultOutputDir}
              onChange={(e) => setSettings((s) => ({ ...s, defaultOutputDir: e.target.value }))}
              placeholder="Videos folder"
              style={{ flex: 1 }}
            />
            <button className="btn-ghost" onClick={handlePickFolder}>Browse</button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>
            {saved ? '✓ Saved!' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
