import { ipcMain, dialog, shell, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { WebContents } from 'electron'
import { readMetadata } from './ffprobe'
import { runFFmpeg, cancelFFmpeg, generateThumbnails } from './ffmpeg'
import { getDefaultBinarySetting, resolveBinaryPath } from './binaries'
import type { ExportOptions, AppSettings, FFmpegEvent } from '../shared/types'
import Store = require('electron-store')

let store: Store<AppSettings> | undefined

function getStore(): Store<AppSettings> {
  if (!store) {
    store = new Store<AppSettings>({
      defaults: {
        ffmpegPath: getDefaultBinarySetting(),
        ffprobePath: getDefaultBinarySetting(),
        defaultOutputDir: app.getPath('videos')
      }
    })
  }
  return store
}

export function registerIpcHandlers(): void {
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

  ipcMain.handle('ffprobe:metadata', async (_, filePath: string) => {
    const s = await getStore()
    return readMetadata(filePath, resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string))
  })

  ipcMain.handle('ffmpeg:thumbnails', async (_, filePath: string, duration: number, count: number) => {
    const s = await getStore()
    return generateThumbnails(filePath, duration, count, resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string))
  })

  ipcMain.handle('ffmpeg:run', async (event, options: ExportOptions) => {
    const s = await getStore()
    const ffmpegPath = resolveBinaryPath('ffmpeg', s.get('ffmpegPath', getDefaultBinarySetting()) as string)
    const ffprobePath = resolveBinaryPath('ffprobe', s.get('ffprobePath', getDefaultBinarySetting()) as string)
    const meta = await readMetadata(options.inputPath, ffprobePath)
    const sender: WebContents = event.sender

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
  })

  ipcMain.handle('ffmpeg:cancel', () => cancelFFmpeg())

  ipcMain.handle('shell:open-folder', (_, folderPath: string) => {
    const dir = fs.statSync(folderPath).isDirectory() ? folderPath : path.dirname(folderPath)
    shell.openPath(dir)
  })

  ipcMain.handle('settings:get', async () => {
    const s = await getStore()
    return {
      ffmpegPath: s.get('ffmpegPath', getDefaultBinarySetting()),
      ffprobePath: s.get('ffprobePath', getDefaultBinarySetting()),
      defaultOutputDir: s.get('defaultOutputDir', app.getPath('videos'))
    }
  })

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    const s = await getStore()
    if (settings.ffmpegPath !== undefined) s.set('ffmpegPath', settings.ffmpegPath.trim() || getDefaultBinarySetting())
    if (settings.ffprobePath !== undefined) s.set('ffprobePath', settings.ffprobePath.trim() || getDefaultBinarySetting())
    if (settings.defaultOutputDir !== undefined) s.set('defaultOutputDir', settings.defaultOutputDir)
  })
}
