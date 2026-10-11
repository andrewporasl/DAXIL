import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildTimelineGraph } from '../main/ffmpegGraph.ts'
import { exportPlan, timelineSpan } from '../shared/exportPlan.ts'
import { friendlyDownloadError, nextClipName, normalizeLink, parseProgressLine, ytDlpArgs, ytDlpAssetName } from '../main/downloaderCore.ts'

const clip = (over = {}) => ({ id: 'c', mediaId: 'a', kind: 'video', track: 0, timelineStart: 0, startSeconds: 0, endSeconds: 2, x: 0, y: 0, scale: 1, opacity: 1, volume: 1, muted: false, ...over })
const inputs = { a: { index: 0, durationSeconds: 10 }, b: { index: 1, durationSeconds: 5 }, s: { index: 2, durationSeconds: 30 } }
const media = [
  { id: 'a', kind: 'video', metadata: { audioCodec: 'aac', durationSeconds: 10, fileSizeBytes: 1000 } },
  { id: 'b', kind: 'video', metadata: { audioCodec: 'none', durationSeconds: 5, fileSizeBytes: 500 } },
  { id: 's', kind: 'audio', metadata: { audioCodec: 'mp3', durationSeconds: 30, fileSizeBytes: 100 } }
]
const base = { mode: 'video', inputPath: 'a.mp4', outputDir: '', outputFileName: 'o', media, trim: { enabled: false, startSeconds: 0, endSeconds: 0 }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, compressionLevel: 'none', muteAudio: false }

test('the graph composites tracks over black in order and mixes every sounding clip', () => {
  const clips = [
    clip({ id: 'v1', timelineStart: 0 }),
    clip({ id: 'gap-after', timelineStart: 3, endSeconds: 1 }),
    clip({ id: 'pip', mediaId: 'b', track: 1, timelineStart: 1, scale: 0.4, x: 0.5, y: 0.1, opacity: 0.5 }),
    clip({ id: 'music', mediaId: 's', kind: 'audio', timelineStart: 0.5, endSeconds: 3, volume: 0.5 })
  ]
  const { filters, video, audio, duration } = buildTimelineGraph({ ...base, clips }, id => inputs[id], 1280, 720, 30, 'aac', true, true)
  assert.equal(duration, 4, 'duration reaches the last video frame, including the gap')
  assert.match(filters[0], /^color=c=black:s=1280x720:r=30:d=4\.000,format=yuv420p\[vbase\]$/)
  assert.match(filters[1], /^\[0:v\]trim=start=0:end=2,setpts=PTS-STARTPTS\+0\.000\/TB,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720.*\[c0\]$/, 'full-frame clips letterbox')
  assert.match(filters[2], /^\[vbase\]\[c0\]overlay=x=0:y=0:eof_action=pass:enable='between\(t,0\.000,2\.000\)'\[v0\]$/)
  assert.match(filters[3], /trim=start=0:end=1,setpts=PTS-STARTPTS\+3\.000\/TB/, 'same-track clips keep time order')
  assert.match(filters[5], /^\[1:v\].*scale=512:-2,setsar=1,format=yuva420p,colorchannelmixer=aa=0\.500\[c2\]$/, 'V2 comes after both V1 clips')
  assert.match(filters[6], /^\[v1\]\[c2\]overlay=x=640:y=72/)
  assert.equal(video, 'v2')
  assert.match(filters[7], /^anullsrc=r=48000:cl=stereo,atrim=duration=4\.000\[asilence\]$/)
  const audioLines = filters.filter(line => /adelay=/.test(line))
  assert.equal(audioLines.length, 3, 'two V1 clips with sound plus the music; the silent PiP source adds nothing')
  assert.match(audioLines[2], /^\[2:a\].*volume=0\.5,adelay=500:all=1\[a2\]$/)
  assert.match(filters[filters.length - 1], /amix=inputs=4:duration=first.*atrim=duration=4\.000\[acat\]$/)
  assert.equal(audio, 'acat')
})

