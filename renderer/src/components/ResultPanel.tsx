import React from 'react'
import type { CompletionEvent } from '../../../../shared/types'
import { formatBytes } from '../lib/sizeEstimator'

interface Props {
  result: CompletionEvent
  onOpenFolder: () => void
  onReset: () => void
}

export default function ResultPanel({ result, onOpenFolder, onReset }: Props) {
  return (
    <div className="card" style={{ borderColor: 'var(--border)' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--success)' }}>
        Export complete
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>Output file</div>
      <div style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--text-muted)', marginBottom: 10 }}>
        {result.outputPath}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Final size</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{formatBytes(result.outputSizeBytes)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" onClick={onOpenFolder} style={{ flex: 1 }}>
          Open folder
        </button>
        <button className="btn-ghost" onClick={onReset} style={{ flex: 1 }}>
          New export
        </button>
      </div>
    </div>
  )
}
