import { app, net } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { DownloadProgress, DownloadResult } from '../shared/types'
import { friendlyDownloadError, nextClipName, normalizeLink, parseProgressLine, ytDlpArgs, ytDlpAssetName, YT_DLP_RELEASE_URL } from './downloaderCore'

type Progress = (event: DownloadProgress) => void

let current: ChildProcess | null = null
let fetching: Promise<string> | null = null

export function managedPath(): string {
  return path.join(app.getPath('userData'), 'bin', ytDlpAssetName())
}

function works(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const proc = spawn(binary, ['--version'], { windowsHide: true })
      let output = ''
      proc.stdout.on('data', data => { output += String(data) })
      proc.on('error', () => resolve(false))
      proc.on('close', code => resolve(code === 0 && /\d{4}\.\d{2}/.test(output)))
    } catch { resolve(false) }
  })
}

// Stream the latest yt-dlp release into userData/bin. Only one fetch runs at a time.
async function fetchYtDlp(progress: Progress): Promise<string> {
  if (fetching) return fetching
  fetching = (async () => {
    const target = managedPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const partial = `${target}.part`
    progress({ phase: 'tool', percent: null, message: 'Getting the downloader…' })
    let response: Response
    try {
      response = await net.fetch(YT_DLP_RELEASE_URL + ytDlpAssetName(), { redirect: 'follow' })
    } catch (error) {
      throw new Error(`Couldn't download yt-dlp (${error instanceof Error ? error.message : String(error)}). Check your connection, or set a yt-dlp path in Settings.`)
    }
    if (!response.ok || !response.body) throw new Error(`Couldn't download yt-dlp (HTTP ${response.status}). Try again later, or set a yt-dlp path in Settings.`)
    const total = Number(response.headers.get('content-length')) || 0
    const file = fs.createWriteStream(partial)
    const reader = response.body.getReader()
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!file.write(value)) await new Promise<void>(resolve => file.once('drain', () => resolve()))
        progress({ phase: 'tool', percent: total ? Math.round(received / total * 100) : null, message: 'Getting the downloader…' })
      }
      await new Promise<void>((resolve, reject) => { file.on('error', reject); file.end(() => resolve()) })
      if (process.platform !== 'win32') fs.chmodSync(partial, 0o755)
      fs.renameSync(partial, target)
    } catch (error) {
      file.destroy()
      fs.rmSync(partial, { force: true })
      throw error
    }
    if (!(await works(target))) { fs.rmSync(target, { force: true }); throw new Error('The downloaded yt-dlp did not start. Set a yt-dlp path in Settings.') }
    return target
  })()
  try { return await fetching } finally { fetching = null }
}

export async function resolveYtDlp(setting: string | undefined, progress: Progress): Promise<string> {
  const value = (setting ?? '').trim()
  if (value && value !== 'auto') {
    if (await works(value)) return value
    throw new Error(`yt-dlp at "${value}" is not a working yt-dlp executable. Check the path in Settings.`)
  }
  const managed = managedPath()
  if (fs.existsSync(managed)) return managed
  return fetchYtDlp(progress)
}

export async function updateYtDlp(setting: string | undefined): Promise<string> {
  const binary = await resolveYtDlp(setting, () => {})
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ['-U'], { windowsHide: true })
    let output = ''
    proc.stdout.on('data', data => { output += String(data) })
    proc.stderr.on('data', data => { output += String(data) })
    proc.on('error', error => reject(new Error(error.message)))
    proc.on('close', code => code === 0 ? resolve(output.trim().split(/\r?\n/).pop() ?? 'Up to date') : reject(new Error(output.trim() || 'Update failed')))
  })
}

export function cancelDownload(): void {
  current?.kill()
  current = null
}

export async function downloadLink(rawUrl: string, options: { ytDlpPath?: string; ffmpegPath: string; downloadDir: string }, progress: Progress): Promise<DownloadResult> {
  const url = normalizeLink(rawUrl)
  if (!url) throw new Error('Paste a full http(s) link.')
  if (current) throw new Error('A download is already running.')
  const binary = await resolveYtDlp(options.ytDlpPath, progress)
  fs.mkdirSync(options.downloadDir, { recursive: true })
  const ffmpegDir = options.ffmpegPath && options.ffmpegPath !== 'ffmpeg' && fs.existsSync(options.ffmpegPath) ? path.dirname(options.ffmpegPath) : null
  const name = nextClipName(fs.readdirSync(options.downloadDir))
  const template = path.join(options.downloadDir, `${name}.%(ext)s`)
  progress({ phase: 'media', percent: 0, message: 'Downloading…' })
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ytDlpArgs(url, template, ffmpegDir), { windowsHide: true })
    current = proc
    const printed: string[] = []
    let stderr = ''
    let rest = ''
    proc.stdout.on('data', data => {
      rest += String(data)
      const lines = rest.split(/\r?\n/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const percent = parseProgressLine(line)
        if (percent !== null) progress({ phase: 'media', percent, message: 'Downloading…' })
        else if (/^\[Merger\]|^\[ffmpeg\]/i.test(line)) progress({ phase: 'media', percent: 100, message: 'Merging…' })
        else if (line.trim() && !line.startsWith('[')) printed.push(line.trim())
      }
    })
    proc.stderr.on('data', data => { stderr += String(data) })
    proc.on('error', error => { current = null; reject(new Error(`yt-dlp could not start: ${error.message}`)) })
    proc.on('close', code => {
      const cancelled = current !== proc
      current = null
      if (cancelled) { reject(new Error('Download cancelled.')); return }
      if (rest.trim() && !rest.startsWith('[')) printed.push(rest.trim())
      // --print emits the file path and then the title, each on its own line.
      const filePath = [...printed].reverse().find(line => path.isAbsolute(line) && fs.existsSync(line))
      if (code !== 0 || !filePath) { reject(new Error(friendlyDownloadError(stderr))); return }
      resolve({ filePath, title: name })
    })
  })
}
