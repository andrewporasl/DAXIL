import React, { useCallback, useState } from 'react'

interface Props {
  onFilePicked: (path: string) => void
  disabled?: boolean
}

export default function FileDropZone({ onFilePicked, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)

  const handleClick = useCallback(async () => {
    if (disabled) return
    const filePath = await window.electronAPI.openFile()
    if (filePath) onFilePicked(filePath)
  }, [disabled, onFilePicked])

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files[0]
    if (!file) return
    const filePath = (file as File & { path?: string }).path
    if (filePath) onFilePicked(filePath)
  }, [disabled, onFilePicked])

  return (
    <div
      onClick={handleClick}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `1px solid ${isDragging ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius)',
        background: isDragging ? 'var(--accent-soft)' : 'var(--panel)',
        padding: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background-color 0.18s ease, border-color 0.18s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div className="section-title">Source Clip</div>
        <div className={`badge ${isDragging ? 'badge-accent' : ''}`}>
          {disabled ? 'Busy' : isDragging ? 'Drop file' : 'Local only'}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 0.96, marginBottom: 8 }}>
        Load footage
      </div>
      <div className="surface-note" style={{ marginBottom: 14 }}>
        Click to browse or drag a file directly into the editor.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {['MP4', 'MOV', 'MKV', 'WEBM'].map((label) => (
          <div key={label} className="badge">{label}</div>
        ))}
      </div>
    </div>
  )
}
