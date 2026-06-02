import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { CropSelection, ExportOptions, FFmpegEvent } from '../shared/types'

let currentProcess: ChildProcess | null = null

const TIME_REGEX = /time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/

function parseTimeToSeconds(h: string, m: string, s: string, cs: string): number {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(cs) / 100
}

function calcVideoBitrateKbps(
  targetSizeBytes: number,
  effectiveDuration: number,
  audioBitrateKbps = 128
): number {
  if (effectiveDuration <= 0) return 1000
  const targetBps = (targetSizeBytes * 8) / effectiveDuration
  return Math.max(Math.floor((targetBps - audioBitrateKbps * 1000) / 1000), 200)
}

const REDUCTION_MAP: Record<string, number> = {
  '25': 0.25, '50': 0.50, '75': 0.75, '90': 0.90
}

type ProgressSender = (event: FFmpegEvent) => void

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function even(value: number): number {
  return Math.floor(value / 2) * 2
}

function normalizeCrop(
  crop: CropSelection | undefined,
  videoWidth: number,
  videoHeight: number
): CropSelection | null {
  if (!crop?.enabled || videoWidth <= 1 || videoHeight <= 1) return null

  const maxWidth = even(videoWidth)
  const maxHeight = even(videoHeight)
  if (maxWidth <= 0 || maxHeight <= 0) return null

  const width = clamp(even(crop.width), 2, maxWidth)
  const height = clamp(even(crop.height), 2, maxHeight)
  const x = clamp(even(crop.x), 0, Math.max(0, videoWidth - width))
  const y = clamp(even(crop.y), 0, Math.max(0, videoHeight - height))

  return { enabled: true, x, y, width, height }
}

function cropFilter(crop: CropSelection | null): string | null {
  return crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : null
}

function spawnProcess(
  cmd: string,
  args: string[],
  onStderrLine?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    currentProcess = proc

    let stderrBuf = ''

    proc.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) onStderrLine?.(line)
      }
    })

    proc.on('close', (code) => {
      if (code === 0 || code === null) resolve()
      else reject(new Error(`FFmpeg exited with code ${code}\n${stderrBuf}`))
    })

    proc.on('error', (err) => reject(err))
  })
}

export function buildFFmpegArgs(
  options: ExportOptions,
  fileSizeBytes: number,
  durationSeconds: number,
  videoWidth = 0,
  videoHeight = 0
): string[] {
  const { mode, inputPath, trim, compressionLevel, muteAudio, mp3Bitrate = 192 } = options
  const hasTrim = trim.enabled && (trim.startSeconds > 0 || trim.endSeconds < durationSeconds - 0.1)
  const effectiveDur = hasTrim ? trim.endSeconds - trim.startSeconds : durationSeconds
  const normalizedCrop = normalizeCrop(options.crop, videoWidth, videoHeight)
  const videoFilter = mode === 'audio' ? null : cropFilter(normalizedCrop)

  const args: string[] = ['-y', '-i', inputPath]

  if (hasTrim) {
    args.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  }

  if (mode === 'audio') {
    args.push('-vn', '-c:a', 'libmp3lame', '-b:a', `${mp3Bitrate}k`)
    args.push(path.join(options.outputDir, options.outputFileName + '.mp3'))
    return args
  }

  // video mode
  const reductionFactor = REDUCTION_MAP[compressionLevel] ?? 0
  const needsEncode = reductionFactor > 0 || hasTrim || Boolean(videoFilter)

  if (!needsEncode) {
    // no compression, no trim → stream copy
    if (muteAudio) {
      args.push('-c:v', 'copy', '-an')
    } else {
      args.push('-c', 'copy')
    }
  } else if (reductionFactor > 0) {
    // bitrate-based compression
    const targetSizeBytes = fileSizeBytes * (1 - reductionFactor)
    const vbr = calcVideoBitrateKbps(targetSizeBytes, effectiveDur)
    if (videoFilter) args.push('-vf', videoFilter)
    args.push('-c:v', 'libx264', '-preset', 'fast', '-b:v', `${vbr}k`)
    if (muteAudio) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k')
    }
  } else {
    // trim only, no compression — high quality re-encode
    if (videoFilter) args.push('-vf', videoFilter)
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18')
    if (muteAudio) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k')
    }
  }

  args.push(path.join(options.outputDir, options.outputFileName + '.mp4'))
  return args
}

