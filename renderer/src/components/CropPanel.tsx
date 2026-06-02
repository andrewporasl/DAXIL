import React from 'react'
import type { CropSelection, VideoMetadata } from '@shared/types'
import Icon from './Icon'

interface Props {
  metadata: VideoMetadata
  crop: CropSelection
  onCropChange: (crop: CropSelection) => void
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function fullFrameCrop(metadata: VideoMetadata, enabled: boolean): CropSelection {
  return {
    enabled,
    x: 0,
    y: 0,
    width: Math.max(2, metadata.width),
    height: Math.max(2, metadata.height)
  }
}

function recenterCrop(metadata: VideoMetadata, crop: CropSelection): CropSelection {
  return {
    ...crop,
    enabled: true,
    x: Math.round((metadata.width - crop.width) / 2),
    y: Math.round((metadata.height - crop.height) / 2)
  }
}

function resizeFromCenter(
  metadata: VideoMetadata,
  crop: CropSelection,
  dimension: 'width' | 'height',
  value: number
): CropSelection {
  const nextWidth = dimension === 'width'
    ? clamp(Math.round(value), Math.min(metadata.width, 32), metadata.width)
    : crop.width
  const nextHeight = dimension === 'height'
    ? clamp(Math.round(value), Math.min(metadata.height, 32), metadata.height)
    : crop.height
  const centerX = crop.x + crop.width / 2
  const centerY = crop.y + crop.height / 2

  return {
    enabled: true,
    width: nextWidth,
    height: nextHeight,
    x: Math.round(clamp(centerX - nextWidth / 2, 0, metadata.width - nextWidth)),
    y: Math.round(clamp(centerY - nextHeight / 2, 0, metadata.height - nextHeight))
  }
}

export default function CropPanel({ metadata, crop, onCropChange }: Props) {
  const minWidth = Math.min(metadata.width, 32)
  const minHeight = Math.min(metadata.height, 32)
  const canCrop = metadata.width > 0 && metadata.height > 0

  const handleToggle = () => {
    if (!canCrop) return
    onCropChange(crop.enabled ? { ...crop, enabled: false } : { ...crop, enabled: true })
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>Crop</div>

      <button
        className={`option-button crop-toggle ${crop.enabled ? 'selected' : ''}`}
        onClick={handleToggle}
        disabled={!canCrop}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="format-icon"><Icon name="crop" size={16} /></div>
          <div>
            <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
              Crop frame
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {crop.enabled ? `${Math.round(crop.width)} x ${Math.round(crop.height)}px` : 'Full frame'}
            </div>
          </div>
        </div>
        <div className="radio-dot" />
      </button>

      {crop.enabled && (
        <div className="crop-panel-body">
          <div>
            <label>Width</label>
            <input
              className="range-input"
              type="range"
              min={minWidth}
              max={metadata.width}
              step={2}
              value={Math.round(crop.width)}
              onChange={(event) => onCropChange(resizeFromCenter(metadata, crop, 'width', Number(event.target.value)))}
            />
          </div>

          <div>
            <label>Height</label>
            <input
              className="range-input"
              type="range"
              min={minHeight}
              max={metadata.height}
              step={2}
              value={Math.round(crop.height)}
              onChange={(event) => onCropChange(resizeFromCenter(metadata, crop, 'height', Number(event.target.value)))}
            />
          </div>

          <div className="crop-meta-row">
            <span>{Math.round(crop.width)} x {Math.round(crop.height)}px</span>
            <span>X {Math.round(crop.x)} / Y {Math.round(crop.y)}</span>
          </div>

          <div className="crop-button-row">
            <button className="btn-ghost" onClick={() => onCropChange(recenterCrop(metadata, crop))}>
              <Icon name="reset" size={15} />
              <span>Center</span>
            </button>
            <button className="btn-ghost" onClick={() => onCropChange(fullFrameCrop(metadata, true))}>
              <Icon name="crop" size={15} />
              <span>Full</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
