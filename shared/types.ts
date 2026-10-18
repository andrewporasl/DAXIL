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

// Legacy single-file export range (used only when there are no clips).
export interface LegacyClip {
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
  name?: string          // display name; defaults to the file name
  temporary?: boolean    // downloaded from a link: deleted once the project is done with it
}

// Title text. Size is a fraction of the frame height; the font is a key from the renderer's font list.
export interface TextStyle {
  content: string
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  effect: 'none' | 'shadow' | 'outline' | 'box'
}

// Every clip on the timeline (video, audio or text) sits freely on a numbered track.
// Video transform values are fractions of the project frame (full frame = 0, 0, 1).
// Text clips have no media (mediaId is ''); their x/y is the centre of the text block.
export interface Clip {
  id: string
  mediaId: string
  kind: 'video' | 'audio' | 'text'
  track: number
  timelineStart: number
  startSeconds: number
  endSeconds: number
  x: number
  y: number
  scale: number
  opacity: number
  volume: number
  muted: boolean
  // Playback speed of this clip alone (1 = normal). Its timeline length is the source range divided
  // by it; the project-wide speed still applies on top at export. Missing means 1.
  speed?: number
  text?: TextStyle
}

export interface Project {
  width: number
  height: number
  fps: number
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
  clips?: Clip[]
  media?: MediaAsset[]
  project?: Project
  hiddenVideoTracks?: number[]
  mutedAudioTracks?: number[]
  hasAudio?: boolean
  trim: TrimRange
  crop: CropSelection
  compressionLevel: CompressionLevel
  muteAudio: boolean
  mp3Bitrate?: Mp3Bitrate
  gifScale?: GifScale
  gifFps?: GifFps
  playbackRate?: number
  // Text clip id -> transparent full-frame PNG. The renderer sends data URLs; main swaps them for temp files.
  textImages?: Record<string, string>
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
  convertOutputDir?: string   // where "Convert and save" puts files made straight from links
  checkForUpdates?: boolean
}

// 'auto': this copy can download and install updates itself (Windows installer, Linux AppImage).
// 'manual': it can only tell you about a new version (macOS unsigned builds, portable ZIP, tarball).
// 'dev': running from source; updates are never installed.
export type UpdateMode = 'auto' | 'manual' | 'dev'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  mode: UpdateMode
  current: string
  version?: string
  percent?: number
  message?: string
}

export interface StorageLocation {
  key: string
  label: string
  path: string
  note: string
  exists: boolean
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
