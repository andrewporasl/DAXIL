/// <reference types="vite/client" />

import type { ExportOptions, FFmpegEvent, VideoMetadata, AppSettings, DownloadProgress, DownloadResult, StorageLocation, UpdateStatus } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      openMedia: () => Promise<string[]>
      measureExport: (options: ExportOptions) => Promise<number>
      openFile: () => Promise<string | null>
      openFolderDialog: () => Promise<string | null>
      convertOutputPath: (mode: ExportOptions['mode'], name: string) => Promise<string>
      saveExportDialog: (mode: ExportOptions['mode'], defaultPath: string) => Promise<string | null>
      getPathForFile: (file: File) => string
      getMetadata: (filePath: string) => Promise<VideoMetadata>
      getThumbnails: (filePath: string, duration: number, count: number) => Promise<string[]>
      runFFmpeg: (options: ExportOptions) => Promise<void>
      cancelFFmpeg: () => Promise<void>
      previewGif: (options: ExportOptions) => Promise<string>
      previewVideo: (options: ExportOptions) => Promise<{ path: string; sizeBytes: number }>
      onFFmpegEvent: (callback: (event: FFmpegEvent) => void) => () => void
      openFolder: (folderPath: string) => Promise<void>
      openNewWindow: () => Promise<void>
      getSettings: () => Promise<AppSettings>
      getStorage: () => Promise<StorageLocation[]>
      revealStorage: (key: string) => Promise<boolean>
      saveSettings: (settings: Partial<AppSettings>) => Promise<void>
      downloadLink: (url: string) => Promise<DownloadResult>
      cancelDownload: () => Promise<void>
      discardDownloads: (filePaths: string[]) => Promise<number>
      makePreviewProxy: (filePath: string) => Promise<string>
      updateDownloader: () => Promise<string>
      getUpdateStatus: () => Promise<UpdateStatus>
      checkForUpdates: () => Promise<UpdateStatus>
      downloadUpdate: () => Promise<UpdateStatus>
      installUpdate: () => Promise<void>
      openReleasePage: () => Promise<void>
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
      onDownloadProgress: (callback: (event: DownloadProgress) => void) => () => void
    }
  }
}
