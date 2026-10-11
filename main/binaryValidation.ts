import { spawn } from 'child_process'
import * as path from 'path'

export function packagedBinaryPath(appPath: string, binaryPath: string): string {
  const marker = `${path.sep}node_modules${path.sep}`
  const index = binaryPath.lastIndexOf(marker)
  return index >= 0
    ? path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules', binaryPath.slice(index + marker.length))
    : binaryPath
}

export function validateBinary(binaryPath: string, kind: 'ffmpeg' | 'ffprobe'): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, ['-version'], { windowsHide: true })
    let output = ''
    proc.stdout.on('data', data => { output += String(data).slice(0, 256) })
    proc.on('error', error => reject(new Error(`${kind} could not start at "${binaryPath}": ${error.message}. Install FFmpeg and add it to PATH, or set the ${kind} executable path in Settings.`)))
    proc.on('close', code => {
      if (code === 0 && output.toLowerCase().includes(kind + ' version')) resolve()
      else reject(new Error(`${kind} at "${binaryPath}" is not a working ${kind} executable. Check the path in Settings or install FFmpeg.`))
    })
  })
}