async function runGif(
  options: ExportOptions,
  durationSeconds: number,
  videoWidth: number,
  videoHeight: number,
  ffmpegPath: string,
  onEvent: ProgressSender
): Promise<string> {
  const { inputPath, trim } = options
  const hasTrim = trim.enabled && (trim.startSeconds > 0 || trim.endSeconds < durationSeconds - 0.1)
  const effectiveDur = hasTrim ? trim.endSeconds - trim.startSeconds : durationSeconds
  const scale = options.gifScale || 480
  const fps = 12
  const normalizedCrop = normalizeCrop(options.crop, videoWidth, videoHeight)
  const videoFilter = cropFilter(normalizedCrop)
  const scaleFilter = `scale=${scale}:-1:flags=lanczos`
  const gifFilter = ['fps=' + fps, videoFilter, scaleFilter].filter(Boolean).join(',')
  const palettePath = path.join(os.tmpdir(), `daxil_palette_${Date.now()}.png`)
  const outputPath = path.join(options.outputDir, options.outputFileName + '.gif')

  // Pass 1: generate palette
  const paletteArgs = ['-y']
  if (hasTrim) paletteArgs.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  paletteArgs.push('-i', inputPath, '-vf', `${gifFilter},palettegen`, palettePath)

  await spawnProcess(ffmpegPath, paletteArgs)
  onEvent({ type: 'progress', currentSeconds: effectiveDur * 0.4, totalSeconds: effectiveDur, percent: 40, logLine: 'Palette ready, encoding GIF...' })

  // Pass 2: encode GIF
  const gifArgs = ['-y']
  if (hasTrim) gifArgs.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  gifArgs.push(
    '-i', inputPath,
    '-i', palettePath,
    '-lavfi', `${gifFilter}[x];[x][1:v]paletteuse`,
    outputPath
  )

  await spawnProcess(ffmpegPath, gifArgs, (line) => {
    const m = TIME_REGEX.exec(line)
    if (m) {
      const cur = parseTimeToSeconds(m[1], m[2], m[3], m[4])
      const pct = effectiveDur > 0 ? Math.min(Math.round(40 + (cur / effectiveDur) * 59), 99) : 40
      onEvent({ type: 'progress', currentSeconds: cur, totalSeconds: effectiveDur, percent: pct, logLine: line })
    }
  })

  try { fs.unlinkSync(palettePath) } catch { /* ignore */ }

  const stat = fs.statSync(outputPath)
  onEvent({ type: 'complete', outputPath, outputSizeBytes: stat.size })
  return outputPath
}

export function runFFmpeg(
  options: ExportOptions,
  fileSizeBytes: number,
  durationSeconds: number,
  videoWidth: number,
  videoHeight: number,
  ffmpegPath: string,
  onEvent: ProgressSender
): Promise<string> {
  if (options.mode === 'gif') {
    return runGif(options, durationSeconds, videoWidth, videoHeight, ffmpegPath, onEvent)
  }

  return new Promise((resolve, reject) => {
    const hasTrim = options.trim.enabled && (options.trim.startSeconds > 0 || options.trim.endSeconds < durationSeconds - 0.1)
    const effectiveDuration = hasTrim ? options.trim.endSeconds - options.trim.startSeconds : durationSeconds
    const args = buildFFmpegArgs(options, fileSizeBytes, durationSeconds, videoWidth, videoHeight)
    const outputPath = args[args.length - 1]

    const proc = spawn(ffmpegPath, args)
    currentProcess = proc

    const logLines: string[] = []

    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue
        logLines.push(line)
        if (logLines.length > 500) logLines.shift()
        const m = TIME_REGEX.exec(line)
        if (m) {
          const cur = parseTimeToSeconds(m[1], m[2], m[3], m[4])
          const pct = effectiveDuration > 0 ? Math.min(Math.round((cur / effectiveDuration) * 100), 99) : 0
          onEvent({ type: 'progress', currentSeconds: cur, totalSeconds: effectiveDuration, percent: pct, logLine: line })
        }
      }
    })

    proc.on('close', (code) => {
      currentProcess = null
      if (code === 0 || code === null) {
        try {
          const stat = fs.statSync(outputPath)
          onEvent({ type: 'complete', outputPath, outputSizeBytes: stat.size })
          resolve(outputPath)
        } catch {
          onEvent({ type: 'complete', outputPath, outputSizeBytes: 0 })
          resolve(outputPath)
        }
      } else {
        const raw = logLines.slice(-20).join('\n')
        onEvent({ type: 'error', message: `FFmpeg exited with code ${code}`, raw })
        reject(new Error(`FFmpeg exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      currentProcess = null
      const msg = `Failed to spawn ffmpeg: ${err.message}`
      onEvent({ type: 'error', message: msg })
      reject(new Error(msg))
    })
  })
}

export function cancelFFmpeg(): void {
  if (currentProcess) {
    currentProcess.kill('SIGTERM')
    currentProcess = null
  }
}

function extractFrame(filePath: string, timestamp: number, ffmpegPath: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      '-y', '-ss', timestamp.toFixed(3),
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2:black',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-'
    ]
    const proc = spawn(ffmpegPath, args)
    const chunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.on('close', () => {
      if (chunks.length > 0) {
        resolve('data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64'))
      } else {
        resolve('')
      }
    })
    proc.on('error', () => resolve(''))
  })
}

export async function generateThumbnails(
  filePath: string,
  duration: number,
  count: number,
  ffmpegPath: string
): Promise<string[]> {
  if (duration <= 0 || count <= 0) return []
  const interval = duration / count
  const timestamps = Array.from({ length: count }, (_, i) => Math.min((i + 0.5) * interval, duration - 0.1))

  const results: string[] = []
  const BATCH = 4
  for (let i = 0; i < timestamps.length; i += BATCH) {
    const batch = timestamps.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map((ts) => extractFrame(filePath, ts, ffmpegPath)))
    results.push(...batchResults)
  }
  return results
}
