import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

// The main process owns the updater; every window just mirrors its status.
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    const api = window.electronAPI
    if (!api.onUpdateStatus) return
    const unsubscribe = api.onUpdateStatus(setStatus)
    api.getUpdateStatus().then(setStatus).catch(() => {})
    return unsubscribe
  }, [])
  return status
}

export function updateSummary(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking': return 'Checking for updates…'
    case 'none': return `You're on the latest version (${status.current}).`
    case 'available': return status.mode === 'auto' ? `Version ${status.version} is available.` : `Version ${status.version} is available. ${status.mode === 'dev' ? 'Pull the latest code to update.' : 'This copy can\'t update itself, so download it from the release page.'}`
    case 'downloading': return `Downloading ${status.version}… ${status.percent ?? 0}%`
    case 'ready': return `Version ${status.version} is ready. Restart DAXIL to finish updating.`
    case 'error': return status.message ?? 'The update check failed.'
    default: return status.mode === 'dev' ? 'Running from source: updates are checked but never installed.' : 'DAXIL checks for new versions in the background.'
  }
}
