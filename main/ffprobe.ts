import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { VideoMetadata } from '../shared/types'

function evalFraction(frac: string): number {
  const parts = frac.split('/')
  if (parts.length === 2) {
    const num = parseFloat(parts[0])
    const den = parseFloat(parts[1])
    return den !== 0 ? num / den : 0
  }
  return parseFloat(frac) || 0
}

export function readMetadata(filePath: string, ffprobePath = 'ffprobe'): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ]

    const proc = spawn(ffprobePath, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (exit ${code}): ${stderr}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout)
        const streams: Record<string, unknown>[] = parsed.streams || []
        const format: Record<string, unknown> = parsed.format || {}

        const videoStream = streams.find((s) => s['codec_type'] === 'video') || {}
        const audioStream = streams.find((s) => s['codec_type'] === 'audio') || {}

        const durationSeconds = parseFloat((format['duration'] as string) || '0')
        const totalBitrate = parseInt((format['bit_rate'] as string) || '0', 10)
        const fileSizeBytes = parseInt((format['size'] as string) || '0', 10)

        const videoBitrate = parseInt((videoStream['bit_rate'] as string) || '0', 10)
        const audioBitrate = parseInt((audioStream['bit_rate'] as string) || '0', 10)

        const fpsRaw = (videoStream['r_frame_rate'] as string) || '0/1'
        const fps = Math.round(evalFraction(fpsRaw) * 100) / 100

        const formatNames: string = (format['format_name'] as string) || ''
        const ext = path.extname(filePath).replace('.', '').toLowerCase()
        const fmt = ext || formatNames.split(',')[0] || 'unknown'

        const meta: VideoMetadata = {
          filePath,
          fileName: path.basename(filePath),
          durationSeconds,
          width: (videoStream['width'] as number) || 0,
          height: (videoStream['height'] as number) || 0,
          format: fmt,
          videoCodec: (videoStream['codec_name'] as string) || 'unknown',
          audioCodec: (audioStream['codec_name'] as string) || 'none',
          videoBitrate,
          audioBitrate,
          totalBitrate,
          fileSizeBytes: fileSizeBytes || fs.statSync(filePath).size,
          fps
        }

        resolve(meta)
      } catch (e) {
        reject(new Error(`ffprobe JSON parse error: ${e}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}. Check your DAXIL settings if you need to override the bundled binary path.`))
    })
  })
}