test('hidden and muted tracks, mutes and modes are honoured', () => {
  const clips = [clip({ id: 'v1' }), clip({ id: 'top', mediaId: 'b', track: 1, timelineStart: 1, endSeconds: 4 }), clip({ id: 'music', mediaId: 's', kind: 'audio', track: 1, endSeconds: 1 })]
  const hidden = buildTimelineGraph({ ...base, clips, hiddenVideoTracks: [1] }, id => inputs[id], 640, 360, 30, 'aac', true, true)
  assert.equal(hidden.duration, 2, 'a hidden track does not extend the export')
  assert.equal(hidden.filters.filter(line => /overlay=/.test(line)).length, 1)
  const mutedTrack = buildTimelineGraph({ ...base, clips, mutedAudioTracks: [1] }, id => inputs[id], 640, 360, 30, 'aac', true, true)
  assert.equal(mutedTrack.filters.filter(line => /adelay=/.test(line)).length, 1, 'muted audio track is skipped, V1 sound stays')
  const mutedClip = buildTimelineGraph({ ...base, clips: [clip({ muted: true })] }, id => inputs[id], 640, 360, 30, 'aac', true, true)
  assert.equal(mutedClip.filters.filter(line => /adelay=/.test(line)).length, 0)
  const audioOnly = buildTimelineGraph({ ...base, clips, mode: 'audio' }, id => inputs[id], 640, 360, 30, 'aac', false, true)
  assert.ok(!audioOnly.filters.some(line => /overlay=|color=/.test(line)))
  assert.equal(audioOnly.audio, 'acat')
  assert.throws(() => buildTimelineGraph({ ...base, clips: [clip({ endSeconds: 11 })] }, id => inputs[id], 640, 360, 30, 'aac', true, true), /invalid source range/)
  assert.throws(() => buildTimelineGraph({ ...base, clips: [clip({ scale: 1.5 })] }, id => inputs[id], 640, 360, 30, 'aac', true, true), /invalid size/)
  assert.throws(() => buildTimelineGraph({ ...base, clips: [] }, id => inputs[id], 640, 360, 30, 'aac', true, true), /at least one clip/)
})

test('size plan follows the timeline span and sounding clips', () => {
  const primary = { fileSizeBytes: 1000, durationSeconds: 10, audioCodec: 'aac' }
  const clips = [clip({ id: 'v', timelineStart: 1, endSeconds: 4 }), clip({ id: 'm', mediaId: 's', kind: 'audio', timelineStart: 0, endSeconds: 2 })]
  assert.equal(timelineSpan(clips), 5)
  const plan = exportPlan({ ...base, clips, compressionLevel: '50' }, primary)
  assert.equal(plan.duration, 5)
  assert.equal(plan.audio, true)
  assert.equal(plan.videoKbps, 200, 'tiny sources hit the bitrate floor')
  assert.equal(exportPlan({ ...base, clips: [clip({ mediaId: 'b' })], compressionLevel: '50' }, primary).audio, false, 'a silent source has no audio track')
  assert.equal(exportPlan({ ...base, clips, playbackRate: 2 }, primary).duration, 2.5)
  assert.equal(exportPlan({ ...base, clips, mode: 'gif' }, primary).targetBytes, null)
})

