import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Some sources play fine in FFmpeg but not in Chromium's <video>: iPhone HEVC/HDR files (their edit
// lists trip Chromium's demuxer), ProRes, Motion JPEG… For those the preview uses a light H.264 copy.
// Export always reads the original. Copies live in a per-run temp folder that is removed on quit.
export const PROXY_ROOT = path.join(os.tmpdir(), 'daxil-proxies')
const runDir = path.join(PROXY_ROOT, `run-${process.pid}-${Date.now().toString(36)}`)
const STALE_MS = 12 * 60 * 60 * 1000
const jobs = new Map<string, Promise<string>>()

export function proxyArgs(input: string, output: string): string[] {
  return [
    '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    // 720 px on the short side is plenty for the preview pane; frequent keyframes keep scrubbing snappy.
    '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)',format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '15',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    output
  ]
}

export function makePreviewProxy(input: string, ffmpegPath: string): Promise<string> {
  const stat = fs.statSync(input)
  const key = `${path.normalize(input)}|${stat.size}|${stat.mtimeMs}`
  const existing = jobs.get(key)
  if (existing) return existing
  fs.mkdirSync(runDir, { recursive: true })
  const output = path.join(runDir, `proxy-${jobs.size + 1}.mp4`)
  const job = new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpegPath, proxyArgs(input, output), { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4000) })
    proc.on('error', error => reject(error))
    proc.on('close', code => code === 0 && fs.existsSync(output) ? resolve(output) : reject(new Error(`Could not make a preview copy: ${stderr.trim().split('\n').pop() ?? code}`)))
  })
  job.catch(() => jobs.delete(key))
  jobs.set(key, job)
  return job
}

export function discardProxies(): void {
  try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* ignore */ }
}

export function sweepStaleProxies(now = Date.now()): void {
  let entries: string[] = []
  try { entries = fs.readdirSync(PROXY_ROOT) } catch { return }
  for (const name of entries) {
    const dir = path.join(PROXY_ROOT, name)
    if (!name.startsWith('run-') || dir === runDir) continue
    try { if (now - fs.statSync(dir).mtimeMs > STALE_MS) fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
