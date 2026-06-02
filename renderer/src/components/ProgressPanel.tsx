import React, { useRef, useEffect } from 'react'
import type { ProgressEvent } from '@shared/types'
import { formatDuration } from '../lib/sizeEstimator'

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
  const current = progress?.currentSeconds ?? 0
  const total = progress?.totalSeconds ?? 0

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>Rendering</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 1, marginBottom: 4 }}>
            {percent}%
          </div>
          <div className="surface-note">
            {total > 0 ? `${formatDuration(current)} of ${formatDuration(total)}` : 'Preparing FFmpeg output'}
          </div>
        </div>

        {exporting && (
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div style={{ height: 8, borderRadius: 999, background: 'var(--panel-3)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'var(--accent)',
            transition: 'width 0.25s ease'
          }}
        />
      </div>

      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600 }}>
          FFmpeg log
        </summary>
        <div ref={logRef} className="mono-block" style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}>
          {logLines.length === 0
            ? <span>Waiting for process output...</span>
            : logLines.map((line, index) => <div key={index}>{line}</div>)
          }
        </div>
      </details>
    </div>
  )
}
