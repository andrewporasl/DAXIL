import { ipcMain, dialog, shell, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { WebContents } from 'electron'
import { readMetadata } from './ffprobe'
import { runFFmpeg, cancelFFmpeg, generateThumbnails, gifPreview } from './ffmpeg'
import { getDefaultBinarySetting, resolveBinaryPath, validateBinary } from './binaries'
import { extensionForMode, validateOutputPath } from './output'
import { cancelDownload, downloadLink, updateYtDlp } from './downloader'
import type { ExportOptions, AppSettings, FFmpegEvent, DownloadProgress } from '../shared/types'
import Store = require('electron-store')

let store: Store<AppSettings> | undefined

function getStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({
      defaults: {
        ffmpegPath: getDefaultBinarySetting(),
        ffprobePath: getDefaultBinarySetting(),
        ytDlpPath: getDefaultBinarySetting(),
        defaultOutputDir: app.getPath('videos'),
        downloadDir: path.join(app.getPath('videos'), 'DAXIL Downloads')
      }
    })
  }
  return store
}

let encoding = false
async function hydrateMedia(options: ExportOptions, ffprobePath: string) {
  const meta = await readMetadata(options.inputPath, ffprobePath)
  options.hasAudio = meta.audioCodec !== 'none'
  options.media = await Promise.all((options.media ?? []).map(async asset => ({ ...asset, metadata: await readMetadata(asset.metadata.filePath, ffprobePath) })))
  return meta
}

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
      downloadDir: s.get('downloadDir', path.join(app.getPath('videos'), 'DAXIL Downloads'))
    }
  })

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    const s = await getStore()
    if (settings.ffmpegPath !== undefined) s.set('ffmpegPath', settings.ffmpegPath.trim() || getDefaultBinarySetting())
    if (settings.ffprobePath !== undefined) s.set('ffprobePath', settings.ffprobePath.trim() || getDefaultBinarySetting())
    if (settings.ytDlpPath !== undefined) s.set('ytDlpPath', settings.ytDlpPath.trim() || getDefaultBinarySetting())
    if (settings.defaultOutputDir !== undefined) s.set('defaultOutputDir', settings.defaultOutputDir)
    if (settings.downloadDir !== undefined) s.set('downloadDir', settings.downloadDir.trim() || path.join(app.getPath('videos'), 'DAXIL Downloads'))
  })

  ipcMain.handle('download:start', async (event, url: string) => {
    const s = getStore()
    const sender: WebContents = event.sender
    const ffmpegPath = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    return downloadLink(url, { ytDlpPath: s.get('ytDlpPath'), ffmpegPath, downloadDir: s.get('downloadDir') }, (progress: DownloadProgress) => {
      if (!sender.isDestroyed()) sender.send('download:progress', progress)
    })
  })
  ipcMain.handle('download:cancel', () => cancelDownload())
  ipcMain.handle('download:update-tool', () => updateYtDlp(getStore().get('ytDlpPath')))
}
