import { ipcMain, dialog, shell, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { WebContents } from 'electron'
import { readMetadata } from './ffprobe'
import { runFFmpeg, cancelFFmpeg, generateThumbnails } from './ffmpeg'
import type { ExportOptions, AppSettings, FFmpegEvent } from '../shared/types'

let store: { get: (key: string, def?: unknown) => unknown; set: (key: string, val: unknown) => void }

async function getStore() {
  if (!store) {
    const Store = (await import('electron-store')).default
    const s = new Store<AppSettings>({
      defaults: {
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        defaultOutputDir: app.getPath('videos')
      }
    })
    store = s as typeof store
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
    return readMetadata(filePath, s.get('ffprobePath', 'ffprobe') as string)
  })

  ipcMain.handle('ffmpeg:thumbnails', async (_, filePath: string, duration: number, count: number) => {
    const s = await getStore()
    return generateThumbnails(filePath, duration, count, s.get('ffmpegPath', 'ffmpeg') as string)
  })

  ipcMain.handle('ffmpeg:run', async (event, options: ExportOptions) => {
    const s = await getStore()
    const ffmpegPath = s.get('ffmpegPath', 'ffmpeg') as string
    const ffprobePath = s.get('ffprobePath', 'ffprobe') as string
    const meta = await readMetadata(options.inputPath, ffprobePath)
    const sender: WebContents = event.sender

    await runFFmpeg(
      options,
      meta.fileSizeBytes,
      meta.durationSeconds,
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
      ffmpegPath: s.get('ffmpegPath', 'ffmpeg'),
      ffprobePath: s.get('ffprobePath', 'ffprobe'),
      defaultOutputDir: s.get('defaultOutputDir', app.getPath('videos'))
    }
  })

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    const s = await getStore()
    if (settings.ffmpegPath !== undefined) s.set('ffmpegPath', settings.ffmpegPath)
    if (settings.ffprobePath !== undefined) s.set('ffprobePath', settings.ffprobePath)
    if (settings.defaultOutputDir !== undefined) s.set('defaultOutputDir', settings.defaultOutputDir)
  })
}
