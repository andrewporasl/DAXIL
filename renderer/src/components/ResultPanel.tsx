import React from 'react'
import type { CompletionEvent } from '@shared/types'
import { formatBytes } from '../lib/sizeEstimator'
import Icon from './Icon'

interface Props {
  result: CompletionEvent
  onOpenFolder: () => void
  onReset: () => void
}

export default function ResultPanel({ result, onOpenFolder, onReset }: Props) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>Export Complete</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 1.02, marginBottom: 4 }}>
          Delivery ready
        </div>
        <div className="surface-note">
          Final output saved locally and ready to open in Finder.
        </div>
      </div>

      <div className="metric-card" style={{ padding: 12 }}>
        <span className="metric-label">Final Size</span>
        <span className="metric-value" style={{ fontSize: 22 }}>{formatBytes(result.outputSizeBytes)}</span>
      </div>

      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>Output File</div>
        <div className="mono-block" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {result.outputPath}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" onClick={onOpenFolder} style={{ flex: 1 }}>
          <Icon name="folder" size={16} />
          <span>Open folder</span>
        </button>
        <button className="btn-ghost" onClick={onReset} style={{ flex: 1 }}>
          <Icon name="reset" size={16} />
          <span>New export</span>
        </button>
      </div>
    </div>
  )
}
