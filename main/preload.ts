import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ExportOptions, FFmpegEvent, AppSettings, DownloadProgress, DownloadResult, StorageLocation, UpdateStatus } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  openMedia: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-media'),
  measureExport: (options: ExportOptions): Promise<number> => ipcRenderer.invoke('ffmpeg:measure', options),
  openFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-file'),

  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:open-folder'),

  convertOutputPath: (mode: ExportOptions['mode'], name: string): Promise<string> => ipcRenderer.invoke('convert:output-path', mode, name),

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

  previewVideo: (options: ExportOptions): Promise<{ path: string; sizeBytes: number }> =>
    ipcRenderer.invoke('ffmpeg:video-preview', options),

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

  getStorage: (): Promise<StorageLocation[]> => ipcRenderer.invoke('app:storage'),
  revealStorage: (key: string): Promise<boolean> => ipcRenderer.invoke('app:reveal', key),

  saveSettings: (settings: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),

  downloadLink: (url: string): Promise<DownloadResult> =>
    ipcRenderer.invoke('download:start', url),

  cancelDownload: (): Promise<void> =>
    ipcRenderer.invoke('download:cancel'),

  makePreviewProxy: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('media:preview-proxy', filePath),

  discardDownloads: (filePaths: string[]): Promise<number> =>
    ipcRenderer.invoke('download:discard', filePaths),

  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  openReleasePage: (): Promise<void> => ipcRenderer.invoke('update:open-page'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  updateDownloader: (): Promise<string> =>
    ipcRenderer.invoke('download:update-tool'),

  onDownloadProgress: (callback: (event: DownloadProgress) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: DownloadProgress) => callback(event)
    ipcRenderer.on('download:progress', listener)
    return () => ipcRenderer.removeListener('download:progress', listener)
  }
})
