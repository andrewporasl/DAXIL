import { ipcMain, dialog, shell, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { WebContents } from 'electron'
import { readMetadata } from './ffprobe'
import { runFFmpeg, cancelFFmpeg, generateThumbnails, gifPreview } from './ffmpeg'
import { getDefaultBinarySetting, resolveBinaryPath, validateBinary } from './binaries'
import { extensionForMode, uniqueOutputPath, validateOutputPath } from './output'
import { cancelDownload, downloadLink, managedPath, updateYtDlp } from './downloader'
import { makePreviewProxy } from './previewProxy'
import { DOWNLOADS_ROOT, discardDownloads, downloadDirFor, downloadsUsage, trackDownload } from './tempDownloads'
import type { ExportOptions, AppSettings, FFmpegEvent, DownloadProgress, StorageLocation } from '../shared/types'
import Store = require('electron-store')

let store: Store<AppSettings> | undefined

function getStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({
      defaults: {
        ffmpegPath: getDefaultBinarySetting(),
        ffprobePath: getDefaultBinarySetting(),
        ytDlpPath: getDefaultBinarySetting(),
        defaultOutputDir: app.getPath('videos')
      }
    })
  }
  return store
}

let encoding = false
// Only the latest preview render is kept; the previous one is deleted when a new one starts.
let lastPreviewDir: string | null = null
async function hydrateMedia(options: ExportOptions, ffprobePath: string) {
  const meta = await readMetadata(options.inputPath, ffprobePath)
  options.hasAudio = meta.audioCodec !== 'none'
  options.media = await Promise.all((options.media ?? []).map(async asset => ({ ...asset, metadata: await readMetadata(asset.metadata.filePath, ffprobePath) })))
  return meta
}

