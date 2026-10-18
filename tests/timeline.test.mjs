import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildTimelineGraph } from '../main/ffmpegGraph.ts'
import { exportPlan, sliceTimeline, soundOnly, timelineSpan } from '../shared/exportPlan.ts'
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

test('sliceTimeline keeps only the preview window and shifts it to zero', () => {
  const clips = [
    clip({ id: 'before', endSeconds: 2 }),
    clip({ id: 'across', timelineStart: 2, startSeconds: 1, endSeconds: 9 }),
    clip({ id: 'pip', track: 1, timelineStart: 5, startSeconds: 0, endSeconds: 10 }),
    clip({ id: 'after', timelineStart: 20 })
  ]
  const sliced = sliceTimeline(clips, 4, 5)
  assert.deepEqual(sliced.map(c => [c.id, c.timelineStart, c.startSeconds, c.endSeconds]), [['across', 0, 3, 8], ['pip', 1, 0, 4]])
  assert.equal(timelineSpan(sliced), 5)
})

test('real preview: a sliced window renders at the canvas size with only that window', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const ffprobe = (await import('ffprobe-static')).default.path
  const { runFFmpeg } = await import('../main/ffmpeg.ts')
  const { readMetadata } = await import('../main/ffprobe.ts')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil preview '))
  const run = args => { const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.toString()); return result.stdout }
  try {
    const red = path.join(work, 'red.mp4'), blue = path.join(work, 'blue.mp4')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=64x36:r=10:d=2', '-c:v', 'libx264', red])
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x36:r=10:d=2', '-c:v', 'libx264', blue])
    const media = [{ id: 'red', kind: 'video', metadata: await readMetadata(red, ffprobe) }, { id: 'blue', kind: 'video', metadata: await readMetadata(blue, ffprobe) }]
    const full = [clip({ id: 'r', mediaId: 'red', endSeconds: 2 }), clip({ id: 'b', mediaId: 'blue', timelineStart: 2, endSeconds: 2 })]
    const outputPath = path.join(work, 'preview.mp4')
    // Portrait canvas, previewing 1.5–2.5 s: half a second of red, then half a second of blue.
    const options = { ...base, inputPath: red, outputDir: work, outputPath, media, hasAudio: false, project: { width: 36, height: 64, fps: 10 }, clips: sliceTimeline(full, 1.5, 1) }
    await runFFmpeg(options, media[0].metadata.fileSizeBytes, 2, 64, 36, ffmpeg, () => {})
    const out = await readMetadata(outputPath, ffprobe)
    assert.equal(out.width, 36)
    assert.equal(out.height, 64)
    assert.ok(Math.abs(out.durationSeconds - 1) < 0.15, `only the window is rendered: ${out.durationSeconds}`)
    const pixel = time => { const frame = run(['-ss', String(time), '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const o = (32 * 36 + 18) * 3; return [frame[o], frame[o + 1], frame[o + 2]] }
    assert.ok(pixel(0.2)[0] > 150, 'starts on the red clip')
    assert.ok(pixel(0.8)[2] > 150, 'ends on the blue clip')
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
})

test('temporary downloads: only files a window downloaded are deleted, and closing it clears the rest', async () => {
  const { discardAllFor, discardDownloads, downloadDirFor, trackDownload } = await import('../main/tempDownloads.ts')
  const outsider = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'daxil user ')), 'my video.mp4')
  fs.writeFileSync(outsider, 'not a download')
  try {
    const dir = downloadDirFor(901)
    const a = path.join(dir, 'clip1.mp4'), b = path.join(dir, 'clip2.mp4')
    fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b')
    trackDownload(901, a); trackDownload(901, b)
    assert.equal(discardDownloads(901, [outsider]), 0, 'a file the app did not download is refused')
    assert.equal(discardDownloads(902, [a]), 0, 'another window cannot delete it')
    assert.ok(fs.existsSync(outsider) && fs.existsSync(a))
    assert.equal(discardDownloads(901, [a]), 1)
    assert.ok(!fs.existsSync(a) && fs.existsSync(b))
    discardAllFor(901)
    assert.ok(!fs.existsSync(b) && !fs.existsSync(dir), 'closing the window removes what is left')
    assert.ok(fs.existsSync(outsider), 'user files are never touched')
  } finally { fs.rmSync(path.dirname(outsider), { recursive: true, force: true }) }
})

