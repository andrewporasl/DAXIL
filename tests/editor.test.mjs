import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { splitClip, moveClip, timelineDuration, clipAtTime, trimClipEdge, updateClipRange, remapPlayhead } from '../renderer/src/lib/clips.ts'
import { extensionForMode, validateOutputPath } from '../main/output.ts'
import { packagedBinaryPath, validateBinary } from '../main/binaryValidation.ts'

test('split produces independent adjacent clips and rejects edges', () => {
  const original = [{ id: 'a', startSeconds: 0, endSeconds: 4 }]
  const result = splitClip(original, 2, 'b')
  assert.deepEqual(result, [
    { id: 'a', startSeconds: 0, endSeconds: 2 },
    { id: 'b', startSeconds: 2, endSeconds: 4 }
  ])
  assert.notStrictEqual(result[0], original[0])
  assert.equal(splitClip(original, 0, 'b'), null)
  assert.equal(splitClip(original, 4, 'b'), null)
})

test('project time follows reordered and removed source sections', () => {
  const original = splitClip([{ id: 'a', startSeconds: 0, endSeconds: 4 }], 2, 'b')
  const reordered = moveClip(original, 1, 0)
  assert.deepEqual(reordered.map(clip => clip.id), ['b', 'a'])
  assert.equal(clipAtTime(reordered, 0.5).sourceTime, 2.5)
  assert.equal(clipAtTime(reordered, 2.5).sourceTime, 0.5)
  assert.equal(timelineDuration(reordered.slice(0, 1)), 2)
})

test('trimming clamps to source limits and keeps a nonempty frame-snapped range', () => {
  const clip = { id: 'a', startSeconds: 2, endSeconds: 6 }
  assert.equal(trimClipEdge(clip, 'start', -5, 8).startSeconds, 0)
  assert.equal(trimClipEdge(clip, 'end', 99, 8).endSeconds, 8)
  assert.ok(trimClipEdge(clip, 'start', 9, 8).startSeconds <= 5.9)
  assert.ok(trimClipEdge(clip, 'end', -9, 8).endSeconds >= 2.1)
  assert.equal(trimClipEdge(clip, 'start', 2.123, 8, 25).startSeconds, 2.12)
  assert.strictEqual(trimClipEdge(clip, 'end', NaN, 8), clip)
})

test('trim, split, reorder, and extend preserve independent source ranges', () => {
  const original = [{ id: 'a', startSeconds: 0, endSeconds: 8 }]
  const trimmed = updateClipRange(original, 'a', 1, 7, 8)
  const sections = splitClip(trimmed, 3, 'b')
  assert.deepEqual(sections.map(clip => [clip.startSeconds, clip.endSeconds]), [[1, 4], [4, 7]])
  const reordered = moveClip(sections, 1, 0)
  const edited = updateClipRange(reordered, 'b', 4.5, 6, 8)
  assert.deepEqual(edited.map(clip => [clip.startSeconds, clip.endSeconds]), [[4.5, 6], [1, 4]])
  assert.deepEqual(reordered.map(clip => [clip.startSeconds, clip.endSeconds]), [[4, 7], [1, 4]], 'undo snapshot stays intact')
  const extended = updateClipRange(edited, 'b', 4, 7, 8)
  assert.deepEqual(extended, reordered)
  assert.strictEqual(updateClipRange(extended, 'b', 4, 7, 8), extended, 'a click without a drag creates no edit')
  assert.strictEqual(updateClipRange(extended, 'b', 7, 4, 8), extended)
})

test('trim keeps the playhead on the same source frame, or the nearest retained edge', () => {
  const before = [{ id: 'a', startSeconds: 0, endSeconds: 4 }, { id: 'b', startSeconds: 4, endSeconds: 8 }]
  const after = updateClipRange(before, 'a', 1, 3, 8)
  assert.equal(remapPlayhead(before, after, 2), 1)
  assert.equal(remapPlayhead(before, after, 0.5), 0)
  assert.equal(remapPlayhead(before, after, 3.5), 2)
  assert.equal(remapPlayhead(before, after, 6), 4)
})

test('filename extension and invalid names', () => {
  assert.equal(extensionForMode('audio'), '.mp3')
  assert.equal(extensionForMode('gif'), '.gif')
  assert.equal(extensionForMode('video'), '.mp4')
  assert.match(validateOutputPath('sample export.mp4', 'video'), /sample export\.mp4$/)
  assert.throws(() => validateOutputPath('bad?.mp4', 'video'))
  assert.throws(() => validateOutputPath('wrong.gif', 'video'))
})

