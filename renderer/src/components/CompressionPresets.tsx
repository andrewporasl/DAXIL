import { exportPlan } from '../../../shared/exportPlan'
import React from 'react'
import type { VideoMetadata, CompressionLevel, ExportOptions } from '@shared/types'
import { formatBytes } from '../lib/sizeEstimator'

interface Props {
  metadata: VideoMetadata
  options: ExportOptions
  selected: CompressionLevel
  onChange: (level: CompressionLevel) => void
}

const PRESETS: Array<{
  id: CompressionLevel
  label: string
  description: string
  reductionFactor: number
}> = [
  { id: 'none', label: 'High quality', description: 'CRF 18 · size varies', reductionFactor: 0 },
  { id: '25', label: '25% target reduction', description: 'Bitrate target', reductionFactor: 0.25 },
  { id: '50', label: '50% target reduction', description: 'Bitrate target', reductionFactor: 0.50 },
  { id: '75', label: '75% target reduction', description: 'Bitrate target', reductionFactor: 0.75 },
  { id: '90', label: '90% target reduction', description: 'Bitrate target', reductionFactor: 0.90 }
]

export default function CompressionPresets({ metadata, options, selected, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PRESETS.map((preset) => {
        const estimated = exportPlan({ ...options, mode: 'video', compressionLevel: preset.id }, metadata).targetBytes
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
              {estimated === null ? 'Variable' : `~${formatBytes(estimated)}`}
            </div>
          </button>
        )
      })}
    </div>
  )
}
