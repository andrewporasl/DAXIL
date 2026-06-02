import React, { useState } from 'react'
import type { VideoMetadata } from '@shared/types'
import { formatBytes, formatDuration } from '../lib/sizeEstimator'

interface Props {
  metadata: VideoMetadata
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      padding: '8px 0',
      borderTop: '1px solid var(--border)'
    }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </span>
      <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

export default function MetadataCard({ metadata }: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, lineHeight: 1.08, wordBreak: 'break-word', flex: 1, color: 'var(--text)' }}>
            {metadata.fileName}
          </div>
          <button
            className="collapse-toggle"
            style={{ width: 'auto', marginLeft: 10, flexShrink: 0, paddingTop: 4 }}
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
          >
            <span className={`section-chevron ${expanded ? 'open' : ''}`} />
          </button>
        </div>

        <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="metric-card">
            <span className="metric-label">Duration</span>
            <span className="metric-value" style={{ fontSize: 18 }}>{formatDuration(metadata.durationSeconds)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">File Size</span>
            <span className="metric-value" style={{ fontSize: 18 }}>{formatBytes(metadata.fileSizeBytes)}</span>
          </div>
        </div>
      </div>

      {expanded && (
        <div>
          <Row label="Resolution" value={metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : '-'} />
          <Row label="Video" value={metadata.videoCodec || '-'} />
          <Row label="Audio" value={metadata.audioCodec || 'None'} />
          <Row label="FPS" value={metadata.fps > 0 ? `${metadata.fps}` : '-'} />
        </div>
      )}
    </div>
  )
}