export const checkUpdatesOnStartup = (): boolean => getStore().get('checkForUpdates', true) !== false

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:open-media', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video and audio', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('ffmpeg:measure', async (_, options: ExportOptions) => {
    if (encoding) throw new Error('An export is already running.')
    encoding = true
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil-measure-'))
    try {
      const s = getStore()
      const ffmpeg = resolveBinaryPath('ffmpeg', s.get('ffmpegPath'))
      const ffprobe = resolveBinaryPath('ffprobe', s.get('ffprobePath'))
      await validateBinary(ffmpeg, 'ffmpeg')
      await validateBinary(ffprobe, 'ffprobe')
      const meta = await hydrateMedia(options, ffprobe)
      const outputPath = path.join(directory, 'measure' + extensionForMode(options.mode))
      await runFFmpeg({ ...options, outputPath }, meta.fileSizeBytes, meta.durationSeconds, meta.width, meta.height, ffmpeg, () => {})
      return fs.statSync(outputPath).size
    } finally {
      encoding = false
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  // Renders the caller's (already sliced) timeline exactly like an export, into a temp file the
  // renderer plays through safe-file. Returns the path and the file size.
  ipcMain.handle('ffmpeg:video-preview', async (_, options: ExportOptions) => {
    if (encoding) throw new Error('An export is already running.')
    encoding = true
    if (lastPreviewDir) fs.rmSync(lastPreviewDir, { recursive: true, force: true })
    const directory = lastPreviewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil-preview-'))
    try {
      const s = getStore()
      const ffmpeg = resolveBinaryPath('ffmpeg', s.get('ffmpegPath'))
      const ffprobe = resolveBinaryPath('ffprobe', s.get('ffprobePath'))
      await validateBinary(ffmpeg, 'ffmpeg')
      await validateBinary(ffprobe, 'ffprobe')
      const meta = await hydrateMedia(options, ffprobe)
      const outputPath = path.join(directory, 'preview.mp4')
      await runFFmpeg({ ...options, mode: 'video', outputPath }, meta.fileSizeBytes, meta.durationSeconds, meta.width, meta.height, ffmpeg, () => {})
      return { path: outputPath, sizeBytes: fs.statSync(outputPath).size }
    } finally { encoding = false }
  })
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'ts'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:save-export', async (_, mode: ExportOptions['mode'], defaultPath: string) => {
    const ext = extensionForMode(mode)
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: `${ext.slice(1).toUpperCase()} file`, extensions: [ext.slice(1)] }]
    })
    return result.canceled || !result.filePath ? null : validateOutputPath(result.filePath, mode)
  })

  // "Convert and save" skips the save dialog: files go to the converted-links folder under a free name.
  ipcMain.handle('convert:output-path', (_, mode: ExportOptions['mode'], name: string) => {
    const dir = String(getStore().get('convertOutputDir', app.getPath('downloads')) || app.getPath('downloads'))
    fs.mkdirSync(dir, { recursive: true })
    return validateOutputPath(uniqueOutputPath(dir, String(name ?? ''), mode), mode)
  })

  ipcMain.handle('ffprobe:metadata', async (_, filePath: string) => {
    const s = await getStore()
    return readMetadata(filePath, resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string))
  })

  ipcMain.handle('ffmpeg:thumbnails', async (_, filePath: string, duration: number, count: number) => {
    const s = await getStore()
    return generateThumbnails(filePath, duration, count, resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string))
  })

  ipcMain.handle('ffmpeg:run', async (event, options: ExportOptions) => {
    if (!options.outputPath) throw new Error('Choose an output filename and location.')
    options.outputPath = validateOutputPath(options.outputPath, options.mode)
    if ([options.inputPath, ...(options.media ?? []).map(asset => asset.metadata.filePath)].some(input => path.resolve(options.outputPath!).toLowerCase() === path.resolve(input).toLowerCase())) {
      throw new Error('Choose an output file different from the source video.')
    }
    const s = await getStore()
    const ffmpegPath = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    const ffprobePath = resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string)
    const sender: WebContents = event.sender
    if (encoding) throw new Error('An export is already running.')
    encoding = true
    try {
      await validateBinary(ffmpegPath, 'ffmpeg')
      await validateBinary(ffprobePath, 'ffprobe')
      const meta = await hydrateMedia(options, ffprobePath)
      await runFFmpeg(
        options,
        meta.fileSizeBytes,
        meta.durationSeconds,
        meta.width,
        meta.height,
        ffmpegPath,
        (evt: FFmpegEvent) => {
          if (!sender.isDestroyed()) sender.send('ffmpeg:progress', evt)
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!sender.isDestroyed()) sender.send('ffmpeg:progress', { type: 'error', message })
      throw error
    } finally { encoding = false }
  })

  ipcMain.handle('ffmpeg:cancel', () => cancelFFmpeg())

  ipcMain.handle('ffmpeg:gif-preview', async (_, options: ExportOptions) => {
    const s = await getStore()
    const ffmpegPath = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    const ffprobePath = resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string)
    const meta = await hydrateMedia(options, ffprobePath)
    if (encoding) throw new Error('An export is already running.')
    encoding = true
    try { return await gifPreview(options, meta.durationSeconds, meta.width, meta.height, ffmpegPath) } finally { encoding = false }
  })

  ipcMain.handle('shell:open-folder', (_, folderPath: string) => {
    const dir = fs.statSync(folderPath).isDirectory() ? folderPath : path.dirname(folderPath)
    shell.openPath(dir)
  })

  ipcMain.handle('settings:get', async () => {
    const s = await getStore()
    return {
      ffmpegPath: s.get('ffmpegPath', getDefaultBinarySetting()),
      ffprobePath: s.get('ffprobePath', getDefaultBinarySetting()),
      ytDlpPath: s.get('ytDlpPath', getDefaultBinarySetting()),
      defaultOutputDir: s.get('defaultOutputDir', app.getPath('videos')),
      convertOutputDir: s.get('convertOutputDir', app.getPath('downloads')),
      checkForUpdates: s.get('checkForUpdates', true)
    }
  })

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    const s = await getStore()
    if (settings.ffmpegPath !== undefined) s.set('ffmpegPath', settings.ffmpegPath.trim() || getDefaultBinarySetting())
    if (settings.ffprobePath !== undefined) s.set('ffprobePath', settings.ffprobePath.trim() || getDefaultBinarySetting())
    if (settings.ytDlpPath !== undefined) s.set('ytDlpPath', settings.ytDlpPath.trim() || getDefaultBinarySetting())
    if (settings.defaultOutputDir !== undefined) s.set('defaultOutputDir', settings.defaultOutputDir)
    if (settings.convertOutputDir !== undefined) s.set('convertOutputDir', settings.convertOutputDir.trim() || app.getPath('downloads'))
    if (settings.checkForUpdates !== undefined) s.set('checkForUpdates', Boolean(settings.checkForUpdates))
  })

  ipcMain.handle('download:start', async (event, url: string) => {
    const s = getStore()
    const sender: WebContents = event.sender
    const ffmpegPath = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    const result = await downloadLink(url, { ytDlpPath: s.get('ytDlpPath'), ffmpegPath, downloadDir: downloadDirFor(sender.id) }, (progress: DownloadProgress) => {
      if (!sender.isDestroyed()) sender.send('download:progress', progress)
    })
    trackDownload(sender.id, result.filePath)
    return result
  })
  // Only files this window downloaded can be deleted this way.
  ipcMain.handle('download:discard', (event, filePaths: string[]) => discardDownloads(event.sender.id, Array.isArray(filePaths) ? filePaths : []))
  ipcMain.handle('download:cancel', () => cancelDownload())
  ipcMain.handle('media:preview-proxy', (_, filePath: string) => {
    const s = getStore()
    return makePreviewProxy(filePath, resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string))
  })

  // Where DAXIL keeps things, for the Settings "Storage" list. Paths are resolved here, and
  // app:reveal takes a key rather than a path, so the renderer can only open these locations.
  const storageLocations = (): Array<StorageLocation & { reveal: string; isFile: boolean }> => {
    const s = getStore()
    const ytSetting = String(s.get('ytDlpPath', getDefaultBinarySetting()) ?? '').trim()
    const ytDlp = ytSetting && ytSetting !== getDefaultBinarySetting() ? ytSetting : managedPath()
    const ffmpeg = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    const ffprobe = resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string)
    const usage = downloadsUsage()
    const exportsDir = s.get('defaultOutputDir', app.getPath('videos'))
    const convertDir = String(s.get('convertOutputDir', app.getPath('downloads')) || app.getPath('downloads'))
    const exists = (p: string) => path.isAbsolute(p) && fs.existsSync(p)
    return [
      { key: 'exports', label: 'Your exports', path: exportsDir, note: 'Your videos. Never deleted by DAXIL.', reveal: exportsDir, isFile: false, exists: exists(exportsDir) },
      { key: 'conversions', label: 'Converted links', path: convertDir, note: 'Files from "Convert and save". Never deleted by DAXIL.', reveal: convertDir, isFile: false, exists: exists(convertDir) },
      { key: 'downloads', label: 'Link downloads', path: DOWNLOADS_ROOT, note: usage.files ? `Temporary · ${usage.files} file${usage.files === 1 ? '' : 's'}, ${(usage.bytes / 1048576).toFixed(1)} MB right now` : 'Temporary · empty right now', reveal: DOWNLOADS_ROOT, isFile: false, exists: exists(DOWNLOADS_ROOT) },
      { key: 'scratch', label: 'Previews and size checks', path: os.tmpdir(), note: 'Temporary · daxil-preview-*, daxil-measure-* and daxil-proxies folders', reveal: os.tmpdir(), isFile: false, exists: true },
      { key: 'settings', label: 'Settings file', path: s.path, note: 'Your preferences', reveal: s.path, isFile: true, exists: exists(s.path) },
      { key: 'ytdlp', label: 'yt-dlp', path: ytDlp, note: exists(ytDlp) ? 'Link downloader' : 'Not downloaded yet · fetched on first link', reveal: ytDlp, isFile: true, exists: exists(ytDlp) },
      { key: 'ffmpeg', label: 'FFmpeg', path: ffmpeg, note: exists(ffmpeg) ? 'Video encoder' : 'Using the one on your PATH', reveal: ffmpeg, isFile: true, exists: exists(ffmpeg) },
      { key: 'ffprobe', label: 'FFprobe', path: ffprobe, note: exists(ffprobe) ? 'Reads media info' : 'Using the one on your PATH', reveal: ffprobe, isFile: true, exists: exists(ffprobe) },
      { key: 'appdata', label: 'App data', path: app.getPath('userData'), note: 'Settings, yt-dlp and cache. Delete this after uninstalling to remove everything.', reveal: app.getPath('userData'), isFile: false, exists: true }
    ]
  }
  ipcMain.handle('app:storage', (): StorageLocation[] => storageLocations().map(({ reveal: _reveal, isFile: _isFile, ...location }) => location))
  ipcMain.handle('app:reveal', (_, key: string) => {
    const location = storageLocations().find(item => item.key === key)
    if (!location || !location.exists) return false
    if (location.isFile) shell.showItemInFolder(location.reveal)
    else void shell.openPath(location.reveal)
    return true
  })
  ipcMain.handle('download:update-tool', () => updateYtDlp(getStore().get('ytDlpPath')))
}