test('packaged FFprobe path retains nested platform directories', () => {
  const source = path.join('C:', 'dev', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')
  const resolved = packagedBinaryPath(path.join('C:', 'app', 'app.asar'), source)
  assert.match(resolved, /app\.asar\.unpacked/)
  assert.match(resolved, /ffprobe-static.*bin.*win32.*x64.*ffprobe\.exe/)
})

test('missing FFmpeg reports actionable path error', async () => {
  await assert.rejects(validateBinary(path.join(process.cwd(), 'missing ffmpeg executable'), 'ffmpeg'), /Install FFmpeg.*Settings/)
})

test('bundled FFmpeg validates, including a path with spaces', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  await validateBinary(ffmpeg, 'ffmpeg')
})

test('actual video can be split and exported to paths with spaces', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil video test '))
  try {
    const input = path.join(work, 'source video.mp4')
    const generated = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=2', '-c:v', 'libx264', input], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    const clips = splitClip([{ id: 'a', startSeconds: 0, endSeconds: 2 }], 1, 'b')
    assert.ok(clips)
    const { runFFmpeg } = await import('../main/ffmpeg.ts')
    for (const [index, clip] of clips.entries()) {
      const outputPath = path.join(work, `split part ${index + 1}.mp4`)
      await runFFmpeg({
        mode: 'video', inputPath: input, outputDir: work, outputFileName: `part${index}`,
        outputPath, trim: { enabled: true, startSeconds: clip.startSeconds, endSeconds: clip.endSeconds },
        crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
        compressionLevel: 'none', muteAudio: true
      }, fs.statSync(input).size, 2, 160, 90, ffmpeg, () => {})
      assert.ok(fs.statSync(outputPath).size > 0)
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('export renders moved clips in timeline order', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil reorder '))
  try {
    const input = path.join(work, 'two colors.mp4')
    const outputPath = path.join(work, 'reordered output.mp4')
    const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', input], { encoding: 'utf8' })
    assert.equal(made.status, 0, made.stderr)
    const { runFFmpeg } = await import('../main/ffmpeg.ts')
    const editedClips = [{ id: 'blue', startSeconds: 1, endSeconds: 2 }, { id: 'red', startSeconds: 0, endSeconds: 1 }]
    const exportOptions = { mode: 'video', inputPath: input, outputDir: work, outputFileName: 'reordered', outputPath,
      clips: editedClips, hasAudio: false,
      trim: { enabled: false, startSeconds: 0, endSeconds: 2 }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
      compressionLevel: 'none', muteAudio: false }
    await runFFmpeg(exportOptions, fs.statSync(input).size, 2, 64, 64, ffmpeg, () => {})
    const pixel = time => spawnSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: null }).stdout
    const first = pixel(0.2)
    const second = pixel(1.2)
    assert.ok(first[2] > first[0], 'first section should be blue')
    assert.ok(second[0] > second[2], 'second section should be red')
    const removedPath = path.join(work, 'red removed.mp4')
    await runFFmpeg({ ...exportOptions, outputPath: removedPath, clips: editedClips.slice(0, 1) }, fs.statSync(input).size, 2, 64, 64, ffmpeg, () => {})
    const removedPixel = spawnSync(ffmpeg, ['-v', 'error', '-ss', '0.2', '-i', removedPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: null }).stdout
    assert.ok(removedPixel[2] > removedPixel[0], 'remaining section should be blue')
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('edited clip order exports audio and GIF', async () => {
  const ffmpeg = (await import('ffmpeg-static')).default
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil formats '))
  try {
    const input = path.join(work, 'source with audio.mp4')
    const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', input], { encoding: 'utf8' })
    assert.equal(made.status, 0, made.stderr)
    const { runFFmpeg } = await import('../main/ffmpeg.ts')
    const common = { inputPath: input, outputDir: work, outputFileName: 'edited',
      clips: [{ id: 'tail', startSeconds: 1, endSeconds: 2 }, { id: 'head', startSeconds: 0, endSeconds: 1 }], hasAudio: true,
      trim: { enabled: false, startSeconds: 0, endSeconds: 2 }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
      compressionLevel: 'none', muteAudio: false }
    for (const mode of ['audio', 'gif']) {
      const outputPath = path.join(work, `edited.${mode === 'audio' ? 'mp3' : 'gif'}`)
      await runFFmpeg({ ...common, mode, outputPath }, fs.statSync(input).size, 2, 64, 64, ffmpeg, () => {})
      assert.ok(fs.statSync(outputPath).size > 0)
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('zoom anchoring keeps the anchored time under the cursor', async () => {
  const { anchoredScrollLeft, clampZoom, wheelZoomFactor } = await import('../renderer/src/lib/timeline.ts')
  // A 10s span on a 1000px strip, scrolled 0, cursor at x=300 (3s). Zooming 2x doubles the strip.
  const viewportLeft = 50
  const time = 3
  const before = { scrollLeft: 0, width: 1000 }
  const cursor = viewportLeft + time / 10 * before.width
  const after = { width: 2000 }
  const scrollLeft = anchoredScrollLeft(0, viewportLeft, after.width, 10, time, cursor)
  assert.equal(scrollLeft, 300)
  // The strip moves left by the new scroll, so the anchored time sits at the same client x again.
  assert.equal(viewportLeft - scrollLeft + time / 10 * after.width, cursor)
  // Already scrolled: the correction is relative to the strip's current on-screen position.
  assert.equal(anchoredScrollLeft(300, viewportLeft - 300, 4000, 10, time, cursor), 900)
  assert.equal(anchoredScrollLeft(0, 0, 1000, 10, 0, 500), 0, 'never scrolls before the start')
  assert.equal(clampZoom(0.2, 10), 1)
  assert.equal(clampZoom(Infinity, 10), 1)
  assert.ok(clampZoom(1e9, 3600) <= 2000)
  assert.ok(wheelZoomFactor(-100) > 1 && wheelZoomFactor(100) < 1)
  assert.ok(Math.abs(wheelZoomFactor(-100) * wheelZoomFactor(100) - 1) < 1e-12, 'in and out are symmetric')
  assert.equal(wheelZoomFactor(-3, 1), wheelZoomFactor(-48), 'line deltas are normalised')
})

test('ruler picks readable steps', async () => {
  const { rulerStep, formatRulerTime } = await import('../renderer/src/lib/timeline.ts')
  assert.equal(rulerStep(100), 1)
  assert.equal(rulerStep(1000), 0.1)
  assert.equal(rulerStep(1), 120)
  assert.equal(formatRulerTime(75, 5), '1:15')
  assert.equal(formatRulerTime(1.5, 0.5), '0:01.5')
})

test('multi-asset insertion keeps order and lands as one edit', async () => {
  const { insertAssets, parseMediaIds } = await import('../renderer/src/lib/timeline.ts')
  const meta = durationSeconds => ({ durationSeconds })
  const assets = [
    { id: 'v1', kind: 'video', metadata: meta(2) },
    { id: 'a1', kind: 'audio', metadata: meta(3) },
    { id: 'v2', kind: 'video', metadata: meta(4) },
    { id: 'a2', kind: 'audio', metadata: meta(10) }
  ]
  let n = 0
  const result = insertAssets([{ id: 'x', startSeconds: 0, endSeconds: 5 }, { id: 'y', startSeconds: 0, endSeconds: 1 }], [], [], assets, 1, 1, () => `n${++n}`)
  assert.deepEqual(result.clips.map(clip => clip.mediaId ?? clip.id), ['x', 'v1', 'v2', 'y'])
  assert.deepEqual(result.audio.map(clip => [clip.mediaId, clip.timelineStart, clip.endSeconds]), [['a1', 1, 3], ['a2', 4, 8]], 'audio runs back to back and stops at the timeline end')
  assert.equal(result.videoIds.length, 2)
  assert.equal(result.audioIds.length, 2)
  const none = insertAssets([], [], [], [], 0, 0, () => 'z')
  // Dropping onto a stacked track leaves V1 alone and lays the videos back to back on that track.
  const stacked = insertAssets([{ id: 'x', startSeconds: 0, endSeconds: 5 }], [], [], assets, 0, 1, () => `s${++n}`, { track: 2 })
  assert.equal(stacked.clips.length, 1)
  assert.deepEqual(stacked.overlays.map(clip => [clip.mediaId, clip.track, clip.timelineStart, clip.endSeconds]), [['v1', 2, 1, 2], ['v2', 2, 3, 2]], 'the second video is clamped to the timeline end')
  assert.equal(stacked.overlays[0].scale, 0.4)
  assert.equal(stacked.overlayIds.length, 2)
  assert.equal(none.videoIds.length + none.audioIds.length, 0)
  assert.deepEqual(parseMediaIds('abc'), ['abc'])
  assert.deepEqual(parseMediaIds('["a","b"]'), ['a', 'b'])
  assert.deepEqual(parseMediaIds(''), [])
})
