import { useEffect, useRef, useState } from 'react'
import type { MediaAsset } from '@shared/types'
import Icon from './Icon'
import { formatBytes, formatDuration } from '../lib/sizeEstimator'
import { MEDIA_MIME } from '../lib/timeline'

interface Props {
  media: MediaAsset[]
  busy: boolean
  usage: Record<string, number>          // asset id → number of clips using it
  onImport: () => void
  onInsert: (ids: string[]) => void
  onRemove: (ids: string[]) => void
}

export default function MediaPool({ media, busy, usage, onImport, onInsert, onRemove }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const anchor = useRef<string | null>(null)
  useEffect(() => { setSelected(ids => ids.filter(id => media.some(asset => asset.id === id))) }, [media])
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.timeline-popover')) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menu])
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
  const remove = (ids: string[]) => { setMenu(null); if (ids.length) onRemove(ordered(ids)) }
  const menuAsset = menu ? media.find(asset => asset.id === menu.id) : null
  const menuIds = menu ? (selected.includes(menu.id) ? selected : [menu.id]) : []

  return <div className="card media-pool" tabIndex={-1}
    onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); setSelected(media.map(asset => asset.id))
      } else if (event.key === 'Enter' && selected.length) {
        event.preventDefault(); event.stopPropagation(); onInsert(ordered(selected))
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) {
        event.preventDefault(); event.stopPropagation(); remove(selected)
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
        const meta = asset.metadata
        const uses = usage[asset.id] ?? 0
        return <div key={asset.id} role="option" aria-selected={isSelected} tabIndex={0}
          className={`media-asset${isSelected ? ' is-selected' : ''}`} draggable={!busy}
          onClick={event => select(asset.id, event)}
          onContextMenu={event => { event.preventDefault(); if (!isSelected) { setSelected([asset.id]); anchor.current = asset.id } setMenu({ id: asset.id, x: event.clientX, y: event.clientY }) }}
          onDragStart={event => {
            const ids = isSelected ? ordered(selected) : [asset.id]
            if (!isSelected) { setSelected([asset.id]); anchor.current = asset.id }
            event.dataTransfer.setData(MEDIA_MIME, ids.length > 1 ? JSON.stringify(ids) : ids[0])
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onDoubleClick={() => onInsert(isSelected ? ordered(selected) : [asset.id])}
          title={`${meta.fileName}\n${meta.width ? `${meta.width} × ${meta.height} · ${meta.videoCodec} · ` : ''}${formatDuration(meta.durationSeconds)} · ${formatBytes(meta.fileSizeBytes)}${meta.audioCodec && meta.audioCodec !== 'none' ? ` · ${meta.audioCodec}` : ''}\nUsed by ${uses} clip${uses === 1 ? '' : 's'}. Drag to the timeline, double-click to append.`}>
          <div className="media-asset-thumb">
            {asset.thumbnail ? <img src={asset.thumbnail} alt="" draggable={false} /> : <Icon name={asset.kind === 'audio' ? 'music' : 'video'} />}
            <span className="media-asset-duration">{formatDuration(meta.durationSeconds)}</span>
            <button className="media-asset-add" onClick={event => { event.stopPropagation(); onInsert([asset.id]) }} disabled={busy} aria-label={`Add ${meta.fileName} to timeline`} title="Append to timeline"><Icon name="plus" size={13} /></button>
            <button className="media-asset-remove" onClick={event => { event.stopPropagation(); remove(isSelected ? selected : [asset.id]) }} disabled={busy} aria-label={`Remove ${meta.fileName} from pool`} title="Remove from pool (Delete)"><Icon name="x" size={12} /></button>
            {uses > 0 && <span className="media-asset-uses" title={`On the timeline ${uses}×`}>{uses}</span>}
          </div>
          <span className="media-asset-name">{meta.fileName}</span>
        </div>
      })}
    </div> : <button className="media-pool-empty" onClick={onImport} disabled={busy}>
      <Icon name="plus" size={18} />
      <span>Import media</span>
      <small>or drop files anywhere</small>
    </button>}
    {menu && menuAsset && <div className="timeline-popover timeline-actions" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" onClick={() => { setMenu(null); onInsert(ordered(menuIds)) }}>Add to timeline</button>
      <span className="timeline-menu-divider" />
      <button role="menuitem" onClick={() => remove(menuIds)}>Remove from pool{menuIds.length > 1 ? ` (${menuIds.length})` : ''}</button>
    </div>}
  </div>
}
