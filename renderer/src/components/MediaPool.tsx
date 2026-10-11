import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '@shared/types'
import Icon from './Icon'
import { formatDuration } from '../lib/sizeEstimator'
import { MEDIA_MIME } from '../lib/timeline'

interface Props {
  media: MediaAsset[]
  busy: boolean
  inUse: Set<string>
  onImport: () => void
  onInsert: (ids: string[]) => void
  onRemove: (ids: string[]) => void
}

export default function MediaPool({ media, busy, inUse, onImport, onInsert, onRemove }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  useEffect(() => { setSelected(ids => ids.filter(id => media.some(asset => asset.id === id))) }, [media])
  const ordered = (ids: string[]) => media.filter(asset => ids.includes(asset.id)).map(asset => asset.id)

  const select = (id: string, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (event.shiftKey && anchor.current) {
      const a = media.findIndex(asset => asset.id === anchor.current)
      const b = media.findIndex(asset => asset.id === id)
      if (a >= 0 && b >= 0) { setSelected(media.slice(Math.min(a, b), Math.max(a, b) + 1).map(asset => asset.id)); return }
    }
    anchor.current = id
    if (event.ctrlKey || event.metaKey) setSelected(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])
    else setSelected([id])
  }

  const removable = selected.filter(id => !inUse.has(id))

  return <div className="card media-pool" tabIndex={-1}
    onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); setSelected(media.map(asset => asset.id))
      } else if (event.key === 'Enter' && selected.length) {
        event.preventDefault(); event.stopPropagation(); onInsert(ordered(selected))
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) {
        event.preventDefault(); event.stopPropagation(); if (removable.length) onRemove(removable)
      } else if (event.key === 'Escape') setSelected([])
    }}>
    <div className="media-pool-heading">
      <span className="section-title">Media{media.length > 0 && <small> {media.length}</small>}</span>
      <div className="media-pool-actions">
        {selected.length > 0 && <button className="btn-ghost media-pool-add" onClick={() => onInsert(ordered(selected))} disabled={busy} title="Append the selection to the timeline (Enter)">Add {selected.length > 1 ? `${selected.length} ` : ''}to timeline</button>}
        <button className="icon-button" onClick={onImport} disabled={busy} title="Import video or audio (Ctrl+I)" aria-label="Import media"><Icon name="plus" size={15} /></button>
      </div>
    </div>
    {media.length > 0 ? <div className="media-pool-items" role="listbox" aria-multiselectable="true" aria-label="Media">
      {media.map(asset => {
        const isSelected = selected.includes(asset.id)
        return <div key={asset.id} role="option" aria-selected={isSelected} tabIndex={0}
          className={`media-asset${isSelected ? ' is-selected' : ''}`} draggable={!busy}
          onClick={event => select(asset.id, event)}
          onDragStart={event => {
            const ids = isSelected ? ordered(selected) : [asset.id]
            if (!isSelected) { setSelected([asset.id]); anchor.current = asset.id }
            event.dataTransfer.setData(MEDIA_MIME, ids.length > 1 ? JSON.stringify(ids) : ids[0])
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onDoubleClick={() => onInsert(isSelected ? ordered(selected) : [asset.id])}
          title={`${asset.metadata.fileName}\nDrag to the timeline, double-click to append. Ctrl/Shift-click to select several.`}>
          <div className="media-asset-thumb">
            {asset.thumbnail ? <img src={asset.thumbnail} alt="" draggable={false} /> : <Icon name={asset.kind === 'audio' ? 'music' : 'video'} />}
            <span className="media-asset-duration">{formatDuration(asset.metadata.durationSeconds)}</span>
            <button className="media-asset-add" onClick={event => { event.stopPropagation(); onInsert([asset.id]) }} disabled={busy} aria-label={`Add ${asset.metadata.fileName} to timeline`} title="Append to timeline"><Icon name="plus" size={13} /></button>
          </div>
          <span className="media-asset-name">{asset.metadata.fileName}</span>
        </div>
      })}
    </div> : <button className="media-pool-empty" onClick={onImport} disabled={busy}>
      <Icon name="plus" size={18} />
      <span>Import media</span>
      <small>or drop files anywhere</small>
    </button>}
  </div>
}
