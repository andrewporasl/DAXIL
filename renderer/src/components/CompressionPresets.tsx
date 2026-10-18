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

const PRESETS: Array<{ id: CompressionLevel; label: string; note: string }> = [
  { id: 'none', label: 'Best quality', note: 'Full detail' },
  { id: '25', label: 'A bit smaller', note: '−25%' },
  { id: '50', label: 'Half size', note: '−50%' },
  { id: '75', label: 'Small', note: '−75%' },
  { id: '90', label: 'Tiny', note: '−90%' }
]

// One compact row per preset: dot, name, how much smaller, estimated file size.
export default function CompressionPresets({ metadata, options, selected, onChange }: Props) {
  return (
    <div className="compression-list" role="radiogroup" aria-label="Compression">
      {PRESETS.map((preset) => {
        const estimated = exportPlan({ ...options, mode: 'video', compressionLevel: preset.id }, metadata).targetBytes
        const isSelected = selected === preset.id
        return (
          <button key={preset.id} role="radio" aria-checked={isSelected}
            className={`compression-row ${isSelected ? 'selected' : ''}`} onClick={() => onChange(preset.id)}>
            <span className="radio-dot" />
            <span className="compression-label">{preset.label}</span>
            <span className="compression-note">{preset.note}</span>
            <span className="compression-size">{estimated === null ? 'Varies' : `~${formatBytes(estimated)}`}</span>
          </button>
        )
      })}
    </div>
  )
}
