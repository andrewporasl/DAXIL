// Exercise real React pointer handling in an isolated Electron window.
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil-ui-'))
app.setPath('userData', path.join(work, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
protocol.registerSchemesAsPrivileged([{ scheme: 'safe-file', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } }])

app.whenReady().then(async () => {
  let window
  try {
    const ffmpeg = require('ffmpeg-static')
    const source = path.join(work, 'source video.mp4')
    const generated = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8', '-c:v', 'libx264', source], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    const thumbnail = spawnSync(ffmpeg, ['-v', 'error', '-i', source, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']).stdout
    const audioSource = path.join(work, 'music track.wav')
    const secondSource = path.join(work, 'second video.mp4')
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', audioSource]).status, 0)
    assert.equal(spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=2', '-c:v', 'libx264', secondSource]).status, 0)
    let exported
    let imports = 0
    ipcMain.handle('dialog:open-file', () => source)
    ipcMain.handle('dialog:open-media', () => ++imports === 1 ? [source] : [audioSource, secondSource])
    ipcMain.handle('download:start', () => ({ filePath: secondSource, title: 'second video' }))
    ipcMain.handle('download:cancel', () => {})
    ipcMain.handle('ffmpeg:measure', () => 123456)
    ipcMain.handle('settings:get', () => ({ defaultOutputDir: work, ffmpegPath: 'auto', ffprobePath: 'auto', ytDlpPath: 'auto', downloadDir: work }))
    ipcMain.handle('ffprobe:metadata', (_, file = source) => ({ filePath: file, fileName: path.basename(file), durationSeconds: file === secondSource ? 2 : 8, width: file === audioSource ? 0 : 320, height: file === audioSource ? 0 : 180, format: 'mp4', videoCodec: 'h264', audioCodec: file === audioSource ? 'pcm_s16le' : 'none', videoBitrate: 100000, audioBitrate: 0, totalBitrate: 100000, fileSizeBytes: fs.statSync(source).size, fps: 30 }))
    ipcMain.handle('ffmpeg:thumbnails', () => ['data:image/jpeg;base64,' + thumbnail.toString('base64')])
    ipcMain.handle('dialog:save-export', () => path.join(work, 'edited.mp4'))
    ipcMain.handle('ffmpeg:run', (event, options) => { exported = options; event.sender.send('ffmpeg:progress', { type: 'complete', outputPath: options.outputPath, outputSizeBytes: 123456 }) })
    protocol.handle('safe-file', request => {
      const file = new URL(request.url).searchParams.get('path')
      const size = fs.statSync(file).size
      const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '')
      const start = range && range[1] ? Number(range[1]) : 0
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      const headers = { 'Content-Type': file.endsWith('.wav') ? 'audio/wav' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: range ? 206 : 200, headers })
    })
    window = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: { preload: path.join(root, 'out/preload/preload.js'), sandbox: false, backgroundThrottling: false, offscreen: true } })
    const contents = window.webContents
    const bounded = (promise, label) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8000); timer.unref() })])
    const js = script => bounded(contents.executeJavaScript(script, true), script.slice(0, 100))
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const waitFor = async (condition, message) => {
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) { if (await condition()) return; await pause(30) }
      throw new Error(message)
    }
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const count = selector => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
    const clipsOn = selector => js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}), clip => ({ in: Number(clip.dataset.in), out: Number(clip.dataset.out), start: Number(clip.dataset.start), track: Number(clip.dataset.track) })).sort((a, b) => a.track - b.track || a.start - b.start)`)
    const ranges = async () => (await clipsOn('.clip-video')).map(clip => [clip.in, clip.out])
    const rect = selector => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height } })()`)
    const input = (type, x, y, buttons = 0) => bounded(contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }), type)
    const dragXY = async (selector, dx, dy, from = 'center') => {
      const box = await rect(selector)
      const x = from === 'center' ? box.x + box.width / 2 : box.x + box.width * from, y = box.y + box.height / 2
      await input('mouseMoved', x, y)
      await input('mousePressed', x, y, 1)
      for (let step = 1; step <= 8; step++) { await input('mouseMoved', x + dx * step / 8, y + dy * step / 8, 1); await pause(16) }
      await input('mouseReleased', x + dx, y + dy)
      await pause(40)
    }
    const drag = (selector, dx) => dragXY(selector, dx, 0)
    const clickAt = async (x, y) => { await input('mousePressed', x, y, 1); await input('mouseReleased', x, y) }
    const seekTo = async fraction => { const r = await rect('.timeline-ruler'); await clickAt(r.x + r.width * fraction, r.y + 8) }
    const frames = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
    // The timeline re-fits whenever its length changes, so measure the scale live.
    const timelineEnd = () => js(`Math.max(1, ...Array.from(document.querySelectorAll('.clip'), c => Number(c.dataset.start) + Number(c.dataset.out) - Number(c.dataset.in)))`)
    const pps = async () => (await rect('.timeline-content')).width / await timelineEnd()
    const poolDrop = async (index, selector, fraction = 0.02) => {
      await js(`document.querySelectorAll('.media-asset')[${index}].dispatchEvent(new MouseEvent('click', { bubbles:true }))`)
      await js(`window.dragData = new DataTransfer(); document.querySelectorAll('.media-asset')[${index}].dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:window.dragData }))`)
      await js(`(() => { const lane = document.querySelector(${JSON.stringify(selector)}); const r = lane.getBoundingClientRect(); const x = r.left + r.width * ${fraction}; lane.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:window.dragData, clientX:x, clientY:r.top + 8 })); lane.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:window.dragData, clientX:x, clientY:r.top + 8 })) })()`)
    }
    const setInput = (selector, value) => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)

    if (process.env.DAXIL_TEST_URL) await window.loadURL(process.env.DAXIL_TEST_URL)
    else await window.loadFile(path.join(root, 'out/renderer/index.html'))
    contents.debugger.attach('1.3')
    await js('window.confirm = () => true; true')

    // Import → the first video becomes the project and lands on V1.
    await click('[aria-label="Import media"]')
    await waitFor(async () => (await ranges()).length === 1, 'Video did not load')
    await waitFor(() => js('document.querySelector(".layer video") && document.querySelector(".layer video").readyState >= 2'), 'Video preview did not load')
    assert.equal(await count('.track-video'), 2, 'V1 plus one spare video track')
    assert.equal(await count('.track-audio'), 1, 'one spare audio track')
    const pixelsPerSecond = (await rect('.clip-video')).width / 8

    // Trim from the end, undo, redo, then trim from the start (the out point stays put).
    await drag('.clip-video .clip-trim.end', -2 * pixelsPerSecond)
    assert.ok(Math.abs((await ranges())[0][1] - 6) < 0.05, `right trim should remove two seconds: ${JSON.stringify(await ranges())}`)
    await click('[aria-label="Undo edit"]')
    assert.deepEqual(await ranges(), [[0, 8]], 'one undo should restore the whole drag')
    await click('[aria-label="Redo edit"]')
    await drag('.clip-video .clip-trim.start', await pps())
    const trimmed = (await clipsOn('.clip-video'))[0]
    assert.ok(Math.abs(trimmed.in - 1) < 0.05 && Math.abs(trimmed.out - 6) < 0.05, `left trim keeps the out point: ${JSON.stringify(trimmed)}`)
    assert.ok(Math.abs(trimmed.start - 1) < 0.05, 'the clip stays where it was on the timeline (its start edge moved right)')

    // Split under the playhead.
    const clipBox = await rect('.clip-video')
    await clickAt(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2)
    await seekTo((trimmed.start + 2.5) / await timelineEnd())
    await click('[aria-label="Split"]')
    await waitFor(async () => (await ranges()).length === 2, 'Split did not create two clips')
    const split = await clipsOn('.clip-video')
    assert.ok(Math.abs(split[0].out - split[1].in) < 0.001 && Math.abs(split[1].start - (split[0].start + split[0].out - split[0].in)) < 0.001, `split keeps continuity: ${JSON.stringify(split)}`)

    // Drag the second clip up onto V2: it becomes a stacked layer in the preview.
    const secondBox = (await js(`Array.from(document.querySelectorAll('.clip-video'), c => { const r = c.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, start:Number(c.dataset.start) } }).sort((a,b) => a.start - b.start)`))[1]
    const v2 = await rect('.track-video[data-track="1"]')
    await input('mouseMoved', secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2)
    await input('mousePressed', secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, 1)
    for (let step = 1; step <= 8; step++) { await input('mouseMoved', secondBox.x + secondBox.width / 2 + 30 * step / 8, secondBox.y + secondBox.height / 2 + (v2.y + v2.height / 2 - secondBox.y - secondBox.height / 2) * step / 8, 1); await pause(16) }
    await input('mouseReleased', secondBox.x + secondBox.width / 2 + 30, v2.y + v2.height / 2)
    await waitFor(async () => (await count('.track-video[data-track="1"] .clip-video')) === 1, 'clip did not move to V2')
    assert.equal(await count('.track-video'), 3, 'V3 appears as the new spare track')
    const stacked = (await clipsOn('.clip-video')).find(clip => clip.track === 1)
    assert.ok(stacked.start > split[1].start + 0.1, 'the clip also moved later in time while changing track')
    await seekTo((stacked.start + 0.5) / await timelineEnd())
    await waitFor(async () => (await count('.layer')) === 2, 'both layers render in the preview')
    await click('[aria-label="Undo edit"]')
    assert.equal(await count('.track-video[data-track="1"] .clip-video'), 0, 'undo puts it back on V1')
    await click('[aria-label="Redo edit"]')

    // Snapping: drag the V2 clip back near the end of the V1 clip and it snaps exactly.
    const v1Clip = (await clipsOn('.clip-video')).find(clip => clip.track === 0)
    const v1End = v1Clip.start + v1Clip.out - v1Clip.in
    const stackedBox = await rect('.track-video[data-track="1"] .clip-video')
    const offset = (v1End - stacked.start) * await pps() + 5
    await drag('.track-video[data-track="1"] .clip-video', offset)
    const snapped = (await clipsOn('.clip-video')).find(clip => clip.track === 1)
    assert.ok(Math.abs(snapped.start - v1End) < 0.001, `clip start snaps to the neighbour's end: ${snapped.start} vs ${v1End}`)
    void stackedBox

    // Ctrl+wheel zoom keeps the frame under the cursor fixed.
    const fraction = x => js(`(() => { const r = document.querySelector('.timeline-content').getBoundingClientRect(); return (${x} - r.left) / r.width })()`)
    const zoomView = await rect('.timeline-viewport')
    const ax = zoomView.x + zoomView.width * 0.6, ay = zoomView.y + 40
    const before = await fraction(ax)
    for (let i = 0; i < 5; i++) await bounded(contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: ax, y: ay, deltaX: 0, deltaY: -120, modifiers: 2 }), 'wheel')
    await frames()
    assert.ok(Math.abs(await fraction(ax) - before) < 0.003, 'wheel zoom drifted')
    assert.ok(await count('.timeline-tick') > 1, 'ruler shows ticks')
    await click('.timeline-zoom')
    await frames()

    // Marquee across both video tracks, delete, undo.
    const content = await rect('.timeline-content')
    const v3 = await rect('.track-video[data-track="2"]')
    const v1Row = await rect('.track-video[data-track="0"]')
    await input('mousePressed', content.x + content.width - 8, v3.y + 4, 1)
    for (let step = 1; step <= 6; step++) { await input('mouseMoved', content.x + content.width - 8 - (content.width - 40) * step / 6, v3.y + 4 + (v1Row.y + v1Row.height - 4 - v3.y - 4) * step / 6, 1); await pause(16) }
    await input('mouseReleased', content.x + 32, v1Row.y + v1Row.height - 4)
    assert.equal(await count('.clip-video.is-selected'), 2, 'marquee selects clips on both tracks')
    await click('[aria-label="Remove clip"]')
    assert.equal((await ranges()).length, 0)
    await click('[aria-label="Undo edit"]')
    assert.equal((await ranges()).length, 2)

    // Audio tracks: drop onto A1 and A2, move between them, trim, mute the track.
    await click('[aria-label="Import media"]')
    await waitFor(() => js('document.querySelectorAll(".media-asset").length === 3'), 'Media pool did not import video and audio')
    await poolDrop(1, '.track-audio[data-track="0"]')
    assert.equal(await count('.clip-audio'), 1, 'audio can be dropped onto A1')
    assert.equal(await count('.track-audio'), 2, 'A2 appears as the spare audio track')
    await poolDrop(1, '.track-audio[data-track="1"]', 0.3)
    assert.equal(await count('.track-audio[data-track="1"] .clip-audio'), 1, 'a second audio clip lands on A2')
    assert.equal(await count('.track-audio'), 3)
    const a1 = await rect('.track-audio[data-track="0"]')
    const a2Clip = await rect('.track-audio[data-track="1"] .clip-audio')
    await dragXY('.track-audio[data-track="1"] .clip-audio', 0, a1.y + a1.height / 2 - (a2Clip.y + a2Clip.height / 2))
    assert.equal(await count('.track-audio[data-track="0"] .clip-audio'), 2, 'audio clips can move between tracks')
    await click('[aria-label="Undo edit"]')
    assert.equal(await count('.track-audio[data-track="1"] .clip-audio'), 1)
    const audioBefore = (await clipsOn('.track-audio[data-track="1"] .clip-audio'))[0]
    await drag('.track-audio[data-track="1"] .clip-audio', 40)
    assert.ok((await clipsOn('.track-audio[data-track="1"] .clip-audio'))[0].start > audioBefore.start, 'audio can be moved on its track')
    await drag('.track-audio[data-track="1"] .clip-audio .clip-trim.end', -40)
    assert.ok((await clipsOn('.track-audio[data-track="1"] .clip-audio'))[0].out < audioBefore.out, 'audio edges can be trimmed')
    await click('[aria-label="Mute track A1"]')
    assert.equal(await count('.track-audio[data-track="0"].is-disabled'), 1)
    await click('[aria-label="Unmute track A1"]')

    // Pool delete cascades to the timeline (confirm is auto-accepted) and undoes as one step.
    const audioClipsBefore = await count('.clip-audio')
    const poolBefore = await count('.media-asset')
    await js(`document.querySelectorAll('.media-asset')[1].querySelector('.media-asset-remove').click()`)
    assert.equal(await count('.media-asset'), poolBefore - 1, 'the asset leaves the pool')
    assert.equal(await count('.clip-audio'), 0, 'its clips leave the timeline')
    await click('[aria-label="Undo edit"]')
    assert.equal(await count('.media-asset'), poolBefore, 'undo restores the asset')
    assert.equal(await count('.clip-audio'), audioClipsBefore, 'and its clips')

    // Rename a pool asset: the timeline labels follow, and it is one undo step.
    await js(`document.querySelectorAll('.media-asset')[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 200 }))`)
    await js(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(button => button.textContent.startsWith('Rename')).click()`)
    await waitFor(() => js('Boolean(document.querySelector(".media-asset-rename"))'), 'rename field did not open')
    await setInput('.media-asset-rename', 'intro shot')
    await js(`document.querySelector('.media-asset-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
    await waitFor(() => js('document.querySelectorAll(".media-asset")[0].textContent.includes("intro shot")'), 'pool tile was not renamed')
    assert.ok((await js(`Array.from(document.querySelectorAll('.clip-video .clip-name'), n => n.textContent)`)).some(text => text.includes('intro shot')), 'timeline clips show the new name')
    await click('[aria-label="Undo edit"]')
    assert.ok(!(await js('document.querySelectorAll(".media-asset")[0].textContent')).includes('intro shot'), 'rename is undoable')
    await click('[aria-label="Redo edit"]')

    // Toolbar stays compact; the inspector shows only transform / crop / compression / deliver.
    const toolbar = await rect('.timeline-toolbar')
    assert.ok(toolbar.height < 40, 'editing controls should stay compact')
    assert.equal(await js('document.querySelectorAll(".timeline-editor input").length'), 0)
    const headings = await js(`Array.from(document.querySelectorAll('.inspector-heading .section-title'), h => h.textContent)`)
    assert.ok(!headings.some(text => /^Clip$/i.test(text)), `no clip-details section: ${headings.join(', ')}`)
    assert.ok(headings.some(text => /Deliver/.test(text)) && headings.some(text => /Crop/.test(text)))

    // Export carries the free-form clips and the project frame.
    exported = null
    await js(`Array.from(document.querySelectorAll('.export-panel .btn-primary')).find(button => button.textContent.includes('Export')).click()`)
    await waitFor(() => exported, 'Export was not requested')
    assert.equal(exported.clips.length, 2 + audioClipsBefore)
    assert.deepEqual(exported.project, { width: 320, height: 180, fps: 30 })
    assert.ok(exported.clips.every(clip => typeof clip.track === 'number' && typeof clip.timelineStart === 'number'))

    // Size check and invalidation.
    await js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Check size').click()`)
    await waitFor(() => js('document.querySelector(".export-metric-card").textContent.includes("Measured output")'), 'Measured size was not displayed')
    await js(`document.querySelector('.speed-select').value = '2'; document.querySelector('.speed-select').dispatchEvent(new Event('change', { bubbles:true }))`)
    assert.ok(!(await js('document.querySelector(".export-metric-card").textContent')).includes('Measured output'), 'changing settings invalidates a measured size')

    // Paste a link: the mocked download lands at the end of V1 and in the pool; GIF goes straight to export.
    const beforeLink = (await ranges()).length
    const endBefore = await timelineEnd()
    await setInput('.link-box-input', 'https://x.com/someone/status/1')
    await click('.link-box-add')
    await waitFor(async () => (await ranges()).length === beforeLink + 1, 'the downloaded video was not added to the timeline')
    const linkClip = (await clipsOn('.clip-video')).find(clip => clip.track === 0 && Math.abs(clip.start - endBefore) < 0.01)
    assert.ok(linkClip, 'the link lands at the end of V1')
    exported = null
    await setInput('.link-box-input', 'https://youtu.be/abc')
    await click('.link-box-gif')
    await waitFor(() => exported, 'Quick GIF export was not requested')
    assert.equal(exported.mode, 'gif')
    assert.deepEqual(exported.clips.map(clip => [clip.startSeconds, clip.endSeconds]), [[0, 2]], 'the whole downloaded clip becomes the GIF')
    assert.equal((await ranges()).length, beforeLink + 1, 'quick GIF does not touch the timeline')

    fs.writeFileSync(path.join(root, 'out/editor-ui.png'), (await contents.capturePage()).toPNG())
    console.log('UI PASS: rename, trim/undo/redo, split, cross-track drag, snapping, anchored zoom, marquee, audio tracks, pool delete cascade, slim inspector, export shape, size check, link import, quick GIF')
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (window) {
      fs.writeFileSync(path.join(root, 'out/editor-ui-failure.png'), (await window.webContents.capturePage()).toPNG())
      window.destroy()
    }
    app.exit(1)
  }
})
