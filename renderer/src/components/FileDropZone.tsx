import React, { useCallback } from 'react'

interface Props {
  onFilePicked: (path: string) => void
  disabled?: boolean
}

export default function FileDropZone({ onFilePicked, disabled }: Props) {
  const handleClick = useCallback(async () => {
    if (disabled) return
    const filePath = await window.electronAPI.openFile()
    if (filePath) onFilePicked(filePath)
  }, [disabled, onFilePicked])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) {
      const p = (file as File & { path?: string }).path
      if (p) onFilePicked(p)
    }
  }, [disabled, onFilePicked])

  return (
    <div
      onClick={handleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
        padding: '22px 16px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s',
        opacity: disabled ? 0.4 : 1
      }}
      onMouseEnter={(e) => {
        if (!disabled) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--text-muted)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 3, color: 'var(--text)', fontSize: 13 }}>
        Select a video
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Click to browse or drag & drop
      </div>
    </div>
  )
}