test('text clips overlay above every video track and never add sound', () => {
  const text = clip({ id: 'title', mediaId: '', kind: 'text', track: 0, timelineStart: 1, endSeconds: 2, x: 0.5, y: 0.8, text: { content: 'Hi' } })
  const clips = [clip({ id: 'v1' }), clip({ id: 'pip', mediaId: 'b', track: 1, scale: 0.4 }), text]
  const used = []
  const { filters, video, duration } = buildTimelineGraph({ ...base, clips }, id => inputs[id], 1280, 720, 30, 'aac', true, true, (c, length) => { used.push([c.id, length]); return 7 })
  assert.deepEqual(used, [['title', 2]])
  assert.equal(duration, 3)
  const textLine = filters.findIndex(line => line.startsWith('[7:v]'))
  assert.match(filters[textLine], /^\[7:v\]scale=1280:720,format=rgba,setpts=PTS-STARTPTS\+1\.000\/TB\[t0\]$/)
  assert.match(filters[textLine + 1], /^\[v1\]\[t0\]overlay=x=0:y=0:eof_action=pass:enable='between\(t,1\.000,3\.000\)'\[vt0\]$/, 'drawn after both video tracks')
  assert.equal(video, 'vt0')
  assert.equal(filters.filter(line => /adelay=/.test(line)).length, 1, 'only the V1 clip has sound')
  assert.throws(() => buildTimelineGraph({ ...base, clips }, id => inputs[id], 1280, 720, 30, 'aac', true, false), /Text could not be prepared/)
  const audioOnly = buildTimelineGraph({ ...base, clips: [clip({ id: 'm', mediaId: 's', kind: 'audio' }), text] }, id => inputs[id], 1280, 720, 30, 'aac', false, true)
  assert.equal(audioOnly.audio, 'acat', 'sound exports never need the text images')
})

test('a timeline with only sound is sound-only', () => {
  assert.equal(soundOnly([]), false)
  assert.equal(soundOnly([clip({ kind: 'audio', mediaId: 's' })]), true)
  assert.equal(soundOnly([clip({ kind: 'audio', mediaId: 's' }), clip({ kind: 'text', mediaId: '' })]), false)
  assert.equal(soundOnly([clip({ kind: 'audio', mediaId: 's' }), clip()]), false)
})

test('clip exports overlay text images as looped inputs', async () => {
  const { buildClipFFmpegArgs } = await import('../main/ffmpeg.ts')
  const text = clip({ id: 'title', mediaId: '', kind: 'text', timelineStart: 0.5, endSeconds: 1.5 })
  const args = buildClipFFmpegArgs({ ...base, media: [{ ...media[0], metadata: { ...media[0].metadata, filePath: 'a.mp4' } }], hasAudio: true, outputPath: 'out.mp4', clips: [clip(), text], textImages: { title: 'title.png' } }, 1000, 10, 1280, 720)
  const at = args.indexOf('title.png')
  assert.deepEqual(args.slice(at - 7, at + 1), ['-loop', '1', '-framerate', '30', '-t', '1.500', '-i', 'title.png'])
  assert.match(args[args.indexOf('-filter_complex') + 1], /\[1:v\]scale=1280:720,format=rgba/)
  assert.throws(() => buildClipFFmpegArgs({ ...base, hasAudio: true, outputPath: 'out.mp4', clips: [clip(), text] }, 1000, 10, 1280, 720), /Text could not be prepared/)
})

test('real export: a text image shows only during its clip, and a sound-only timeline makes an MP3', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const ffprobe = (await import('ffprobe-static')).default.path
  const { runFFmpeg } = await import('../main/ffmpeg.ts')
  const { readMetadata } = await import('../main/ffprobe.ts')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil text '))
  const run = args => { const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.toString()); return result.stdout }
  try {
    const red = path.join(work, 'red.mp4'), png = path.join(work, 'title.png'), tone = path.join(work, 'tone.wav')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=64x36:r=10:d=3', '-c:v', 'libx264', red])
    run(['-f', 'lavfi', '-i', 'color=c=green:s=64x36', '-frames:v', '1', png])
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone])
    const media = [{ id: 'red', kind: 'video', metadata: await readMetadata(red, ffprobe) }]
    const clips = [clip({ id: 'r', mediaId: 'red', endSeconds: 3 }), clip({ id: 'title', mediaId: '', kind: 'text', timelineStart: 1, endSeconds: 1 })]
    const outputPath = path.join(work, 'text.mp4')
    const textImages = { title: 'data:image/png;base64,' + fs.readFileSync(png).toString('base64') }
    await runFFmpeg({ ...base, inputPath: red, outputDir: work, outputPath, media, hasAudio: false, project: { width: 64, height: 36, fps: 10 }, clips, textImages }, 1000, 3, 64, 36, ffmpeg, () => {})
    const pixel = time => { const frame = run(['-ss', String(time), '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const o = (18 * 64 + 32) * 3; return [frame[o], frame[o + 1], frame[o + 2]] }
    assert.ok(pixel(0.5)[0] > 150, 'red before the text')
    assert.ok(pixel(1.5)[1] > 100 && pixel(1.5)[0] < 80, 'text image on top during its clip')
    assert.ok(pixel(2.5)[0] > 150, 'red again after it')
    assert.equal(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('daxil-text-')).filter(name => fs.existsSync(path.join(os.tmpdir(), name, 'text0.png'))).length, 0, 'temp text images are cleaned up')

    const audioMedia = [{ id: 'tone', kind: 'audio', metadata: await readMetadata(tone, ffprobe) }]
    const mp3 = path.join(work, 'tone.mp3')
    await runFFmpeg({ ...base, mode: 'audio', inputPath: tone, outputDir: work, outputPath: mp3, media: audioMedia, hasAudio: true, project: { width: 1920, height: 1080, fps: 30 }, clips: [clip({ id: 'a', mediaId: 'tone', kind: 'audio', endSeconds: 2 })] }, 1000, 2, 0, 0, ffmpeg, () => {})
    const out = await readMetadata(mp3, ffprobe)
    assert.equal(out.width, 0)
    assert.equal(out.audioCodec, 'mp3')
    assert.ok(Math.abs(out.durationSeconds - 2) < 0.2)
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
})

