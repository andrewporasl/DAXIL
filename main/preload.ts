import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportOptions, FFmpegEvent, AppSettings, DownloadProgress, DownloadResult } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  openMedia: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-media'),
  measureExport: (options: ExportOptions): Promise<number> => ipcRenderer.invoke('ffmpeg:measure', options),
  openFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-file'),

  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-folder'),

  saveExportDialog: (mode: ExportOptions['mode'], defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-export', mode, defaultPath),

  getPathForFile: (file: File): string =>
    webUtils.getPathForFile(file),

  getMetadata: (filePath: string) =>
    ipcRenderer.invoke('ffprobe:metadata', filePath),

  getThumbnails: (filePath: string, duration: number, count: number): Promise<string[]> =>
    ipcRenderer.invoke('ffmpeg:thumbnails', filePath, duration, count),

  runFFmpeg: (options: ExportOptions): Promise<void> =>
    ipcRenderer.invoke('ffmpeg:run', options),

  cancelFFmpeg: (): Promise<void> =>
    ipcRenderer.invoke('ffmpeg:cancel'),

  previewGif: (options: ExportOptions): Promise<string> =>
    ipcRenderer.invoke('ffmpeg:gif-preview', options),

  onFFmpegEvent: (callback: (event: FFmpegEvent) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: FFmpegEvent) => callback(event)
    ipcRenderer.on('ffmpeg:progress', listener)
    return () => ipcRenderer.removeListener('ffmpeg:progress', listener)
  },

  openFolder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-folder', folderPath),

  openNewWindow: (): Promise<void> =>
    ipcRenderer.invoke('window:new'),

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),

  downloadLink: (url: string): Promise<DownloadResult> =>
    ipcRenderer.invoke('download:start', url),

  cancelDownload: (): Promise<void> =>
    ipcRenderer.invoke('download:cancel'),

  updateDownloader: (): Promise<string> =>
    ipcRenderer.invoke('download:update-tool'),

  onDownloadProgress: (callback: (event: DownloadProgress) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: DownloadProgress) => callback(event)
    ipcRenderer.on('download:progress', listener)
    return () => ipcRenderer.removeListener('download:progress', listener)
  }
})
