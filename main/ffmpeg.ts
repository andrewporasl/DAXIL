import { exportPlan } from '../shared/exportPlan.ts'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import type { CropSelection, ExportOptions, FFmpegEvent } from '../shared/types'
import { buildOverlayFilters } from './ffmpegGraph.ts'

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

function buildSpeedVideoFilter(cropVf: string | null, rate: number): string | null {
  const filters: string[] = []
  if (rate !== 1) filters.push(`setpts=(PTS-STARTPTS)*${(1 / rate).toFixed(6)}`)
  if (cropVf) filters.push(cropVf)
  return filters.length > 0 ? filters.join(',') : null
}

function buildAtempoChain(rate: number): string | null {
  if (rate === 1) return null
  const filters: string[] = []
  let r = rate
  if (rate < 1) {
    while (r < 0.5) { filters.push('atempo=0.5'); r /= 0.5 }
    filters.push(`atempo=${r.toFixed(6)}`)
  } else {
    while (r > 2) { filters.push('atempo=2.0'); r /= 2 }
    filters.push(`atempo=${r.toFixed(6)}`)
  }
  return filters.join(',')
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
    let stderrTail = ''

    proc.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString()
      stderrTail = (stderrTail + d.toString()).slice(-6000)
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) onStderrLine?.(line)
      }
    })

    proc.on('close', (code) => {
      currentProcess = null
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code ?? 'unknown'}\n${stderrTail}`))
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
  if (options.clips?.length) return buildClipFFmpegArgs(options, fileSizeBytes, durationSeconds, videoWidth, videoHeight)
  const { mode, inputPath, trim, compressionLevel, muteAudio, mp3Bitrate = 192, playbackRate = 1 } = options
  const hasTrim = trim.enabled && (trim.startSeconds > 0 || trim.endSeconds < durationSeconds - 0.1)
  const effectiveDur = hasTrim ? trim.endSeconds - trim.startSeconds : durationSeconds
  const normalizedCrop = normalizeCrop(options.crop, videoWidth, videoHeight)
  const cropVf = mode === 'audio' ? null : cropFilter(normalizedCrop)

  // When speed is applied, trim must be input-side (before -i) so setpts sees
  // frames already clipped to the right range. Output-side trim compares against
  // the filtered (sped-up) PTS and would select the wrong section of the video.
  const args: string[] = ['-y']
  if (hasTrim && playbackRate !== 1) {
    args.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  }
  args.push('-i', inputPath)
  if (hasTrim && playbackRate === 1) {
    args.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  }

  if (mode === 'audio') {
    args.push('-vn', '-c:a', 'libmp3lame', '-b:a', `${mp3Bitrate}k`)
    const atempoAf = buildAtempoChain(playbackRate)
    if (atempoAf) args.push('-af', atempoAf)
    args.push(options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.mp3'))
    return args
  }

  // video mode
  const reductionFactor = REDUCTION_MAP[compressionLevel] ?? 0
  const needsEncode = reductionFactor > 0 || hasTrim || Boolean(cropVf) || playbackRate !== 1
  const combinedVf = buildSpeedVideoFilter(cropVf, playbackRate)
  const atempoAf = buildAtempoChain(playbackRate)

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
    if (combinedVf) args.push('-vf', combinedVf)
    args.push('-c:v', 'libx264', '-preset', 'fast', '-b:v', `${vbr}k`)
    if (muteAudio) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', '128k')
      if (atempoAf) args.push('-af', atempoAf)
    }
  } else {
    // trim/speed/crop, no compression — high quality re-encode
    if (combinedVf) args.push('-vf', combinedVf)
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18')
    if (muteAudio) {
      args.push('-an')
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k')
      if (atempoAf) args.push('-af', atempoAf)
    }
  }

  args.push(options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.mp4'))
  return args
}

export function buildClipFFmpegArgs(
  options: ExportOptions,
  fileSizeBytes: number,
  sourceDuration: number,
  videoWidth = 0,
  videoHeight = 0
): string[] {
  const clips = options.clips ?? []
  if (!clips.length) throw new Error('Add at least one clip before exporting.')
  const primary = { fileSizeBytes, durationSeconds: sourceDuration, audioCodec: options.hasAudio ? 'audio' : 'none' }
  const plan = exportPlan(options, primary)
  if (options.mode === 'audio' && !plan.audio) throw new Error('Add an audio track or choose media with audio before exporting.')
  const duration = clips.reduce((total, clip) => total + clip.endSeconds - clip.startSeconds, 0)
  const rate = options.playbackRate ?? 1
  const filters: string[] = []
  const parts: string[] = []
  const args = ['-y', '-i', options.inputPath]
  const paths = [options.inputPath]
  const inputFor = (id?: string) => {
    const asset = options.media?.find(item => item.id === id)
    if (id && !asset) throw new Error('A timeline source is missing from the media pool.')
    const file = asset?.metadata.filePath ?? options.inputPath
    let index = paths.indexOf(file)
    if (index < 0) { index = paths.length; paths.push(file); args.push('-i', file) }
    return { index, meta: asset?.metadata ?? primary }
  }
  const video = options.mode !== 'audio'
  const audio = plan.audio
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index]
    const input = inputFor(clip.mediaId)
    const length = clip.endSeconds - clip.startSeconds
    if (!Number.isFinite(length) || length < 0.1 || clip.startSeconds < 0 || clip.endSeconds > input.meta.durationSeconds + 0.01) throw new Error('A clip has an invalid source range.')
    if (video) {
      const normalize = videoWidth > 0 && videoHeight > 0 ? `,scale=${even(videoWidth)}:${even(videoHeight)}:force_original_aspect_ratio=decrease,pad=${even(videoWidth)}:${even(videoHeight)}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${options.media?.find(asset => asset.metadata.filePath === options.inputPath)?.metadata.fps || 30},format=yuv420p` : ''
      filters.push(`[${input.index}:v]trim=start=${clip.startSeconds}:end=${clip.endSeconds},setpts=PTS-STARTPTS${normalize}[v${index}]`)
      parts.push(`[v${index}]`)
    }
    if (audio) {
      const source = input.meta.audioCodec !== 'none'
        ? `[${input.index}:a]atrim=start=${clip.startSeconds}:end=${clip.endSeconds},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length}`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${length}`
      filters.push(`${source}[a${index}]`)
      parts.push(`[a${index}]`)
    }
  }
  filters.push(`${parts.join('')}concat=n=${clips.length}:v=${video ? 1 : 0}:a=${audio ? 1 : 0}${video ? '[vcat]' : ''}${audio ? '[abase]' : ''}`)
  if (audio) {
    const labels = ['[abase]']
    ;(options.audioClips ?? []).forEach((clip, index) => {
      const input = inputFor(clip.mediaId)
      if (!Number.isFinite(clip.timelineStart) || clip.timelineStart < 0 || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 2 || clip.startSeconds < 0 || clip.endSeconds > input.meta.durationSeconds + 0.01 || clip.endSeconds - clip.startSeconds < 0.1) throw new Error('An audio clip has an invalid range or volume.')
      filters.push(`[${input.index}:a]atrim=start=${clip.startSeconds}:end=${clip.endSeconds},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},adelay=${Math.round(clip.timelineStart * 1000)}:all=1[overlay${index}]`)
      labels.push(`[overlay${index}]`)
    })
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1,atrim=duration=${duration}[acat]`)
  }
  const atempo = buildAtempoChain(rate)

  // Stacked video tracks composite over the sequence before crop, speed and GIF stages.
  let composite = 'vcat'
  if (video && options.overlays?.length) {
    const frameWidth = even(videoWidth || 1280)
    const frameHeight = even(videoHeight || 720)
    const result = buildOverlayFilters(options.overlays, options.hiddenTracks ?? [], frameWidth, frameHeight, mediaId => {
      const input = inputFor(mediaId)
      return { index: input.index, durationSeconds: input.meta.durationSeconds, width: 0, height: 0 }
    })
    filters.push(...result.filters)
    composite = result.output
  }

  if (options.mode === 'audio') {
    const audioOutput = atempo ? 'aout' : 'acat'
    if (atempo) filters.push(`[acat]${atempo}[aout]`)
    args.push('-filter_complex', filters.join(';'), '-map', `[${audioOutput}]`, '-vn', '-c:a', 'libmp3lame', '-b:a', `${options.mp3Bitrate ?? 192}k`)
    args.push(options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.mp3'))
    return args
  }

  const crop = cropFilter(normalizeCrop(options.crop, videoWidth, videoHeight))
  if (options.mode === 'gif') {
    const gifFilters = [rate !== 1 ? `setpts=(PTS-STARTPTS)*${(1 / rate).toFixed(6)}` : null,
      `fps=${options.gifFps ?? 12}`, crop, `scale=${options.gifScale ?? 480}:-1:flags=lanczos`].filter(Boolean).join(',')
    filters.push(`[${composite}]${gifFilters},split[paletteSource][gifSource]`)
    filters.push('[paletteSource]palettegen[palette]')
    filters.push('[gifSource][palette]paletteuse[gifout]')
    args.push('-filter_complex', filters.join(';'), '-map', '[gifout]', '-an', options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.gif'))
    return args
  }

  const videoFilters = [rate !== 1 ? `setpts=(PTS-STARTPTS)*${(1 / rate).toFixed(6)}` : null, crop].filter(Boolean).join(',')
  const videoOutput = videoFilters ? 'vout' : composite
  if (videoFilters) filters.push(`[${composite}]${videoFilters}[vout]`)
  let audioOutput = 'acat'
  if (audio && atempo) { filters.push(`[acat]${atempo}[aout]`); audioOutput = 'aout' }
  args.push('-filter_complex', filters.join(';'), '-map', `[${videoOutput}]`)
  if (audio) args.push('-map', `[${audioOutput}]`)
  else args.push('-an')
  const reduction = REDUCTION_MAP[options.compressionLevel] ?? 0
  if (reduction) {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-b:v', `${plan.videoKbps}k`)
  } else args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18')
  if (audio) args.push('-c:a', 'aac', '-b:a', reduction ? '128k' : '192k')
  args.push(options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.mp4'))
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
  const rate = options.playbackRate ?? 1
  const baseFps = options.gifFps ?? 12
  const speedFilter = rate !== 1 ? `setpts=(PTS-STARTPTS)*${(1 / rate).toFixed(6)}` : null
  const normalizedCrop = normalizeCrop(options.crop, videoWidth, videoHeight)
  const videoFilter = cropFilter(normalizedCrop)
  const scaleFilter = `scale=${scale}:-1:flags=lanczos`
  const gifFilter = [speedFilter, 'fps=' + baseFps, videoFilter, scaleFilter].filter(Boolean).join(',')
  const palettePath = path.join(os.tmpdir(), `daxil_palette_${Date.now()}.png`)
  const outputPath = options.outputPath ?? path.join(options.outputDir, options.outputFileName + '.gif')

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

export async function gifPreview(
  options: ExportOptions,
  durationSeconds: number,
  videoWidth: number,
  videoHeight: number,
  ffmpegPath: string
): Promise<string> {
  if (options.clips?.length) {
    const outputPath = path.join(os.tmpdir(), `daxil_preview_${Date.now()}.gif`)
    await runFFmpeg({ ...options, outputPath, gifScale: 320 }, 0, durationSeconds, videoWidth, videoHeight, ffmpegPath, () => {})
    const data = fs.readFileSync(outputPath)
    try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
    return 'data:image/gif;base64,' + data.toString('base64')
  }
  const { inputPath, trim } = options
  const hasTrim = trim.enabled && (trim.startSeconds > 0 || trim.endSeconds < durationSeconds - 0.1)
  const rate = options.playbackRate ?? 1
  const baseFps = options.gifFps ?? 12
  const previewScale = Math.min(options.gifScale ?? 480, 240)
  const speedFilter = rate !== 1 ? `setpts=(PTS-STARTPTS)*${(1 / rate).toFixed(6)}` : null
  const normalizedCrop = normalizeCrop(options.crop, videoWidth, videoHeight)
  const vf = cropFilter(normalizedCrop)
  const scaleFilter = `scale=${previewScale}:-1:flags=lanczos`
  const gifFilter = [speedFilter, 'fps=' + baseFps, vf, scaleFilter].filter(Boolean).join(',')
  const palettePath = path.join(os.tmpdir(), `daxil_prev_palette_${Date.now()}.png`)
  const outputPath = path.join(os.tmpdir(), `daxil_preview_${Date.now()}.gif`)

  const paletteArgs = ['-y']
  if (hasTrim) paletteArgs.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  paletteArgs.push('-i', inputPath, '-vf', `${gifFilter},palettegen`, palettePath)
  await spawnProcess(ffmpegPath, paletteArgs)

  const gifArgs = ['-y']
  if (hasTrim) gifArgs.push('-ss', trim.startSeconds.toString(), '-to', trim.endSeconds.toString())
  gifArgs.push('-i', inputPath, '-i', palettePath, '-lavfi', `${gifFilter}[x];[x][1:v]paletteuse`, '-t', '3', outputPath)
  await spawnProcess(ffmpegPath, gifArgs)

  try { fs.unlinkSync(palettePath) } catch { /* ignore */ }

  const data = fs.readFileSync(outputPath)
  try { fs.unlinkSync(outputPath) } catch { /* ignore */ }
  return 'data:image/gif;base64,' + data.toString('base64')
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
  if (options.mode === 'gif' && !options.clips?.length) {
    return runGif(options, durationSeconds, videoWidth, videoHeight, ffmpegPath, onEvent)
  }

  return new Promise((resolve, reject) => {
    const hasTrim = options.trim.enabled && (options.trim.startSeconds > 0 || options.trim.endSeconds < durationSeconds - 0.1)
    const effectiveDuration = options.clips?.length
      ? options.clips.reduce((total, clip) => total + clip.endSeconds - clip.startSeconds, 0) / (options.playbackRate ?? 1)
      : hasTrim ? options.trim.endSeconds - options.trim.startSeconds : durationSeconds
    const args = buildFFmpegArgs(options, fileSizeBytes, durationSeconds, videoWidth, videoHeight)
    const outputPath = args[args.length - 1]

    const proc = spawn(ffmpegPath, args)
    currentProcess = proc
    let failedToSpawn = false

    const logLines: string[] = []

    let stderrTail = ''
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderrTail = (stderrTail + chunk).slice(-6000)
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
      if (failedToSpawn) return
      if (code === 0) {
        try {
          const stat = fs.statSync(outputPath)
          if (stat.size === 0) throw new Error('The exported file is empty.')
          onEvent({ type: 'complete', outputPath, outputSizeBytes: stat.size })
          resolve(outputPath)
        } catch (error) {
          const message = `FFmpeg reported success but the output could not be read: ${error instanceof Error ? error.message : String(error)}`
          onEvent({ type: 'error', message })
          reject(new Error(message))
        }
      } else {
        const raw = stderrTail || logLines.slice(-20).join('\n')
        onEvent({ type: 'error', message: `FFmpeg exited with code ${code}`, raw })
        reject(new Error(`FFmpeg exited with code ${code}\n${raw}`))
      }
    })

    proc.on('error', (err) => {
      failedToSpawn = true
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
