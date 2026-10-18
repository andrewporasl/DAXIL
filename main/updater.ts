import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { autoUpdater } from 'electron-updater'
import type { UpdateMode, UpdateStatus } from '../shared/types'
import { isNewerVersion } from '../shared/version.ts'

// Releases are published on GitHub by the release workflow. The app reads them directly, so
// users never have to visit the page: installed copies download and install the new version
// in the background, everything else is told a new version exists and where to get it.
const OWNER = 'andrewporasl'
const REPO = 'DAXIL'
export const RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`
const LATEST_RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

// Whether this copy can replace itself depends on how it was installed.
export function updateMode(): UpdateMode {
  if (!app.isPackaged) return 'dev'
  // The NSIS installer leaves an uninstaller beside the app; the portable ZIP doesn't.
  if (process.platform === 'win32') return fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall DAXIL.exe')) ? 'auto' : 'manual'
  if (process.platform === 'linux') return process.env.APPIMAGE ? 'auto' : 'manual'
  // macOS only installs updates into code-signed apps, and DAXIL builds are unsigned.
  return 'manual'
}

let status: UpdateStatus = { state: 'idle', mode: 'dev', current: '0.0.0' }

function publish(next: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...next }
  for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send('update:status', status)
  return status
}

const describe = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::/i.test(message)) return 'Could not reach the update server. Check your internet connection.'
  if (/404|No published versions/i.test(message)) return 'No published release was found yet.'
  return message.split('\n')[0]
}

// Copies that can't install updates only ask GitHub for the newest release's version number.
async function checkManually(): Promise<UpdateStatus> {
  publish({ state: 'checking', message: undefined })
  try {
    const response = await net.fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `DAXIL/${status.current}` } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const release = await response.json() as { tag_name?: string }
    const version = String(release.tag_name ?? '').replace(/^v/i, '')
    if (!version) throw new Error('No published versions')
    return publish(isNewerVersion(version, status.current) ? { state: 'available', version } : { state: 'none', version })
  } catch (error) { return publish({ state: 'error', message: describe(error) }) }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status
  if (status.mode !== 'auto') return checkManually()
  publish({ state: 'checking', message: undefined })
  try { await autoUpdater.checkForUpdates() } catch (error) { publish({ state: 'error', message: describe(error) }) }
  return status
}

export function initUpdater(checkOnStartup: () => boolean): void {
  status = { state: 'idle', mode: updateMode(), current: app.getVersion() }
  // Downloads start only when asked; a downloaded update also installs on the next normal quit.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.on('update-available', info => publish({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', info => publish({ state: 'none', version: info.version }))
  autoUpdater.on('download-progress', progress => publish({ state: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', info => publish({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', error => publish({ state: 'error', message: describe(error) }))

  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', async () => {
    if (status.mode !== 'auto' || status.state !== 'available') return status
    publish({ state: 'downloading', percent: 0 })
    try { await autoUpdater.downloadUpdate() } catch (error) { publish({ state: 'error', message: describe(error) }) }
    return status
  })
  // Quits every window and runs the new installer silently (no setup wizard), then reopens DAXIL.
  ipcMain.handle('update:install', () => { if (status.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(true, true)) })
  ipcMain.handle('update:open-page', () => shell.openExternal(RELEASE_PAGE))

  if (status.mode !== 'dev' && checkOnStartup()) setTimeout(() => { void checkForUpdates() }, 8000).unref()
}
