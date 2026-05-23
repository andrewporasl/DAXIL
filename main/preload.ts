import { contextBridge, ipcRenderer } from 'electron'
import type { ExportOptions, FFmpegEvent, AppSettings } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-file'),

  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-folder'),

  getMetadata: (filePath: string) =>
    ipcRenderer.invoke('ffprobe:metadata', filePath),

  getThumbnails: (filePath: string, duration: number, count: number): Promise<string[]> =>
    ipcRenderer.invoke('ffmpeg:thumbnails', filePath, duration, count),

  runFFmpeg: (options: ExportOptions): Promise<void> =>
    ipcRenderer.invoke('ffmpeg:run', options),

  cancelFFmpeg: (): Promise<void> =>
    ipcRenderer.invoke('ffmpeg:cancel'),

  onFFmpegEvent: (callback: (event: FFmpegEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: FFmpegEvent) => callback(event)
    ipcRenderer.on('ffmpeg:progress', listener)
    return () => ipcRenderer.removeListener('ffmpeg:progress', listener)
  },

  openFolder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-folder', folderPath),

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings)
})
