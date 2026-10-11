// Pure helpers for the link downloader, kept free of Electron so they can be unit tested.

export function ytDlpAssetName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  return 'yt-dlp_linux'
}

export const YT_DLP_RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'

// Only plain web links are handed to yt-dlp. Anything else is rejected before a process spawns.
export function normalizeLink(text: string): string | null {
  const candidate = text.trim().split(/\s+/)[0] ?? ''
  if (!candidate) return null
  let url: URL
  try { url = new URL(candidate) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
  if (url.username || url.password) return null
  return url.toString()
}

export function isProbablyMediaLink(text: string): boolean {
  const link = normalizeLink(text)
  if (!link) return false
  return /youtube\.com|youtu\.be|twitter\.com|x\.com|tiktok\.com|instagram\.com|vimeo\.com|reddit\.com|twitch\.tv|streamable\.com|facebook\.com|\.(mp4|webm|mov|gif)(\?|$)/i.test(link)
}

export function ytDlpArgs(url: string, outputTemplate: string, ffmpegDir: string | null): string[] {
  const args = [
    '--no-playlist', '--newline', '--progress', '--no-warnings',
    '--restrict-filenames', '--no-mtime',
    '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--print', 'after_move:filepath',
    '--print', 'title',
    '-o', outputTemplate
  ]
  if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir)
  args.push('--', url)
  return args
}

// yt-dlp prints "[download]  45.2% of  12.34MiB at ..." with --newline.
export function parseProgressLine(line: string): number | null {
  const match = /\[download\]\s+(\d{1,3}(?:\.\d+)?)%/.exec(line)
  if (!match) return null
  const percent = Number(match[1])
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null
}

// Turn yt-dlp's stderr into something a person can act on.
export function friendlyDownloadError(stderr: string): string {
  const text = stderr.toLowerCase()
  if (/private video|this video is private/.test(text)) return 'That video is private.'
  if (/sign in to confirm|age-restricted|age restricted|login required|requires authentication/.test(text)) return 'That link needs a signed-in account, which DAXIL cannot provide.'
  if (/not available in your country|geo.?restrict|blocked it in your country/.test(text)) return 'That video is not available in your region.'
  if (/unsupported url/.test(text)) return 'That site is not supported.'
  if (/video unavailable|has been removed|does not exist|404/.test(text)) return 'That video is unavailable or has been removed.'
  if (/getaddrinfo|network is unreachable|unable to download webpage|connection|timed out/.test(text)) return 'Could not reach that site. Check your connection.'
  if (/no video formats found|requested format is not available/.test(text)) return 'No downloadable video was found at that link.'
  const lastError = stderr.split(/\r?\n/).reverse().find(line => /error/i.test(line))
  return lastError ? lastError.replace(/^ERROR:\s*/i, '').trim() : 'The download failed.'
}
