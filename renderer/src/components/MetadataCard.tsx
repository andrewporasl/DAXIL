import React from 'react'
import type { VideoMetadata } from '../../../../shared/types'
import { formatBytes, formatDuration } from '../lib/sizeEstimator'

interface Props {
  metadata: VideoMetadata
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 0',
      borderBottom: '1px solid var(--border)'
    }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 12 }}>{value}</span>
    </div>
  )
}

export default function MetadataCard({ metadata }: Props) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, wordBreak: 'break-all', color: 'var(--text-muted)' }}>
        {metadata.fileName}
      </div>
      <Row label="Duration" value={formatDuration(metadata.durationSeconds)} />
      <Row label="Resolution" value={
        metadata.width && metadata.height ? `${metadata.width} × ${metadata.height}` : '—'
      } />
      <Row label="Format" value={metadata.format.toUpperCase()} />
      <Row label="Video" value={metadata.videoCodec || '—'} />
      <Row label="Audio" value={metadata.audioCodec || 'none'} />
      <Row label="FPS" value={metadata.fps > 0 ? `${metadata.fps}` : '—'} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>File size</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{formatBytes(metadata.fileSizeBytes)}</span>
      </div>
    </div>
  )
}
