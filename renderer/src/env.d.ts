/// <reference types="vite/client" />

import type { ExportOptions, FFmpegEvent, VideoMetadata, AppSettings } from '../../shared/types'

declare global {
  interface Window {
    electronAPI: {
      openFile: () => Promise<string | null>
      openFolderDialog: () => Promise<string | null>
      getMetadata: (filePath: string) => Promise<VideoMetadata>
      getThumbnails: (filePath: string, duration: number, count: number) => Promise<string[]>
      runFFmpeg: (options: ExportOptions) => Promise<void>
      cancelFFmpeg: () => Promise<void>
      onFFmpegEvent: (callback: (event: FFmpegEvent) => void) => () => void
      openFolder: (folderPath: string) => Promise<void>
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<void>
    }
  }
}
