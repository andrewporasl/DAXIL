import React from 'react'
import type { VideoMetadata, CompressionLevel, TrimRange } from '../../../../shared/types'
import { estimateCompressedSize, estimateTrimmedSize, formatBytes } from '../lib/sizeEstimator'

interface Props {
  metadata: VideoMetadata
  trim: TrimRange
  selected: CompressionLevel
  onChange: (level: CompressionLevel) => void
}

interface Preset {
  id: CompressionLevel
  label: string
  reductionFactor: number
}

const PRESETS: Preset[] = [
  { id: 'none', label: 'Original quality', reductionFactor: 0 },
  { id: '25', label: '25% smaller', reductionFactor: 0.25 },
  { id: '50', label: '50% smaller', reductionFactor: 0.50 },
  { id: '75', label: '75% smaller', reductionFactor: 0.75 },
  { id: '90', label: '90% smaller', reductionFactor: 0.90 }
]

export default function CompressionPresets({ metadata, trim, selected, onChange }: Props) {
  return (
    <div>
      <div className="section-title">Compression</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {PRESETS.map((p) => {
          const est = p.reductionFactor === 0
            ? estimateTrimmedSize(metadata, trim)
            : estimateCompressedSize(metadata, p.reductionFactor, trim)
          const isSelected = selected === p.id

          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                background: isSelected ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${isSelected ? 'var(--accent-border)' : 'transparent'}`,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.12s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--text-dim)'}`,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  flexShrink: 0,
                  transition: 'all 0.12s'
                }} />
                <span style={{
                  fontSize: 12,
                  color: isSelected ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: isSelected ? 500 : 400
                }}>
                  {p.label}
                </span>
              </div>
              <span style={{
                fontSize: 11,
                color: isSelected ? 'var(--accent)' : 'var(--text-dim)',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: isSelected ? 600 : 400
              }}>
                ~{formatBytes(est)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
