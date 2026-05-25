import React from 'react'
import type { VideoMetadata, CompressionLevel, TrimRange } from '../../../../shared/types'
import { estimateCompressedSize, estimateTrimmedSize, formatBytes } from '../lib/sizeEstimator'

interface Props {
  metadata: VideoMetadata
  trim: TrimRange
  selected: CompressionLevel
  onChange: (level: CompressionLevel) => void
}

const PRESETS: Array<{
  id: CompressionLevel
  label: string
  description: string
  reductionFactor: number
}> = [
  { id: 'none', label: 'Original', description: 'Preserve source fidelity', reductionFactor: 0 },
  { id: '25', label: '25% smaller', description: 'Light optimization', reductionFactor: 0.25 },
  { id: '50', label: '50% smaller', description: 'Balanced delivery', reductionFactor: 0.50 },
  { id: '75', label: '75% smaller', description: 'Aggressive reduction', reductionFactor: 0.75 },
  { id: '90', label: '90% smaller', description: 'Smallest handoff', reductionFactor: 0.90 }
]

export default function CompressionPresets({ metadata, trim, selected, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PRESETS.map((preset) => {
        const estimated = preset.reductionFactor === 0
          ? estimateTrimmedSize(metadata, trim)
          : estimateCompressedSize(metadata, preset.reductionFactor, trim)
        const isSelected = selected === preset.id

        return (
          <button
            key={preset.id}
            className={`option-button ${isSelected ? 'selected' : ''}`}
            onClick={() => onChange(preset.id)}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="radio-dot" />
              <div>
                <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
                  {preset.label}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {preset.description}
                </div>
              </div>
            </div>

            <div style={{ color: isSelected ? 'var(--accent)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center' }}>
              {formatBytes(estimated)}
            </div>
          </button>
        )
      })}
    </div>
  )
}
