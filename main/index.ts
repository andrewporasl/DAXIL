import { app, BrowserWindow, protocol } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { registerIpcHandlers } from './ipc'

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.ts': 'video/mp2t',
    '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.wav': 'audio/wav'
  }
  return map[ext] ?? 'application/octet-stream'
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'safe-file', privileges: { secure: true, standard: true, stream: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'DAXIL',
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setMenuBarVisibility(false)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('safe-file', async (request) => {
    try {
      const rawUrl = request.url.replace(/^safe-file:\/\/\//, '').split('?')[0]
      const filePath = decodeURIComponent(rawUrl)
      const stat = fs.statSync(filePath)
      const total = stat.size
      const mimeType = getMimeType(filePath)
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : total - 1
          const chunkSize = end - start + 1
          const nodeStream = fs.createReadStream(filePath, { start, end })
          const webStream = new ReadableStream({
            start(controller) {
              nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
              nodeStream.on('end', () => controller.close())
              nodeStream.on('error', (err) => controller.error(err))
            },
            cancel() { nodeStream.destroy() }
          })
          return new Response(webStream, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
              'Content-Type': mimeType
            }
          })
        }
      }

      const nodeStream = fs.createReadStream(filePath)
      const webStream = new ReadableStream({
        start(controller) {
          nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
          nodeStream.on('end', () => controller.close())
          nodeStream.on('error', (err) => controller.error(err))
        },
        cancel() { nodeStream.destroy() }
      })
      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
          'Content-Type': mimeType
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
