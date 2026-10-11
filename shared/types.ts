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

export interface TimelineClip {
  id: string
  mediaId?: string
  startSeconds: number
  endSeconds: number
}

export interface MediaAsset {
  id: string
  kind: 'video' | 'audio'
  metadata: VideoMetadata
  thumbnail?: string
}

export interface AudioClip extends TimelineClip {
  mediaId: string
  timelineStart: number
  volume: number
}

// A video clip on V2 and above. Position and size are fractions of the frame;
// `scale` is the overlay width divided by the frame width.
export interface OverlayClip extends TimelineClip {
  mediaId: string
  timelineStart: number
  track: number
  x: number
  y: number
  scale: number
  opacity: number
}

export interface CropSelection {
  enabled: boolean
  x: number
  y: number
  width: number
  height: number
}

export type CompressionLevel = 'none' | '25' | '50' | '75' | '90'
export type ExportMode = 'video' | 'audio' | 'gif'
export type Mp3Bitrate = 128 | 192 | 320
export type GifScale = 320 | 480 | 640
export type GifFps = 8 | 12 | 15 | 20

export interface ExportOptions {
  mode: ExportMode
  inputPath: string
  outputDir: string
  outputFileName: string
  outputPath?: string
  clips?: TimelineClip[]
  media?: MediaAsset[]
  audioClips?: AudioClip[]
  overlays?: OverlayClip[]
  hiddenTracks?: number[]
  hasAudio?: boolean
  trim: TrimRange
  crop: CropSelection
  compressionLevel: CompressionLevel
  muteAudio: boolean
  mp3Bitrate?: Mp3Bitrate
  gifScale?: GifScale
  gifFps?: GifFps
  playbackRate?: number
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
  ytDlpPath: string
  defaultOutputDir: string
  downloadDir: string
}

export interface DownloadProgress {
  phase: 'tool' | 'media'
  percent: number | null
  message: string
}

export interface DownloadResult {
  filePath: string
  title: string
}
