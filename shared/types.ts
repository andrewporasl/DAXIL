export interface VideoMetadata {
  filePath: string
  fileName: string
  durationSeconds: number
  width: number
  height: number
  format: string
  videoCodec: string
  audioCodec: string
  videoBitrate: number
  audioBitrate: number
  totalBitrate: number
  fileSizeBytes: number
  fps: number
}

export interface TrimRange {
  enabled: boolean
  startSeconds: number
  endSeconds: number
}

export type CompressionLevel = 'none' | '25' | '50' | '75' | '90'
export type ExportMode = 'video' | 'audio' | 'gif'
export type Mp3Bitrate = 128 | 192 | 320
export type GifScale = 320 | 480 | 640

export interface ExportOptions {
  mode: ExportMode
  inputPath: string
  outputDir: string
  outputFileName: string
  trim: TrimRange
  compressionLevel: CompressionLevel
  muteAudio: boolean
  mp3Bitrate?: Mp3Bitrate
  gifScale?: GifScale
}

export interface ProgressEvent {
  type: 'progress'
  currentSeconds: number
  totalSeconds: number
  percent: number
  logLine: string
}

export interface CompletionEvent {
  type: 'complete'
  outputPath: string
  outputSizeBytes: number
}

export interface ErrorEvent {
  type: 'error'
  message: string
  raw?: string
}

export type FFmpegEvent = ProgressEvent | CompletionEvent | ErrorEvent

export interface AppSettings {
  ffmpegPath: string
  ffprobePath: string
  defaultOutputDir: string
}
