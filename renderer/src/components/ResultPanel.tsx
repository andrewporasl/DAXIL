import React, { useState } from 'react'
import type { CompletionEvent } from '@shared/types'
import { formatBytes } from '../lib/sizeEstimator'
import Icon from './Icon'

interface Props {
  result: CompletionEvent
  downloads: number
  onOpenFolder: () => void
  onReset: () => void
  onDeleteDownloads: () => void
}

export default function ResultPanel({ result, downloads, onOpenFolder, onReset, onDeleteDownloads }: Props) {
  // 'ask' until the user chooses; downloads are still deleted on window close if they keep them.
  const [cleanup, setCleanup] = useState<'ask' | 'kept' | 'deleted'>('ask')
  const plural = downloads === 1 ? 'clip' : 'clips'
  return (
    <div className="result-panel">
      <div className="result-head">
        <span className="result-check" aria-hidden="true">✓</span>
        <b>Export saved</b>
        <span className="result-size">{formatBytes(result.outputSizeBytes)}</span>
      </div>
      <div className="result-path" title={result.outputPath}>{result.outputPath}</div>

      {downloads > 0 && cleanup === 'ask' && (
        <div className="cleanup-prompt" role="group" aria-label="Downloaded clips">
          <div className="cleanup-prompt-text">
            <b>Delete {downloads} downloaded {plural}?</b>
            <span>They're temporary. Keep them to export again; they're deleted when you close the window anyway.</span>
          </div>
          <div className="cleanup-prompt-actions">
            <button className="btn-ghost" onClick={() => setCleanup('kept')}>Keep for now</button>
            <button className="btn-danger" onClick={() => { onDeleteDownloads(); setCleanup('deleted') }}><Icon name="trash" size={13} /><span>Delete</span></button>
          </div>
        </div>
      )}
      {cleanup === 'deleted' && <div className="result-note">Downloaded {plural} deleted.</div>}

      <div className="export-actions">
        <button className="btn-ghost" onClick={onReset}><Icon name="reset" size={13} /><span>Back</span></button>
        <button className="btn-primary" onClick={onOpenFolder}><Icon name="folder" size={13} /><span>Show file</span></button>
      </div>
    </div>
  )
}
