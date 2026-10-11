import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverlayFilters } from '../main/ffmpegGraph.ts'
import { friendlyDownloadError, normalizeLink, parseProgressLine, ytDlpArgs, ytDlpAssetName } from '../main/downloaderCore.ts'

const inputs = { a: { index: 1, durationSeconds: 10, width: 640, height: 360 }, b: { index: 2, durationSeconds: 5, width: 320, height: 180 } }
const overlay = (extra) => ({ id: 'o', mediaId: 'a', startSeconds: 0, endSeconds: 2, timelineStart: 1, track: 1, x: 0.5, y: 0.1, scale: 0.4, opacity: 1, ...extra })

test('overlays chain in track order and thread into the next stage', () => {
  const { filters, output } = buildOverlayFilters([
    overlay({ id: 'top', track: 2, mediaId: 'b', opacity: 0.5 }),
    overlay({ id: 'bottom', track: 1 })
  ], [], 1280, 720, id => inputs[id])
  assert.equal(filters.length, 4)
  assert.match(filters[0], /^\[1:v\]trim=start=0:end=2,setpts=PTS-STARTPTS\+1\.000\/TB,scale=512:-2,format=yuva420p\[ov0\]$/)
  assert.match(filters[1], /^\[vcat\]\[ov0\]overlay=x=640:y=72:eof_action=pass:enable='between\(t,1\.000,3\.000\)'\[vov0\]$/)
  assert.match(filters[2], /^\[2:v\].*colorchannelmixer=aa=0\.500\[ov1\]$/, 'partial opacity adds the alpha mixer')
  assert.match(filters[3], /^\[vov0\]\[ov1\]overlay=.*\[vov1\]$/, 'the higher track composites on top of the lower result')
  assert.equal(output, 'vov1')
})

test('hidden tracks are skipped and bad clips are rejected', () => {
  const hidden = buildOverlayFilters([overlay({ track: 1 }), overlay({ id: 'x', track: 2, mediaId: 'b' })], [1], 1280, 720, id => inputs[id])
  assert.equal(hidden.filters.length, 2)
  assert.match(hidden.filters[0], /^\[2:v\]/)
  assert.deepEqual(buildOverlayFilters([], [], 1280, 720, id => inputs[id]), { filters: [], output: 'vcat' })
  assert.throws(() => buildOverlayFilters([overlay({ endSeconds: 11 })], [], 1280, 720, id => inputs[id]), /invalid range/)
  assert.throws(() => buildOverlayFilters([overlay({ scale: 0 })], [], 1280, 720, id => inputs[id]), /invalid size/)
  assert.throws(() => buildOverlayFilters([overlay({ opacity: 1.5 })], [], 1280, 720, id => inputs[id]), /invalid size or opacity/)
})

