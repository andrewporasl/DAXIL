/// <reference types="vite/client" />

import type { ExportOptions, FFmpegEvent, VideoMetadata, AppSettings, DownloadProgress, DownloadResult } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      openMedia: () => Promise<string[]>
      measureExport: (options: ExportOptions) => Promise<number>
      openFile: () => Promise<string | null>
      openFolderDialog: () => Promise<string | null>
      saveExportDialog: (mode: ExportOptions['mode'], defaultPath: string) => Promise<string | null>
      getPathForFile: (file: File) => string
      getMetadata: (filePath: string) => Promise<VideoMetadata>
      getThumbnails: (filePath: string, duration: number, count: number) => Promise<string[]>
      runFFmpeg: (options: ExportOptions) => Promise<void>
      cancelFFmpeg: () => Promise<void>
      previewGif: (options: ExportOptions) => Promise<string>
      onFFmpegEvent: (callback: (event: FFmpegEvent) => void) => () => void
      openFolder: (folderPath: string) => Promise<void>
      openNewWindow: () => Promise<void>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<void>
      downloadLink: (url: string) => Promise<DownloadResult>
      cancelDownload: () => Promise<void>
      updateDownloader: () => Promise<string>
      onDownloadProgress: (callback: (event: DownloadProgress) => void) => () => void
    }
  }
}
