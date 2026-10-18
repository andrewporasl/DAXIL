// Drive the built app in an offscreen Electron window with synthetic footage and
// save the README screenshots to resources/showcase. Run with `npm run screenshots`.
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'resources', 'showcase')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'daxil-shots-'))
const ffmpeg = require('ffmpeg-static')
const WIDTH = 1440
const HEIGHT = 900

app.setPath('userData', path.join(work, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
protocol.registerSchemesAsPrivileged([{ scheme: 'safe-file', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true, corsEnabled: true } }])

function render(name, source, seconds, extra = []) {
  const file = path.join(work, name)
  const made = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', source, '-t', String(seconds), ...extra, file], { encoding: 'utf8' })
  assert.equal(made.status, 0, made.stderr)
  return file
}

function thumbnails(file, seconds, count) {
  const frames = []
  for (let i = 0; i < count; i++) {
    const at = (i + 0.5) / count * seconds
    const frame = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=160:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { encoding: null }).stdout
    frames.push('data:image/jpeg;base64,' + frame.toString('base64'))
  }
  return frames
}

app.whenReady().then(async () => {
  let window
  try {
    fs.mkdirSync(outDir, { recursive: true })
    const video = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30']
    // Smooth colour fields and a fractal zoom photograph far better than test patterns.
    const main = render('sunset drive.mp4', 'gradients=s=1280x720:speed=0.02:nb_colors=5:c0=0x1b1f3a:c1=0x6b3fa0:c2=0xff7e5f:c3=0xfeb47b:c4=0x2b5876', 14, video)
    const pip = render('fractal loop.mp4', 'mandelbrot=s=640x360:rate=30:maxiter=120:start_scale=3:end_scale=0.1', 14, video)
    const second = render('cellular.mp4', 'life=s=1280x720:mold=12:r=30:ratio=0.08:death_color=0x111827:life_color=0x8fa7ff:random_fill_ratio=0.1', 8, video)
    const audio = render('ambient pad.wav', 'sine=frequency=220:duration=14', 14)
    const files = { [main]: { d: 14, w: 1280, h: 720, a: 'none' }, [pip]: { d: 14, w: 640, h: 360, a: 'none' }, [second]: { d: 8, w: 1280, h: 720, a: 'none' }, [audio]: { d: 14, w: 0, h: 0, a: 'pcm_s16le' } }
    const thumbs = { [main]: thumbnails(main, 14, 16), [pip]: thumbnails(pip, 14, 1), [second]: thumbnails(second, 8, 1) }

    let imports = 0
    ipcMain.handle('dialog:open-media', () => ++imports === 1 ? [main] : [pip, audio, second])
    ipcMain.handle('dialog:open-file', () => main)
    ipcMain.handle('settings:get', () => ({ defaultOutputDir: path.join(os.homedir(), 'Videos'), ffmpegPath: 'auto', ffprobePath: 'auto', ytDlpPath: 'auto' }))
    ipcMain.handle('ffprobe:metadata', (_, file) => {
      const info = files[file]
      return { filePath: file, fileName: path.basename(file), durationSeconds: info.d, width: info.w, height: info.h, format: info.w ? 'mp4' : 'wav', videoCodec: info.w ? 'h264' : 'none', audioCodec: info.a, videoBitrate: 2_400_000, audioBitrate: 0, totalBitrate: 2_400_000, fileSizeBytes: fs.statSync(file).size, fps: 30 }
    })
    ipcMain.handle('ffmpeg:thumbnails', (_, file) => thumbs[file] ?? [])
    ipcMain.handle('ffmpeg:measure', () => 8_400_000)
    const appData = path.join(os.homedir(), 'AppData', 'Roaming', 'DAXIL')
    ipcMain.handle('app:storage', () => [
      { key: 'exports', label: 'Exports (default)', path: path.join(os.homedir(), 'Videos'), note: 'Where the save dialog opens', exists: true },
      { key: 'downloads', label: 'Link downloads (temporary)', path: path.join(os.tmpdir(), 'daxil-downloads'), note: "2 files, 38.4 MB · deleted when you're done", exists: true },
      { key: 'scratch', label: 'Previews & size checks (temporary)', path: os.tmpdir(), note: 'daxil-preview-* and daxil-measure-* folders, removed automatically', exists: true },
      { key: 'settings', label: 'Settings file', path: path.join(appData, 'config.json'), note: 'Your preferences', exists: true },
      { key: 'ytdlp', label: 'yt-dlp', path: path.join(appData, 'bin', 'yt-dlp.exe'), note: 'Link downloader', exists: true },
      { key: 'ffmpeg', label: 'FFmpeg', path: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DAXIL', 'resources', 'ffmpeg', 'ffmpeg.exe'), note: 'Video encoder', exists: true },
      { key: 'ffprobe', label: 'FFprobe', path: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'DAXIL', 'resources', 'ffmpeg', 'ffprobe.exe'), note: 'Reads media info', exists: true },
      { key: 'appdata', label: 'App data', path: appData, note: 'Settings, yt-dlp and browser cache', exists: true }
    ])
    ipcMain.handle('dialog:save-export', () => path.join(work, 'sunset drive_animated.gif'))
    ipcMain.handle('convert:output-path', (_, mode, name) => path.join(work, `${name}${mode === 'gif' ? '.gif' : mode === 'audio' ? '.mp3' : '.mp4'}`))
    ipcMain.handle('ffmpeg:run', (event, options) => { setTimeout(() => event.sender.send('ffmpeg:progress', { type: 'complete', outputPath: options.outputPath, outputSizeBytes: 3_150_000 }), 300) })
    let releaseDownload
    ipcMain.handle('download:start', async event => {
      // Stream fake progress so the link box can be photographed mid-download.
      for (let percent = 0; percent <= 100; percent += 4) {
        event.sender.send('download:progress', { phase: 'media', percent, message: 'Downloading…' })
        await new Promise(resolve => setTimeout(resolve, percent === 64 ? 1 : 40))
        if (percent === 64) await new Promise(resolve => { releaseDownload = resolve })
      }
      return { filePath: second, title: 'cellular' }
    })
    ipcMain.handle('download:cancel', () => {})
    // Updates: quiet until the Settings shot, which shows a newer version waiting.
    const version = require(path.join(root, 'package.json')).version
    const nextVersion = version.replace(/(\d+)$/, patch => String(Number(patch) + 1))
    ipcMain.handle('update:status', () => ({ state: 'none', mode: 'auto', current: version }))
    ipcMain.handle('update:check', () => ({ state: 'none', mode: 'auto', current: version }))
    // Seeking needs byte ranges, like the real handler in main/index.ts provides.
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

    window = new BrowserWindow({ width: WIDTH, height: HEIGHT, useContentSize: true, show: false, webPreferences: { preload: path.join(root, 'out/preload/preload.js'), sandbox: false, backgroundThrottling: false, offscreen: true } })
    const contents = window.webContents
    const js = script => contents.executeJavaScript(script, true)
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const waitFor = async (condition, message) => {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) { if (await condition()) return; await pause(40) }
      throw new Error(message)
    }
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const rect = selector => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    const settle = async () => { await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120))))') }
    // CDP renders the clip at the requested scale, so crops stay crisp without a huge window.
    const shoot = async (name, selector, scale) => {
      await settle()
      let clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale }
      if (selector) {
        const r = await rect(selector)
        const pad = 6
        clip = { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2, scale }
      }
      const { data } = await contents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })
      fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'))
      console.log(`wrote ${name} (${Math.round(clip.width * scale)}×${Math.round(clip.height * scale)})`)
    }
    const setInput = (selector, value) => js(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const poolDrop = async (index, selector, fraction) => {
      await js(`document.querySelectorAll('.media-asset')[${index}].dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await js(`window.dragData = new DataTransfer(); document.querySelectorAll('.media-asset')[${index}].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.dragData }))`)
      await js(`(() => { const lane = document.querySelector(${JSON.stringify(selector)}); const r = lane.getBoundingClientRect(); const x = r.left + r.width * ${fraction}; lane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.dragData, clientX: x, clientY: r.top + 10 })); lane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.dragData, clientX: x, clientY: r.top + 10 })) })()`)
    }
    const seek = async fraction => {
      const r = await rect('.timeline-ruler')
      const x = r.x + r.width * fraction, y = r.y + 8
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      await pause(150)
    }
    const mouse = (type, x, y, buttons = 0) => contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
    const key = (k, mods = {}) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(mods)} })); true`)
    const setTextValue = (selector, value, proto = 'HTMLTextAreaElement', event = 'input') => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })) })()`)
    const setTheme = theme => js(`(() => { const select = document.querySelector('.theme-select'); select.value = ${JSON.stringify(theme)}; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)

    await window.loadFile(path.join(root, 'out/renderer/index.html'))
    contents.debugger.attach('1.3')
    await pause(300)

    // Empty state first.
    await shoot('empty.png', null, 1.1)
    await click('.link-box-hint')
    await shoot('link-sites.png', '.link-box', 2)
    await click('.link-box-hint')

    // Load the project and build a two-track edit with audio.
    await click('[aria-label="Import media"]')
    await waitFor(() => js('document.querySelectorAll(".clip-video").length === 1 && document.querySelector("video") && document.querySelector("video").readyState >= 2'), 'main clip did not load')
    await click('[aria-label="Import media"]')
    await waitFor(() => js('document.querySelectorAll(".media-asset").length === 4'), 'pool did not fill')
    await poolDrop(3, '.track-video[data-track="0"]', 0.66)        // cellular → V1 after the first clip
    await poolDrop(2, '.track-audio[data-track="0"]', 0.02)       // ambient pad → A1
    await poolDrop(1, '.track-video[data-track="1"]', 0.12)       // fractal → V2
    await waitFor(() => js(`document.querySelectorAll('.track-video[data-track="1"] .clip-video').length === 1`), 'stack failed')
    await seek(0.3)
    await waitFor(() => js('document.querySelectorAll(".layer:not(.is-full)").length === 1'), 'overlay not visible')
    // A title on T1, so the editor shot shows text over the stack.
    await js('document.activeElement && document.activeElement.blur(); true')
    await key('t')
    await waitFor(() => js('Boolean(document.querySelector(".text-strip-content"))'), 'text clip was not added')
    await setTextValue('.text-strip-content', 'Sunset Drive')
    await setTextValue('.text-strip-font', 'serif', 'HTMLSelectElement', 'change')
    await js(`Array.from(document.querySelectorAll('.text-strip .tool-segment button')).find(b => b.textContent === 'Outline').click()`)
    await js('document.activeElement && document.activeElement.blur(); true')
    await waitFor(() => js('document.querySelectorAll(".layer-text").length === 1'), 'title not drawn')
    // Stretch the title across the first clip.
    const titleClip = await rect('.clip-text .clip-trim.end')
    await mouse('mouseMoved', titleClip.x + 3, titleClip.y + titleClip.height / 2)
    await mouse('mousePressed', titleClip.x + 3, titleClip.y + titleClip.height / 2, 1)
    for (let step = 1; step <= 6; step++) { await mouse('mouseMoved', titleClip.x + 3 + step * 40, titleClip.y + titleClip.height / 2, 1); await pause(16) }
    await mouse('mouseReleased', titleClip.x + 243, titleClip.y + titleClip.height / 2)
    await shoot('text-overlay.png', '.panel-preview', 1.5)
    // Select the stacked clip so the inspector shows its transform.
    await js(`document.querySelector('.layer:not(.is-full)').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
    await waitFor(() => js('document.querySelector(".layer:not(.is-full)").classList.contains("is-selected")'), 'overlay not selected')
    await js(`document.querySelectorAll('.media-asset').forEach(a => a.classList.remove('is-selected'))`)
    await shoot('editor.png', null, 1.1)
    await shoot('timeline-stack.png', '.panel-timeline', 1.5)

    // Snapping: drag the picture-in-picture layer onto the centre lines and photograph the guide mid-drag.
    // Select it first: the selected layer draws above the others.
    await js(`document.querySelector('.layer:not(.is-full)').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })); document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
    await waitFor(() => js('Boolean(document.querySelector(".layer.is-selected:not(.is-full)"))'), 'PiP layer not selected')
    const layer = await rect('.layer.is-selected:not(.is-full)')
    const frame = await rect('.frame-mask')
    const lx = layer.x + layer.width / 2, ly = layer.y + layer.height / 2
    const toX = lx + (frame.x + frame.width / 2 - layer.x) + 3, toY = ly + (frame.y + frame.height / 2 - ly) + 2
    await mouse('mouseMoved', lx, ly)
    await mouse('mousePressed', lx, ly, 1)
    for (let step = 1; step <= 10; step++) { await mouse('mouseMoved', lx + (toX - lx) * step / 10, ly + (toY - ly) * step / 10, 1); await pause(16) }
    await waitFor(() => js('document.querySelectorAll(".canvas-guide").length === 2'), `snap guides did not show: ${JSON.stringify({ layer, frame, to: [toX, toY] })}`)
    await shoot('snap-guides.png', '.video-preview-frame', 1.5)
    await mouse('mouseReleased', toX, toY)
    await key('z', { ctrlKey: true })

    // Inspector: Compression + Export.
    await shoot('inspector.png', '.inspector', 2)
    await js(`document.querySelector('.panel-inspector').scrollTop = 99999`)
    await shoot('inspector-deliver.png', '.panel-inspector', 2)
    await js(`document.querySelector('.panel-inspector').scrollTop = 0`)

    // Link import, mid-download.
    await setInput('.link-box-input', 'https://x.com/nasa/status/1842204331043168516')
    await click('.link-box-add')
    await waitFor(() => js('Boolean(document.querySelector(".link-modal"))'), 'link dialog did not open')
    await shoot('link-choice.png', '.link-modal', 2)
    await js(`document.querySelector('.link-modal button.link-choice').click()`)
    await waitFor(() => js('document.querySelector(".link-box-progress") && document.querySelector(".link-box-progress").textContent.includes("64%")'), 'download progress did not show')
    await shoot('link-import.png', '.panel-media', 2)
    await waitFor(() => typeof releaseDownload === 'function', 'download did not pause')
    releaseDownload(); releaseDownload = null
    await waitFor(() => js('document.querySelectorAll(".clip-video").length === 4 && !document.querySelector(".link-box-progress")'), 'downloaded clip was not added')

    // Quick GIF result.
    await setInput('.link-box-input', 'https://youtu.be/dQw4w9WgXcQ')
    await click('.link-box-gif')
    await waitFor(() => js('document.querySelector(".link-box-progress") && document.querySelector(".link-box-progress").textContent.includes("64%")'), 'second download did not progress')
    await waitFor(() => typeof releaseDownload === 'function', 'download did not pause')
    releaseDownload(); releaseDownload = null
    await waitFor(() => js('Boolean(document.querySelector(".result-panel, .export-result")) || document.body.textContent.includes("_animated.gif")'), 'quick GIF result did not appear')
    await js(`document.querySelector('.panel-inspector').scrollTop = 99999`)
    await shoot('quick-gif.png', '.panel-inspector', 2)
    await js(`document.querySelector('.panel-inspector').scrollTop = 0`)

    // Themes.
    for (const theme of ['mint', 'rose', 'mist', 'linen']) {
      await setTheme(theme)
      await shoot(`theme-${theme}.png`, null, 0.5)
    }
    await setTheme('cloud')

    // Settings: where everything is stored.
    await click('[aria-label="Settings"]')
    await js(`Array.from(document.querySelectorAll('.settings-tabs button')).find(b => b.textContent === 'Storage').click()`)
    await waitFor(() => js('document.querySelectorAll(".storage-row").length === 4'), 'storage list did not load')
    await shoot('settings-storage.png', '.storage-list', 2)
    await js(`Array.from(document.querySelectorAll('.settings-tabs button')).find(b => b.textContent === 'General').click()`)
    contents.send('update:status', { state: 'available', mode: 'auto', current: version, version: nextVersion })
    await waitFor(() => js('Boolean(document.querySelector(".update-field .btn-primary"))'), 'update section did not show the new version')
    await shoot('settings-updates.png', '.settings-window', 2)
    await click('[aria-label="Close settings"]')

    console.log(`SCREENSHOTS OK → ${outDir}`)
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (window) fs.writeFileSync(path.join(root, 'out/screenshot-failure.png'), (await window.webContents.capturePage()).toPNG())
    window?.destroy()
    app.exit(1)
  }
})
