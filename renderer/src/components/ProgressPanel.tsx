import React, { useRef, useEffect } from 'react'
import type { ProgressEvent } from '../../../../shared/types'

interface Props {
  progress: ProgressEvent | null
  logLines: string[]
  onCancel: () => void
  exporting: boolean
}

export default function ProgressPanel({ progress, logLines, onCancel, exporting }: Props) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  const percent = progress?.percent ?? 0

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {exporting ? `Processing — ${percent}%` : 'Processing'}
        </div>
        {exporting && (
          <button
            onClick={onCancel}
            className="btn-ghost"
            style={{ fontSize: 11, padding: '3px 10px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            Cancel
          </button>
        )}
      </div>

      <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          height: '100%',
          width: `${percent}%`,
          background: 'var(--accent)',
          borderRadius: 2,
          transition: 'width 0.3s ease'
        }} />
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)', userSelect: 'none', marginBottom: 6 }}>
          FFmpeg output
        </summary>
        <div
          ref={logRef}
          style={{
            background: '#0a0a0d',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            maxHeight: 140,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: 10,
            color: 'var(--text-dim)',
            lineHeight: 1.6
          }}
        >
          {logLines.length === 0
            ? <span>Waiting...</span>
            : logLines.map((l, i) => <div key={i}>{l}</div>)
          }
        </div>
      </details>
    </div>
  )
}