test('links are validated before anything is spawned', () => {
  assert.equal(normalizeLink('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  '), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  assert.equal(normalizeLink('https://x.com/user/status/123 some trailing text'), 'https://x.com/user/status/123')
  assert.equal(normalizeLink('file:///C:/Windows/system32'), null)
  assert.equal(normalizeLink('javascript:alert(1)'), null)
  assert.equal(normalizeLink('ftp://example.com/video.mp4'), null)
  assert.equal(normalizeLink('https://user:pw@example.com/'), null)
  assert.equal(normalizeLink('not a link'), null)
  assert.equal(normalizeLink(''), null)
  const args = ytDlpArgs('https://example.com/v', 'C:/dl/%(title)s.%(ext)s', 'C:/ffmpeg')
  assert.equal(args[args.length - 1], 'https://example.com/v')
  assert.equal(args[args.length - 2], '--', 'the URL can never be read as an option')
  assert.ok(args.includes('--no-playlist') && args.includes('--ffmpeg-location'))
  assert.ok(!ytDlpArgs('https://example.com/v', 'x', null).includes('--ffmpeg-location'))
})

test('yt-dlp output is parsed into progress and readable errors', () => {
  assert.equal(parseProgressLine('[download]  45.2% of   12.34MiB at    1.20MiB/s ETA 00:05'), 45.2)
  assert.equal(parseProgressLine('[download] 100% of 12.34MiB in 00:10'), 100)
  assert.equal(parseProgressLine('[youtube] abc: Downloading webpage'), null)
  assert.equal(friendlyDownloadError('ERROR: [youtube] abc: Private video. Sign in if you have been granted access'), 'That video is private.')
  assert.equal(friendlyDownloadError('ERROR: Unsupported URL: https://example.com'), 'That site is not supported.')
  assert.equal(friendlyDownloadError('ERROR: unable to download webpage: getaddrinfo failed'), 'Could not reach that site. Check your connection.')
  assert.equal(friendlyDownloadError('ERROR: something odd happened'), 'something odd happened')
  assert.equal(ytDlpAssetName('win32'), 'yt-dlp.exe')
  assert.equal(ytDlpAssetName('darwin'), 'yt-dlp_macos')
  assert.equal(ytDlpAssetName('linux'), 'yt-dlp_linux')
})

test('a stacked clip is composited over the sequence in a real export', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const ffmpeg = (await import('ffmpeg-static')).default
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil overlay '))
  try {
    const base = path.join(work, 'red base.mp4')
    const pip = path.join(work, 'blue pip.mp4')
    for (const [file, colour] of [[base, 'red'], [pip, 'blue']]) {
      const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=64x64:r=10:d=2`, '-c:v', 'libx264', file], { encoding: 'utf8' })
      assert.equal(made.status, 0, made.stderr)
    }
    const { runFFmpeg } = await import('../main/ffmpeg.ts')
    const meta = (filePath) => ({ filePath, fileName: path.basename(filePath), durationSeconds: 2, width: 64, height: 64, format: 'mp4', videoCodec: 'h264', audioCodec: 'none', videoBitrate: 0, audioBitrate: 0, totalBitrate: 0, fileSizeBytes: fs.statSync(filePath).size, fps: 10 })
    const outputPath = path.join(work, 'stacked.mp4')
    await runFFmpeg({
      mode: 'video', inputPath: base, outputDir: work, outputFileName: 'stacked', outputPath, hasAudio: false,
      media: [{ id: 'base', kind: 'video', metadata: meta(base) }, { id: 'pip', kind: 'video', metadata: meta(pip) }],
      clips: [{ id: 'c', mediaId: 'base', startSeconds: 0, endSeconds: 2 }],
      overlays: [{ id: 'o', mediaId: 'pip', startSeconds: 0, endSeconds: 1, timelineStart: 1, track: 1, x: 0, y: 0, scale: 0.5, opacity: 1 }],
      trim: { enabled: false, startSeconds: 0, endSeconds: 2 }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
      compressionLevel: 'none', muteAudio: true
    }, fs.statSync(base).size, 2, 64, 64, ffmpeg, () => {})
    const pixel = (time, x, y) => {
      const frame = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: null }).stdout
      const offset = (y * 64 + x) * 3
      return [frame[offset], frame[offset + 1], frame[offset + 2]]
    }
    assert.ok(pixel(0.5, 8, 8)[0] > pixel(0.5, 8, 8)[2], 'before the overlay starts the top-left is red')
    assert.ok(pixel(1.5, 8, 8)[2] > pixel(1.5, 8, 8)[0], 'the half-size overlay covers the top-left corner')
    assert.ok(pixel(1.5, 56, 56)[0] > pixel(1.5, 56, 56)[2], 'the bottom-right stays red beneath the PiP')
    const probe = spawnSync(ffmpeg, ['-i', outputPath], { encoding: 'utf8' }).stderr
    assert.match(probe, /64x64/, 'output keeps the primary dimensions')
    assert.match(probe, /Duration: 00:00:02/, 'overlays do not change the duration')
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
