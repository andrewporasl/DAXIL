import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Link downloads are scratch media: they live in a per-run temp folder and are deleted when the
// user discards them, when their window closes, or when the app quits. Only files this module
// handed out are ever deleted.
export const DOWNLOADS_ROOT = path.join(os.tmpdir(), 'daxil-downloads')
const ROOT = DOWNLOADS_ROOT
const STALE_MS = 12 * 60 * 60 * 1000
const sessionDir = path.join(ROOT, `run-${process.pid}-${Date.now().toString(36)}`)
const owned = new Map<number, Set<string>>() // webContents id → downloaded files

export function downloadDirFor(ownerId: number): string {
  const dir = path.join(sessionDir, `w${ownerId}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function trackDownload(ownerId: number, filePath: string): void {
  if (!owned.has(ownerId)) owned.set(ownerId, new Set())
  owned.get(ownerId)!.add(path.normalize(filePath))
}

// Windows keeps a file locked briefly after a <video> lets go of it, so retry a few times.
function remove(filePath: string): boolean {
  try { fs.rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 100 }); return true } catch { return false }
}

/** Deletes the given files if (and only if) this owner downloaded them. Returns how many were deleted. */
export function discardDownloads(ownerId: number, filePaths: string[]): number {
  const files = owned.get(ownerId)
  if (!files) return 0
  let count = 0
  for (const raw of filePaths) {
    const filePath = path.normalize(raw)
    if (files.delete(filePath) && remove(filePath)) count++
  }
  return count
}

export function discardAllFor(ownerId: number): void {
  const files = owned.get(ownerId)
  if (files) for (const filePath of files) remove(filePath)
  owned.delete(ownerId)
  try { fs.rmSync(path.join(sessionDir, `w${ownerId}`), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* ignore */ }
}

export function discardEverything(): void {
  for (const id of [...owned.keys()]) discardAllFor(id)
  try { fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* ignore */ }
}

/** Clears folders left behind by runs that crashed or were killed (older than 12 hours). */
export function sweepStaleDownloads(now = Date.now()): void {
  let entries: string[] = []
  try { entries = fs.readdirSync(ROOT) } catch { return }
  for (const name of entries) {
    const dir = path.join(ROOT, name)
    if (!name.startsWith('run-') || dir === sessionDir) continue
    try { if (now - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/** Total size and file count of everything under the temporary downloads folder. */
export function downloadsUsage(): { bytes: number; files: number } {
  let bytes = 0, files = 0
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else { try { bytes += fs.statSync(full).size; files++ } catch { /* gone */ } }
    }
  }
  walk(ROOT)
  return { bytes, files }
}
