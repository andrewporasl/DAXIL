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
protocol.registerSchemesAsPrivileged([{ scheme: 'safe-file', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])

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
    // Like the real downloader, every link gives a fresh file, which the app treats as temporary.
    let downloads = 0
    const isDownload = file => path.basename(file).startsWith('download')
    ipcMain.handle('download:start', () => { const file = path.join(work, `download${++downloads}.mp4`); fs.copyFileSync(secondSource, file); return { filePath: file, title: `clip${downloads}` } })
    let discarded = []
    ipcMain.handle('download:discard', (_, files) => { discarded.push(...files); return files.length })
    ipcMain.handle('download:cancel', () => {})
    ipcMain.handle('ffmpeg:measure', () => 123456)
    let previewed
    ipcMain.handle('ffmpeg:video-preview', (_, options) => { previewed = options; return { path: source, sizeBytes: 54321 } })
    ipcMain.handle('settings:get', () => ({ defaultOutputDir: work, ffmpegPath: 'auto', ffprobePath: 'auto', ytDlpPath: 'auto' }))
    ipcMain.handle('ffprobe:metadata', (_, file = source) => ({ filePath: file, fileName: path.basename(file), durationSeconds: file === secondSource || isDownload(file) ? 2 : 8, width: file === audioSource ? 0 : 320, height: file === audioSource ? 0 : 180, format: 'mp4', videoCodec: 'h264', audioCodec: file === audioSource ? 'pcm_s16le' : 'none', videoBitrate: 100000, audioBitrate: 0, totalBitrate: 100000, fileSizeBytes: fs.statSync(source).size, fps: 30 }))
    ipcMain.handle('ffmpeg:thumbnails', () => ['data:image/jpeg;base64,' + thumbnail.toString('base64')])
    ipcMain.handle('dialog:save-export', () => path.join(work, 'edited.mp4'))
    ipcMain.handle('update:status', () => ({ state: 'idle', mode: 'dev', current: '0.0.0' }))
    ipcMain.handle('convert:output-path', (_, mode, name) => path.join(work, 'converted', `${name}${mode === 'audio' ? '.mp3' : mode === 'gif' ? '.gif' : '.mp4'}`))
    ipcMain.handle('ffmpeg:run', (event, options) => { exported = options; event.sender.send('ffmpeg:progress', { type: 'complete', outputPath: options.outputPath, outputSizeBytes: 123456 }) })
    protocol.handle('safe-file', request => {
      const file = new URL(request.url).searchParams.get('path')
      const size = fs.statSync(file).size
      const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '')
      const start = range && range[1] ? Number(range[1]) : 0
      const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      const headers = { 'Content-Type': file.endsWith('.wav') ? 'audio/wav' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Access-Control-Allow-Origin': '*' }
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
    // The visible timeline (clips plus editing room) is exposed as data-span; measure the scale from it.
    const span = () => js(`Number(document.querySelector('.timeline-content').dataset.span)`)
    const timelineEnd = () => js(`Math.max(1, ...Array.from(document.querySelectorAll('.clip'), c => Number(c.dataset.start) + Number(c.dataset.out) - Number(c.dataset.in)))`)
    const pps = async () => (await rect('.timeline-content')).width / await span()
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

    // There is editing room after the last clip, and the export end is marked at the clip's end.
    const spanBefore = await span()
    assert.ok(spanBefore > 8.5, `the timeline shows room past the last clip: ${spanBefore}`)
    const endMark = async () => (await rect('.timeline-end')).x - (await rect('.timeline-content')).x

    // Trim from the end, undo, redo, then trim from the start (the out point stays put).
    const endBefore8 = await endMark()
    await drag('.clip-video .clip-trim.end', -2 * pixelsPerSecond)
    assert.ok(Math.abs((await ranges())[0][1] - 6) < 0.05, `right trim should remove two seconds: ${JSON.stringify(await ranges())}`)
    assert.equal(await span(), spanBefore, 'shortening a clip never re-zooms the timeline')
    assert.ok(Math.abs((await rect('.clip-video')).width - 6 * pixelsPerSecond) < 2, 'the clip shrinks in place at the same scale')
    assert.ok(Math.abs((endBefore8 - await endMark()) - 2 * pixelsPerSecond) < 2, 'the export end follows the last clip')
    // The trimmed tail can be dragged straight back out, then the trim is restored for the rest of the test.
    await drag('.clip-video .clip-trim.end', 2 * pixelsPerSecond)
    assert.ok(Math.abs((await ranges())[0][1] - 8) < 0.05, `the clip can be lengthened again: ${JSON.stringify(await ranges())}`)
    await click('[aria-label="Undo edit"]')
    assert.ok(Math.abs((await ranges())[0][1] - 6) < 0.05)
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
    await seekTo((trimmed.start + 2.5) / await span())
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
    await seekTo((stacked.start + 0.5) / await span())
    await waitFor(async () => (await count('.layer')) === 2, 'both layers render in the preview')
    await click('[aria-label="Undo edit"]')
    assert.equal(await count('.track-video[data-track="1"] .clip-video'), 0, 'undo puts it back on V1')
    await click('[aria-label="Redo edit"]')

    // Dragging the top clip up onto the spare V3 doesn't open yet another track: it stays on V2.
    const v3Row = await rect('.track-video[data-track="2"]')
    const topClip = await rect('.track-video[data-track="1"] .clip-video')
    await dragXY('.track-video[data-track="1"] .clip-video', 0, v3Row.y + v3Row.height / 2 - (topClip.y + topClip.height / 2))
    assert.equal(await count('.track-video[data-track="1"] .clip-video'), 1, 'the top clip stays one above the rest')
    assert.equal(await count('.track-video'), 3, 'no extra empty tracks pile up')
    // Leapfrogging: alternately lift the lower clip above the other. The two clips swap places and the
    // timeline stays at V1, V2 and one spare, however many times it's done.
    for (let hop = 0; hop < 4; hop++) {
      const lower = await rect('.track-video[data-track="0"] .clip-video')
      const spare = await rect('.track-video[data-track="2"]')
      await dragXY('.track-video[data-track="0"] .clip-video', 0, spare.y + spare.height / 2 - (lower.y + lower.height / 2))
      assert.equal(await count('.track-video'), 3, `leapfrog ${hop + 1}: still V1, V2 and one spare`)
      assert.equal(await count('.track-video[data-track="0"] .clip-video'), 1)
      assert.equal(await count('.track-video[data-track="1"] .clip-video'), 1)
    }
    for (let hop = 0; hop < 4; hop++) await click('[aria-label="Undo edit"]')

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

    // Zoom out past fit: the strip stays full width and shows more empty timeline; Fit comes back.
    const fitSpan = await span()
    const fitWidth = (await rect('.timeline-content')).width
    for (let i = 0; i < 12; i++) await click('[aria-label="Zoom out"]')
    await frames()
    assert.equal(await js(`document.querySelector('.timeline-zoom').textContent`), '0.25×')
    assert.ok(Math.abs(await span() - fitSpan * 4) < 0.01, `zoomed out to 0.25× shows four times the range: ${await span()} vs ${fitSpan}`)
    assert.ok(Math.abs((await rect('.timeline-content')).width - fitWidth) < 2, 'the strip still fills the viewport')
    assert.ok(await js(`document.querySelector('[aria-label="Zoom out"]').disabled`), 'zoom out stops at 0.25×')
    await click('.timeline-zoom')
    await frames()
    assert.ok(Math.abs(await span() - fitSpan) < 0.01, 'Fit returns to the clips plus headroom')

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

    // Toolbar stays compact; the inspector holds the selected clip's properties, then compression and export.
    const toolbar = await rect('.timeline-toolbar')
    assert.ok(toolbar.height < 40, 'editing controls should stay compact')
    assert.equal(await js('document.querySelectorAll(".timeline-editor input").length'), 0)
    const headings = await js(`Array.from(document.querySelectorAll('.inspector-heading .section-title'), h => h.textContent)`)
    assert.deepEqual(headings, ['Clip properties', 'Compression', 'Export'])

    // Crop and transform live on the timeline toolbar as compact strips.
    const toolButton = label => `Array.from(document.querySelectorAll('.tool-button')).find(button => button.textContent === '${label}')`
    await js(`${toolButton('Crop')}.click()`)
    await waitFor(() => js('Boolean(document.querySelector(".tool-strip .tool-strip-tag.is-crop") && document.querySelector(".crop-box"))'), 'crop strip did not open')
    await js(`Array.from(document.querySelectorAll('.tool-segment button')).find(button => button.textContent === '1:1').click()`)
    await waitFor(() => js('(() => { const r = document.querySelector(".crop-box").getBoundingClientRect(); return Math.abs(r.width - r.height) < 2 })()'), '1:1 crop is not square')
    assert.equal(await js('document.querySelector(".crop-overlay-layer").classList.contains("is-passive")'), false)
    await js(`${toolButton('Crop')}.click()`)
    assert.ok(await js('document.querySelector(".crop-overlay-layer").classList.contains("is-passive")'), 'closed crop tool lets clicks through')
    assert.ok(await js(`${toolButton('Crop')}.classList.contains('has-crop')`), 'crop button marks an applied crop')
    await js(`${toolButton('Crop')}.click()`)
    await js(`Array.from(document.querySelectorAll('.tool-chip')).find(button => button.textContent === 'Reset').click()`)
    await waitFor(() => js('!document.querySelector(".crop-box")'), 'crop reset did not clear the crop')
    await js(`${toolButton('Transform')}.click()`)
    await waitFor(() => js('Boolean(document.querySelector(".tool-strip .tool-strip-tag:not(.is-crop)"))'), 'transform strip did not open')
    await js(`${toolButton('Transform')}.click()`)
    assert.ok(!(await js('Boolean(document.querySelector(".tool-strip"))')), 'transform strip closes')

    // Export carries the free-form clips and the project frame.
    exported = null
    await js(`Array.from(document.querySelectorAll('.export-panel .btn-primary')).find(button => button.textContent.includes('Export')).click()`)
    await waitFor(() => exported, 'Export was not requested')
    assert.equal(exported.clips.length, 2 + audioClipsBefore)
    assert.deepEqual(exported.project, { width: 320, height: 180, fps: 30 })
    assert.ok(exported.clips.every(clip => typeof clip.track === 'number' && typeof clip.timelineStart === 'number'))

    // Size check and invalidation.
    await js(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Get exact').click()`)
    await waitFor(() => js('document.querySelector(".export-metric-card").textContent.includes("Exact size")'), 'Measured size was not displayed')
    await js(`document.querySelector('.speed-select').value = '2'; document.querySelector('.speed-select').dispatchEvent(new Event('change', { bubbles:true }))`)
    assert.ok(!(await js('document.querySelector(".export-metric-card").textContent')).includes('Exact size'), 'changing settings invalidates a measured size')

    // The canvas can be changed after import; export follows it.
    await click('.canvas-button')
    await waitFor(() => js('Boolean(document.querySelector(".canvas-popover"))'), 'canvas menu did not open')
    await js(`Array.from(document.querySelectorAll('.canvas-popover button')).find(button => button.textContent.includes('Square')).click()`)
    await waitFor(() => js('!document.querySelector(".canvas-popover") && document.querySelector(".canvas-button").textContent.includes("1:1")'), 'canvas did not switch to square')
    exported = null
    await js(`Array.from(document.querySelectorAll('.export-panel .btn-primary')).find(button => button.textContent.includes('Export')).click()`)
    await waitFor(() => exported, 'Export was not requested after canvas change')
    assert.deepEqual(exported.project, { width: 1080, height: 1080, fps: 30 })
    await click('.canvas-button')
    await setInput('.canvas-custom input[aria-label="Canvas width"]', '320')
    await setInput('.canvas-custom input[aria-label="Canvas height"]', '180')
    await js(`document.querySelector('.canvas-custom .tool-chip').click()`)
    await waitFor(() => js('document.querySelector(".canvas-button").textContent.includes("16:9")'), 'custom canvas size did not apply')

    // Preview renders a short window of the real export and plays it in a popup.
    await js(`Array.from(document.querySelectorAll('.export-panel button')).find(button => button.textContent.includes('Preview 5s')).click()`)
    await waitFor(() => js('Boolean(document.querySelector(".preview-modal video"))'), 'preview popup did not open')
    assert.equal(previewed.mode, 'video')
    assert.deepEqual(previewed.project, { width: 320, height: 180, fps: 30 })
    const previewEnd = Math.max(...previewed.clips.map(c => c.timelineStart + c.endSeconds - c.startSeconds))
    assert.ok(previewed.clips.length > 0 && previewEnd / (previewed.playbackRate ?? 1) <= 5.01, `preview plays for at most 5 s: ${previewEnd} at ${previewed.playbackRate}×`)
    assert.ok((await js('document.querySelector(".preview-modal").textContent')).includes('320 × 180'))
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(() => js('!document.querySelector(".preview-modal")'), 'Escape did not close the preview')

    // Paste a link: a dialog asks whether to edit it or convert it. Into the pool, it lands at the end of V1;
    // GIF goes straight to the converted-links folder.
    const beforeLink = (await ranges()).length
    const endBefore = await timelineEnd()
    await setInput('.link-box-input', 'https://x.com/someone/status/1')
    await click('.link-box-add')
    await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not open')
    assert.ok((await js('document.querySelector(".link-modal").textContent')).includes('x.com'), 'the dialog names the site')
    assert.equal(await js('document.activeElement && document.activeElement.textContent.includes("Add to media pool")'), true, 'Enter picks the media pool')
    await js(`document.querySelector('.link-modal button.link-choice').click()`)
    await waitFor(async () => (await ranges()).length === beforeLink + 1, 'the downloaded video was not added to the timeline')
    const linkClip = (await clipsOn('.clip-video')).find(clip => clip.track === 0 && Math.abs(clip.start - endBefore) < 0.01)
    assert.ok(linkClip, 'the link lands at the end of V1')
    exported = null
    await setInput('.link-box-input', 'https://youtu.be/abc')
    await click('.link-box-gif')
    await waitFor(() => exported, 'Quick GIF export was not requested')
    assert.equal(exported.mode, 'gif')
    assert.equal(path.dirname(exported.outputPath), path.join(work, 'converted'), 'conversions go to their own folder, no save dialog')
    assert.deepEqual(exported.clips.map(clip => [clip.startSeconds, clip.endSeconds]), [[0, 2]], 'the whole downloaded clip becomes the GIF')
    assert.equal((await ranges()).length, beforeLink + 1, 'quick GIF does not touch the timeline')

    // After export, the result panel offers to delete the (temporary) link downloads.
    await waitFor(() => js('Boolean(document.querySelector(".cleanup-prompt"))'), 'no cleanup prompt after export')
    assert.ok((await js('document.querySelector(".cleanup-prompt").textContent')).includes('Delete 2 downloaded clips'))
    const poolWithDownloads = await js('document.querySelectorAll(".media-asset").length')
    await js(`document.querySelector('.cleanup-prompt .btn-danger').click()`)
    await waitFor(() => discarded.length === 2, `downloads were not discarded: ${JSON.stringify(discarded)}`)
    assert.ok(discarded.every(isDownload), 'only downloaded files are discarded')
    assert.equal(await js('document.querySelectorAll(".media-asset").length'), poolWithDownloads - 2, 'downloads leave the pool')
    assert.equal((await ranges()).length, beforeLink, 'the downloaded clip leaves the timeline')
    await click('[aria-label="Undo edit"]')
    assert.ok(!(await js('Array.from(document.querySelectorAll(".media-asset"), a => a.textContent).join()')).includes('clip1'), 'undo cannot bring back a deleted download')

    // Removing a download from the pool deletes its file too.
    discarded = []
    await setInput('.link-box-input', 'https://soundcloud.com/someone/track')
    await click('.link-box-add')
    await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not open')
    await js(`document.querySelector('.link-modal button.link-choice').click()`)
    await waitFor(async () => (await js('document.querySelectorAll(".media-asset").length')) === poolWithDownloads - 1, 'third download not added')
    await js(`window.confirm = () => true; document.querySelector('[aria-label="Remove clip3 from pool"]').click()`)
    await waitFor(() => discarded.length === 1 && discarded[0].endsWith('download3.mp4'), `removing a download did not delete it: ${JSON.stringify(discarded)}`)

    // Convert and save: straight to MP3 in the converted-links folder; the timeline is untouched. Esc cancels.
    await js(`document.querySelector('.export-result .btn-ghost, .result-panel .btn-ghost') && document.querySelector('.export-result .btn-ghost, .result-panel .btn-ghost').click(); true`)
    const timelineBefore = (await ranges()).length
    await setInput('.link-box-input', 'https://soundcloud.com/someone/other')
    await click('.link-box-add')
    await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not open again')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await waitFor(() => js('!document.querySelector(".link-modal")'), 'Escape did not close the link dialog')
    exported = null
    await setInput('.link-box-input', 'https://soundcloud.com/someone/other')
    await click('.link-box-add')
    await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'the link dialog did not reopen')
    await js(`Array.from(document.querySelectorAll('[aria-label="Convert to"] button')).find(b => b.textContent === 'MP3').click()`)
    await js(`document.querySelector('.link-choice-go').click()`)
    await waitFor(() => exported, 'convert to MP3 was not requested')
    assert.equal(exported.mode, 'audio')
    assert.ok(exported.outputPath.endsWith('.mp3') && path.dirname(exported.outputPath) === path.join(work, 'converted'))
    assert.equal((await ranges()).length, timelineBefore, 'converting does not touch the timeline')

    // Clip properties: split a clip, give one piece its own speed and gain; the other piece is untouched.
    {
      const pieceSelector = '.track-video[data-track="0"] .clip-video'
      const before = await clipsOn(pieceSelector)
      const first = before[0]
      const firstBox = await js(`(() => { const c = Array.from(document.querySelectorAll('${pieceSelector}')).sort((a, b) => a.dataset.start - b.dataset.start)[0]; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      await clickAt(firstBox.x + firstBox.width * 0.25, firstBox.y + firstBox.height / 2)
      await seekTo((first.start + (first.out - first.in) / 2) / await span())
      await click('[aria-label="Split"]')
      await waitFor(async () => (await clipsOn(pieceSelector)).length === before.length + 1, 'split for clip properties failed')
      const pieces = await clipsOn(pieceSelector)
      const pieceBox = await js(`(() => { const c = Array.from(document.querySelectorAll('${pieceSelector}')).sort((a, b) => a.dataset.start - b.dataset.start)[0]; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
      await clickAt(pieceBox.x + pieceBox.width / 2, pieceBox.y + pieceBox.height / 2)
      await waitFor(() => js('Boolean(document.querySelector(".clip-properties"))'), 'clip properties did not show for the selected piece')
      await js(`Array.from(document.querySelectorAll('[aria-label="Clip speed"] button')).find(b => b.textContent === '2×').click()`)
      await waitFor(() => js('Boolean(document.querySelector(".clip-speed"))'), 'no 2x badge on the clip')
      const widthAfter = await js(`(() => { const c = Array.from(document.querySelectorAll('${pieceSelector}')).sort((a, b) => a.dataset.start - b.dataset.start)[0]; return c.getBoundingClientRect().width })()`)
      assert.ok(Math.abs(widthAfter - pieceBox.width / 2) < 3, `a 2x piece is half as long on the timeline: ${pieceBox.width} -> ${widthAfter}`)
      assert.ok((await js('document.querySelector(".clip-properties").textContent')).includes('has no sound'), 'a silent source offers no gain control')
      // Gain is per clip and works the same on audio-track clips (MP3, WAV…).
      const musicBox = await rect('.clip-audio')
      await clickAt(musicBox.x + Math.min(20, musicBox.width / 2), musicBox.y + musicBox.height / 2)
      await waitFor(() => js('Boolean(document.querySelector("[aria-label=\\"Adjust gain\\"]"))'), 'no gain control for the audio clip')
      await js(`Array.from(document.querySelectorAll('[aria-label="Adjust gain"] button')).find(b => b.textContent === '+3 dB').click()`)
      await waitFor(() => js('document.querySelector(".clip-volume-value").textContent === "+3.0 dB"'), 'gain did not change')
      // The boost reaches live playback through a Web Audio gain stage, and the file still loads.
      await waitFor(() => js('Array.from(document.querySelectorAll("audio")).some(a => a.dataset.gain === "1.413" && a.volume === 1)'), 'the preview is not boosted')
      assert.ok(await js('Array.from(document.querySelectorAll("audio")).every(a => !a.error)'), 'audio failed to load with CORS')
      assert.ok(await js('Array.from(document.querySelectorAll("video")).every(v => !v.error && v.readyState >= 1)'), 'video failed to load with CORS')
      exported = null
      await js(`Array.from(document.querySelectorAll('.export-panel .prop-segment button')).find(button => button.textContent === 'MP4').click()`)
      await js(`Array.from(document.querySelectorAll('.export-panel button')).find(button => /Export MP4/.test(button.textContent)).click()`)
      await waitFor(() => exported, 'export with a fast piece was not requested')
      const fastPiece = exported.clips.find(c => c.speed === 2)
      assert.ok(fastPiece, 'the piece exports with its speed')
      const louder = exported.clips.filter(c => c.kind === 'audio' && Math.abs(c.volume - 1.4125) < 0.01)
      assert.equal(louder.length, 1, `+3 dB is about 1.41x gain on exactly one audio clip: ${JSON.stringify(exported.clips.map(c => [c.kind, c.volume]))}`)
      assert.equal(exported.clips.filter(c => c.speed && c.speed !== 1).length, 1, 'only the selected piece changed')
      assert.equal(pieces.length, before.length + 1)
    }

    // Text: T adds a title at the playhead on its own track, edited from the strip and drawn in the preview.
    const key = (k, mods = {}) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} })); true`)
    const setText = (selector, value, proto = 'HTMLTextAreaElement', event = 'input') => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })) })()`)
    await js('document.activeElement && document.activeElement.blur(); true')
    await seekTo(0.1)
    await key('t')
    await waitFor(async () => await count('.clip-text') === 1 && await count('.text-strip-content') === 1, 'T did not add a text clip with its editor')
    assert.equal(await count('.track-text'), 2, 'one text row plus a spare')
    await setText('.text-strip-content', 'Hello DAXIL')
    await setText('.text-strip-font', 'serif', 'HTMLSelectElement', 'change')
    await waitFor(() => js('document.querySelector(".clip-text").textContent.includes("Hello DAXIL")'), 'text content did not reach the clip')
    await waitFor(async () => await count('.layer-text') === 1, 'text is not drawn in the preview')
    const textBefore = await rect('.layer-text')
    await dragXY('.layer-text', 30, -20)
    const textAfter = await rect('.layer-text')
    assert.ok(Math.abs(textAfter.x - textBefore.x - 30) < 3 && Math.abs(textAfter.y - textBefore.y + 20) < 3, `text drags in the preview: ${JSON.stringify([textBefore, textAfter])}`)

    fs.writeFileSync(path.join(root, 'out/editor-ui-text.png'), (await contents.capturePage()).toPNG())

    // Dragging near the canvas edge snaps the text to it and shows a guide until the drop.
    const frameBox = await js(`(() => { const r = document.querySelector('.frame-mask').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    const snapFrom = await rect('.layer-text')
    const toLeft = frameBox.x + 4 - snapFrom.x
    const sx = snapFrom.x + snapFrom.width / 2, sy = snapFrom.y + snapFrom.height / 2
    await input('mouseMoved', sx, sy)
    await input('mousePressed', sx, sy, 1)
    for (let step = 1; step <= 8; step++) { await input('mouseMoved', sx + toLeft * step / 8, sy, 1); await pause(16) }
    await waitFor(async () => await count('.canvas-guide.is-vertical') === 1, 'no snap guide while dragging near the edge')
    await input('mouseReleased', sx + toLeft, sy)
    await waitFor(async () => await count('.canvas-guide') === 0, 'the guide stays after the drop')
    const textSnapped = await rect('.layer-text')
    assert.ok(Math.abs(textSnapped.x - frameBox.x) < 1.5, `text left edge snaps to the canvas edge: ${textSnapped.x} vs ${frameBox.x}`)
    await click('[aria-label="Undo edit"]')

    // Copy and paste: Ctrl+C / Ctrl+V puts a copy at the playhead, lifted clear of what is there.
    await js('document.activeElement && document.activeElement.blur(); true')
    await key('c', { ctrlKey: true })
    await key('v', { ctrlKey: true })
    await waitFor(async () => await count('.clip-text') === 2, 'pasting text did not add a copy')
    const texts = await clipsOn('.clip-text')
    assert.deepEqual(texts.map(clip => clip.track).sort(), [0, 1], 'the overlapping copy goes up a track')
    const videosBefore = (await ranges()).length
    const videoBox = await rect('.clip-video')
    await clickAt(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2)
    await key('x', { ctrlKey: true })
    await waitFor(async () => (await ranges()).length === videosBefore - 1, 'Ctrl+X did not cut the clip')
    await key('v', { ctrlKey: true })
    await waitFor(async () => (await ranges()).length === videosBefore, 'Ctrl+V did not paste the cut clip')

    // Text goes to the export as images drawn by the renderer.
    exported = null
    await js(`Array.from(document.querySelectorAll('.export-panel .prop-segment button')).find(button => button.textContent === 'MP4').click()`)
    await js(`Array.from(document.querySelectorAll('.export-panel button')).find(button => /Export MP4/.test(button.textContent)).click()`)
    await waitFor(() => exported, 'export with text was not requested')
    const exportedTexts = exported.clips.filter(clip => clip.kind === 'text')
    assert.equal(exportedTexts.length, 2)
    assert.equal(exportedTexts[0].text.font, 'serif')
    assert.ok(exportedTexts.every(clip => /^data:image\/png;base64,/.test(exported.textImages[clip.id])), 'each text clip carries its PNG')

    // With only sound left on the timeline, MP3 is the only format.
    if (!await count('.clip-audio')) {
      const musicIndex = await js(`Array.from(document.querySelectorAll('.media-asset')).findIndex(a => a.textContent.includes('music'))`)
      await poolDrop(musicIndex, '.track-audio')
      await waitFor(async () => await count('.clip-audio') > 0, 'music did not land on the timeline')
    }
    for (let guard = 0; await count('.clip-video, .clip-text'); guard++) {
      if (guard > 20) throw new Error('could not clear the visible clips')
      const box = await rect('.clip-video, .clip-text')
      await clickAt(box.x + Math.min(10, box.width / 2), box.y + box.height / 2)
      await key('Delete')
      await frames()
    }
    await waitFor(() => js(`Array.from(document.querySelectorAll('.export-panel .prop-segment button')).find(b => b.textContent === 'MP4').disabled`), 'MP4 is still offered for a sound-only timeline')
    assert.ok(await js(`Array.from(document.querySelectorAll('.export-panel .prop-segment button')).find(b => b.textContent === 'MP3').classList.contains('is-on')`))
    exported = null
    await js(`Array.from(document.querySelectorAll('.export-panel button')).find(button => /Export MP3/.test(button.textContent)).click()`)
    await waitFor(() => exported, 'sound-only export was not requested')
    assert.equal(exported.mode, 'audio')

    fs.writeFileSync(path.join(root, 'out/editor-ui.png'), (await contents.capturePage()).toPNG())
    console.log('UI PASS: rename, trim/undo/redo, split, cross-track drag, snapping, anchored zoom, marquee, audio tracks, pool delete cascade, slim inspector, export shape, size check, link import, quick GIF, canvas size, video preview, temporary downloads, link dialog (pool / convert), clip properties (speed, gain), text overlays, canvas snapping, copy/paste, sound-only MP3, timeline headroom, track cap')
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
