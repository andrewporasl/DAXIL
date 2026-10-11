import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { moveClips, selectClips, dropBoundary, splitClip } from '../renderer/src/lib/clips.ts'
import { exportPlan } from '../shared/exportPlan.ts'
import { buildClipFFmpegArgs, runFFmpeg } from '../main/ffmpeg.ts'
import { readMetadata } from '../main/ffprobe.ts'
import ffmpeg from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const clips = ['a', 'b', 'c', 'd'].map(id => ({ id, mediaId: 'source', startSeconds: 0, endSeconds: 2 }))
const metadata = { fileSizeBytes: 1000000, durationSeconds: 4, audioCodec: 'aac' }
const common = { mode: 'video', inputPath: 'source.mp4', outputDir: '', outputFileName: 'out', clips: [{ id: 'a', startSeconds: 1, endSeconds: 3 }], trim: { enabled: false, startSeconds: 0, endSeconds: 4 }, compressionLevel: '50', muteAudio: false, hasAudio: true }

test('group selection and broad drop boundaries preserve order and source identity', () => {
  assert.deepEqual(selectClips(clips, ['a'], 'c', 'range', 'a'), ['a', 'b', 'c'])
  assert.deepEqual(selectClips(clips, ['a', 'b'], 'a', 'toggle', 'a'), ['b'])
  assert.deepEqual(selectClips(clips, ['a', 'b'], 'b', 'preserve', 'a'), ['a', 'b'])
  assert.equal(dropBoundary(clips, 7.1), 4)
  assert.equal(dropBoundary(clips, 90), 4)
  assert.deepEqual(moveClips(clips, ['a', 'c'], 4).map(clip => clip.id), ['b', 'd', 'a', 'c'])
  assert.deepEqual(moveClips(clips, ['c', 'd'], 0).map(clip => clip.id), ['c', 'd', 'a', 'b'])
  assert.strictEqual(moveClips(clips, ['a', 'b'], 2), clips)
  assert.equal(splitClip(clips, 1, 'split')[1].mediaId, 'source')
})

test('size targets match encoder bitrate, speed, source ranges, audio and minimum bitrate', () => {
  const plan = exportPlan(common, metadata)
  assert.equal(plan.targetBytes, 250000)
  const args = buildClipFFmpegArgs(common, metadata.fileSizeBytes, metadata.durationSeconds, 160, 90)
  assert.equal(args[args.indexOf('-b:v') + 1], `${plan.videoKbps}k`)
  const muted = exportPlan({ ...common, muteAudio: true }, metadata)
  assert.equal(muted.audioKbps, 0)
  assert.equal(muted.videoKbps, plan.videoKbps + 128)
  const fast = exportPlan({ ...common, playbackRate: 2 }, metadata)
  assert.equal(fast.duration, 1)
  assert.equal(fast.targetBytes, plan.targetBytes)
  const floor = exportPlan(common, { ...metadata, fileSizeBytes: 1000 })
  assert.equal(floor.videoKbps, 200)
  assert.equal(floor.targetBytes, 82000)
  assert.equal(exportPlan({ ...common, compressionLevel: 'none' }, metadata).targetBytes, null)
  assert.equal(exportPlan({ ...common, mode: 'gif' }, metadata).targetBytes, null)
  assert.equal(exportPlan({ ...common, mode: 'audio', playbackRate: 2, mp3Bitrate: 192 }, metadata).targetBytes, 24000)
  assert.equal(exportPlan({ ...common, crop: { enabled: true, width: 10, height: 10, x: 0, y: 0 } }, metadata).targetBytes, plan.targetBytes, 'crop does not change a bitrate target')
})

test('mixed video sources, delayed audio, speed and measured output encode correctly', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil mixed media '))
  const run = args => { const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: 10 * 1024 * 1024 }); assert.equal(result.status, 0, result.stderr.toString()); return result.stdout }
  try {
    const red = path.join(work, 'red video.mp4'), blue = path.join(work, 'blue video.mp4'), sound = path.join(work, 'audio track.wav')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=2', '-c:v', 'libx264', red])
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=128x128:r=24:d=2', '-c:v', 'libx264', blue])
    run(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', sound])
    const media = await Promise.all([red, blue, sound].map(async (file, i) => ({ id: String(i), kind: i === 2 ? 'audio' : 'video', metadata: await readMetadata(file, ffprobe.path) })))
    const meta = media[0].metadata
    const options = { ...common, inputPath: red, outputDir: work, outputPath: path.join(work, 'mixed export.mp4'), media, compressionLevel: 'none', hasAudio: false,
      clips: [{ id: 'blue', mediaId: '1', startSeconds: 0.5, endSeconds: 1.5 }, { id: 'red', mediaId: '0', startSeconds: 0, endSeconds: 1 }],
      audioClips: [{ id: 'music', mediaId: '2', startSeconds: 0, endSeconds: 1, timelineStart: 0.5, volume: 0.5 }] }
    let measured
    await runFFmpeg(options, meta.fileSizeBytes, meta.durationSeconds, meta.width, meta.height, ffmpeg, event => { if (event.type === 'complete') measured = event.outputSizeBytes })
    assert.equal(measured, fs.statSync(options.outputPath).size)
    const output = await readMetadata(options.outputPath, ffprobe.path)
    assert.ok(Math.abs(output.durationSeconds - 2) < 0.15)
    assert.equal(output.audioCodec, 'aac')
    const first = run(['-ss', '0.2', '-i', options.outputPath, '-frames:v', '1', '-vf', 'crop=2:2:80:44', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const second = run(['-ss', '1.2', '-i', options.outputPath, '-frames:v', '1', '-vf', 'crop=2:2:80:44', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    assert.ok(first[2] > first[0], 'blue media appears first')
    assert.ok(second[0] > second[2], 'red media appears second')
    const rms = at => { const pcm = run(['-ss', String(at), '-i', options.outputPath, '-t', '0.1', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']); let sum = 0; for (let i = 0; i < pcm.length; i += 2) sum += pcm.readInt16LE(i) ** 2; return Math.sqrt(sum / (pcm.length / 2)) }
    assert.ok(rms(0.1) < 10, 'audio is silent before its timeline start')
    assert.ok(rms(0.8) > 100, 'added audio is audible at its timeline position')
    const audioPath = path.join(work, 'fast audio.mp3')
    await runFFmpeg({ ...options, mode: 'audio', playbackRate: 2, outputPath: audioPath, mp3Bitrate: 192 }, meta.fileSizeBytes, meta.durationSeconds, meta.width, meta.height, ffmpeg, () => {})
    const audioMeta = await readMetadata(audioPath, ffprobe.path)
    assert.ok(Math.abs(audioMeta.durationSeconds - 1) < 0.15)
    const estimate = exportPlan({ ...options, mode: 'audio', playbackRate: 2, mp3Bitrate: 192 }, meta).targetBytes
    assert.ok(Math.abs(fs.statSync(audioPath).size - estimate) / estimate < 0.12, 'CBR estimate is close to real audio output including headers')
    await assert.rejects(runFFmpeg({ ...options, outputPath: path.join(work, 'missing directory', 'fail.mp4') }, meta.fileSizeBytes, 2, 160, 90, ffmpeg, () => {}), /No such file|Error opening|Invalid argument/i)
  } finally { fs.rmSync(work, { recursive: true, force: true }) }
})