test('clip speed stretches video timestamps and chains atempo for sound', async () => {
  const { atempoChain } = await import('../main/ffmpegGraph.ts')
  assert.equal(atempoChain(2), 'atempo=2')
  assert.equal(atempoChain(4), 'atempo=2,atempo=2')
  assert.equal(atempoChain(0.25), 'atempo=0.5,atempo=0.5')
  assert.equal(atempoChain(1.5), 'atempo=1.5')
  const clips = [clip({ id: 'v', endSeconds: 4, speed: 2 }), clip({ id: 'n', timelineStart: 2, startSeconds: 4, endSeconds: 6 })]
  const { filters, duration } = buildTimelineGraph({ ...base, clips }, id => inputs[id], 1280, 720, 30, 'aac', true, true)
  assert.equal(duration, 4, '2 s of fast clip then 2 s at normal speed')
  assert.match(filters[1], /trim=start=0:end=4,setpts=\(PTS-STARTPTS\)\/2\+0\.000\/TB,fps=30/)
  assert.match(filters[2], /between\(t,0\.000,2\.000\)/)
  assert.match(filters[3], /setpts=PTS-STARTPTS\+2\.000\/TB/, 'the normal-speed piece is untouched')
  const sound = filters.filter(line => /adelay=/.test(line))
  assert.match(sound[0], /asetpts=PTS-STARTPTS,atempo=2,aresample/)
  assert.doesNotMatch(sound[1], /atempo/)
  const sliced = sliceTimeline(clips, 1, 2)
  assert.deepEqual(sliced.map(c => [c.timelineStart, c.startSeconds, c.endSeconds]), [[0, 2, 4], [1, 4, 5]], 'slices convert timeline time to source time per clip')
  assert.throws(() => buildTimelineGraph({ ...base, clips: [clip({ speed: 40 })] }, id => inputs[id], 1280, 720, 30, 'aac', true, true), /invalid speed/)
})

test('real export: a 2x piece under a 2x project plays at 4x, the rest at 2x', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const ffprobe = (await import('ffprobe-static')).default.path
  const { runFFmpeg } = await import('../main/ffmpeg.ts')
  const { readMetadata } = await import('../main/ffprobe.ts')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil speed '))
  const run = args => { const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.toString()); return result.stdout }
  try {
    const source = path.join(work, 'src.mp4')
    run(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=8', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source])
    const media = [{ id: 's', kind: 'video', metadata: await readMetadata(source, ffprobe) }]
    // Split at 4 s of source: first piece at 2x (2 s on the timeline), second at normal speed (4 s).
    const clips = [clip({ id: 'a', mediaId: 's', endSeconds: 4, speed: 2 }), clip({ id: 'b', mediaId: 's', timelineStart: 2, startSeconds: 4, endSeconds: 8 })]
    const outputPath = path.join(work, 'out.mp4')
    await runFFmpeg({ ...base, inputPath: source, outputDir: work, outputPath, media, hasAudio: true, playbackRate: 2, project: { width: 64, height: 36, fps: 30 }, clips }, 1000, 8, 64, 36, ffmpeg, () => {})
    const out = await readMetadata(outputPath, ffprobe)
    assert.ok(Math.abs(out.durationSeconds - 3) < 0.2, `(2 s + 4 s) at the project's 2x is 3 s: ${out.durationSeconds}`)
    assert.notEqual(out.audioCodec, 'none', 'sound survives the tempo change')
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
})

test('converted links never overwrite: name.mp4, then name (2).mp4', async () => {
  const { uniqueOutputPath, validateOutputPath } = await import('../main/output.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil convert '))
  try {
    const first = uniqueOutputPath(dir, 'My: clip?', 'audio')
    assert.equal(path.basename(first), 'My clip.mp3', 'unsafe characters are dropped')
    fs.writeFileSync(first, '')
    assert.equal(path.basename(uniqueOutputPath(dir, 'My: clip?', 'audio')), 'My clip (2).mp3')
    assert.equal(path.basename(uniqueOutputPath(dir, '...', 'gif')), 'clip.gif', 'an empty name falls back')
    assert.equal(path.dirname(uniqueOutputPath(dir, '..\\..\\evil', 'video')), dir, 'backslashes cannot leave the folder')
    assert.equal(path.dirname(uniqueOutputPath(dir, '../../evil', 'video')), dir, 'slashes cannot leave the folder')
    assert.equal(validateOutputPath(uniqueOutputPath(dir, 'x', 'video'), 'video'), path.join(dir, 'x.mp4'))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
