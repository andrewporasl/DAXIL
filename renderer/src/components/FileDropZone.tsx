import React, { useCallback, useState } from 'react'

interface Props {
  onFilePicked: (path: string) => void
  disabled?: boolean
  hasVideo?: boolean
}

export default function FileDropZone({ onFilePicked, disabled, hasVideo }: Props) {
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

  const label = disabled
    ? 'Working on current clip'
    : isDragging
      ? 'Drop video to load'
      : hasVideo
        ? 'Add or replace video'
        : 'Add video'

  const note = disabled
    ? 'Please wait until the current task finishes.'
    : isDragging
      ? 'Release to load this file into the editor.'
      : hasVideo
        ? 'Click the plus or drop another file here.'
        : 'Click the plus or drop a local video here.'

  return (
    <div
      className="dropzone-simple"
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <button
        type="button"
        className={`dropzone-plate ${isDragging ? 'is-dragging' : ''}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
      >
        <span className="dropzone-plus">{isDragging ? '×' : '+'}</span>
      </button>

      <div className="dropzone-label">{label}</div>
      <div className="dropzone-note">{note}</div>
    </div>
  )
}
