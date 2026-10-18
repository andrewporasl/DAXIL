import React, { useEffect } from 'react'
import { formatBytes, formatDuration } from '../lib/sizeEstimator'
import Icon from './Icon'

export interface VideoPreview {
  path: string
  sizeBytes: number
  start: number
  end: number
  width: number
  height: number
  quality: string
}

// Plays a short real export (same crop, canvas, compression and speed as the final file).
export default function PreviewModal({ preview, onClose, onExport }: { preview: VideoPreview; onClose: () => void; onExport: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="preview-modal-backdrop" onClick={onClose}>
    <div className="preview-modal" role="dialog" aria-label="Export preview" onClick={event => event.stopPropagation()}>
      <div className="preview-modal-head">
        <div>
          <div className="preview-modal-title">Preview</div>
          <div className="preview-modal-sub">{formatDuration(preview.start)}–{formatDuration(preview.end)} · exactly how the export will look</div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close preview"><Icon name="x" /></button>
      </div>
      <div className="preview-modal-stage">
        <video key={preview.path} className="preview-modal-video" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
          src={`safe-file://video?path=${encodeURIComponent(preview.path)}`} autoPlay loop controls playsInline />
      </div>
      <div className="preview-modal-foot">
        <span className="preview-chip">{preview.width} × {preview.height}</span>
        <span className="preview-chip">{preview.quality}</span>
        <span className="preview-chip">This clip: {formatBytes(preview.sizeBytes)}</span>
        <span className="tool-strip-spacer" />
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={() => { onClose(); onExport() }}><Icon name="export" size={14} /><span>Export full video</span></button>
      </div>
    </div>
  </div>
}