test('links are validated before anything is spawned', () => {
  assert.equal(normalizeLink('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  '), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  assert.equal(normalizeLink('https://x.com/user/status/123 some trailing text'), 'https://x.com/user/status/123')
  assert.equal(normalizeLink('file:///C:/Windows/system32'), null)
  assert.equal(normalizeLink('javascript:alert(1)'), null)
  assert.equal(normalizeLink('https://user:pw@example.com/'), null)
  assert.equal(normalizeLink('not a link'), null)
  const args = ytDlpArgs('https://example.com/v', 'C:/dl/%(title)s.%(ext)s', 'C:/ffmpeg')
  assert.equal(args[args.length - 1], 'https://example.com/v')
  assert.equal(args[args.length - 2], '--', 'the URL can never be read as an option')
  assert.equal(parseProgressLine('[download]  45.2% of   12.34MiB at    1.20MiB/s ETA 00:05'), 45.2)
  assert.equal(parseProgressLine('[youtube] abc: Downloading webpage'), null)
  assert.equal(friendlyDownloadError('ERROR: [youtube] abc: Private video. Sign in if you have been granted access'), 'That video is private.')
  assert.equal(friendlyDownloadError('ERROR: Unsupported URL: https://example.com'), 'That site is not supported.')
  assert.equal(nextClipName([]), 'clip1')
  assert.equal(nextClipName(['clip1.mp4', 'clip3.mp4', 'clip2.part', 'notes.txt', 'clipart.mp4']), 'clip4', 'downloads get the next generic number, never a title')
  assert.equal(ytDlpAssetName('win32'), 'yt-dlp.exe')
  assert.equal(ytDlpAssetName('darwin'), 'yt-dlp_macos')
})

test('real export: gaps are black, V2 composites over V1, V1 audio keeps its place', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const ffprobe = (await import('ffprobe-static')).default.path
  const { runFFmpeg } = await import('../main/ffmpeg.ts')
  const { readMetadata } = await import('../main/ffprobe.ts')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil timeline '))
  const run = args => { const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.toString()); return result.stdout }
  try {
    const red = path.join(work, 'red with tone.mp4'), blue = path.join(work, 'blue pip.mp4')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', red])
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=2', '-c:v', 'libx264', blue])
    const realMedia = [{ id: 'red', kind: 'video', metadata: await readMetadata(red, ffprobe) }, { id: 'blue', kind: 'video', metadata: await readMetadata(blue, ffprobe) }]
    const outputPath = path.join(work, 'timeline out.mp4')
    const options = {
      ...base, inputPath: red, outputDir: work, outputPath, media: realMedia, hasAudio: true, project: { width: 64, height: 64, fps: 10 },
      clips: [
        clip({ id: 'r', mediaId: 'red', timelineStart: 1, endSeconds: 1 }),                         // 1–2 s, gap before it
        clip({ id: 'b', mediaId: 'blue', track: 1, timelineStart: 1.5, endSeconds: 1, scale: 0.5, x: 0, y: 0 })   // PiP 1.5–2.5 s
      ]
    }
    let measured
    await runFFmpeg(options, realMedia[0].metadata.fileSizeBytes, 2, 64, 64, ffmpeg, event => { if (event.type === 'complete') measured = event.outputSizeBytes })
    assert.equal(measured, fs.statSync(outputPath).size)
    const out = await readMetadata(outputPath, ffprobe)
    assert.ok(Math.abs(out.durationSeconds - 2.5) < 0.15, `duration spans the gap and the PiP: ${out.durationSeconds}`)
    assert.equal(out.width, 64)
    assert.equal(out.audioCodec, 'aac')
    const pixel = (time, x, y) => { const frame = run(['-ss', String(time), '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const o = (y * 64 + x) * 3; return [frame[o], frame[o + 1], frame[o + 2]] }
    assert.ok(pixel(0.5, 32, 32).every(channel => channel < 40), 'the gap before the first clip is black')
    assert.ok(pixel(1.2, 50, 50)[0] > 150, 'V1 red shows once it starts')
    assert.ok(pixel(1.8, 8, 8)[2] > 150 && pixel(1.8, 8, 8)[0] < 80, 'the V2 PiP covers the top-left')
    assert.ok(pixel(1.8, 56, 56)[0] > 150, 'V1 red remains beneath the PiP')
    assert.ok(pixel(2.3, 8, 8)[2] > 150, 'the PiP continues after V1 ends')
    const rms = at => { const pcm = run(['-ss', String(at), '-i', outputPath, '-t', '0.2', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']); let sum = 0; for (let i = 0; i < pcm.length; i += 2) sum += pcm.readInt16LE(i) ** 2; return Math.sqrt(sum / Math.max(1, pcm.length / 2)) }
    assert.ok(rms(0.3) < 10, 'silent during the gap')
    assert.ok(rms(1.4) > 100, 'the V1 clip brings its own sound at its timeline position')
    assert.ok(rms(2.2) < 10, 'silent once the sounding clip ends')
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
})
