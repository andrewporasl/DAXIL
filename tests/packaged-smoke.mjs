// Exercise the real packaged preload, IPC handlers and bundled binaries.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil packaged test '))
const input = path.join(work, 'source 100% video.mp4')
const output = path.join(work, 'split reordered video.mp4')
const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', input])
assert.equal(made.status, 0, made.stderr.toString())
const port = 9237
const executable = path.resolve(process.argv[2] ?? 'dist/win-unpacked/DAXIL.exe')
const proc = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run'], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let target
  for (let attempt = 0; attempt < 100; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(page => page.type === 'page'); if (target) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(target, 'Packaged application did not start')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const call = expression => new Promise((resolve, reject) => {
    const requestId = ++id
    const timeout = setTimeout(() => { socket.removeEventListener('message', listener); reject(new Error('Packaged IPC timed out')) }, 20000)
    const listener = event => {
      const result = JSON.parse(event.data)
      if (result.id !== requestId) return
      clearTimeout(timeout); socket.removeEventListener('message', listener)
      if (result.error || result.result?.exceptionDetails) reject(new Error(JSON.stringify(result)))
      else resolve(result.result.result.value)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  for (let i = 0; i < 50; i++) { if (await call('Boolean(window.electronAPI)')) break; await new Promise(resolve => setTimeout(resolve, 100)) }
  const metadata = await call(`window.electronAPI.getMetadata(${JSON.stringify(input)})`)
  assert.equal(metadata.width, 160)
  const clip = (id, startSeconds, endSeconds, timelineStart) => ({ id, mediaId: 'src', kind: 'video', track: 0, timelineStart, startSeconds, endSeconds, x: 0, y: 0, scale: 1, opacity: 1, volume: 1, muted: false })
  const options = { mode: 'video', inputPath: input, outputPath: output, outputDir: work, outputFileName: 'split', compressionLevel: '50', muteAudio: false, hasAudio: true, trim: { enabled: false, startSeconds: 0, endSeconds: 2 }, crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, media: [{ id: 'src', kind: 'video', metadata }], project: { width: 160, height: 90, fps: 30 },
    // The second half first, then the first half, on V1.
    clips: [clip('tail', 1, 2, 0), clip('head', 0, 1, 1)] }
  const measured = await call(`window.electronAPI.measureExport(${JSON.stringify(options)})`)
  assert.ok(measured > 0)
  await call(`window.electronAPI.runFFmpeg(${JSON.stringify(options)})`)
  assert.equal(fs.statSync(output).size, measured, 'measured and actual exports must agree')
  const previewStatus = await call(`fetch('safe-file://video?path=' + encodeURIComponent(${JSON.stringify(input)}), { headers: { Range: 'bytes=0-31' } }).then(async response => ({ status: response.status, length: (await response.arrayBuffer()).byteLength }))`)
  assert.deepEqual(previewStatus, { status: 206, length: 32 }, 'packaged preview handles spaces and percent characters')
  const metadataOut = await call(`window.electronAPI.getMetadata(${JSON.stringify(output)})`)
  assert.ok(Math.abs(metadataOut.durationSeconds - 2) < 0.15)
  console.log(`PACKAGED PASS: bundled FFmpeg/FFprobe, split/reordered export, exact measurement (${measured} bytes), safe-file path and range handling`)
  await call('window.close()').catch(() => {})
} finally {
  socket?.close()
  if (proc.exitCode === null) proc.kill()
  // Chromium may still be closing profile handles; leave the isolated fixture directory.
}
