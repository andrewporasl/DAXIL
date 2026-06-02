import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const resourcesDir = path.join(projectRoot, 'resources')
const iconsetDir = path.join(resourcesDir, 'icon.iconset')

const BG = [0, 0, 0, 0]
const PANEL = [23, 27, 36, 255]
const PANEL_EDGE = [44, 52, 71, 255]
const CUTOUT = [23, 27, 36, 255]
const G1 = [143, 167, 255, 255]
const G2 = [240, 182, 214, 255]

const ICONSET_PNGS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

const ICO_SIZES = [16, 32, 48, 64, 128, 256]

function lerp(a, b, t) {
  return a + (b - a) * t
}

function mixColor(c1, c2, t, alpha = 1) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(255 * alpha)
  ]
}

function createCanvas(size) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4
    pixels[offset] = BG[0]
    pixels[offset + 1] = BG[1]
    pixels[offset + 2] = BG[2]
    pixels[offset + 3] = BG[3]
  }
  return pixels
}

function isInsideRoundedRect(px, py, x, y, width, height, radius) {
  const cx = x + width / 2
  const cy = y + height / 2
  const qx = Math.max(Math.abs(px - cx) - width / 2 + radius, 0)
  const qy = Math.max(Math.abs(py - cy) - height / 2 + radius, 0)
  return (qx * qx) + (qy * qy) <= radius * radius
}

function blendPixel(pixels, size, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const offset = (y * size + x) * 4
  const srcA = (color[3] / 255) * alpha
  const dstA = pixels[offset + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return

  pixels[offset] = Math.round((color[0] * srcA + pixels[offset] * dstA * (1 - srcA)) / outA)
  pixels[offset + 1] = Math.round((color[1] * srcA + pixels[offset + 1] * dstA * (1 - srcA)) / outA)
  pixels[offset + 2] = Math.round((color[2] * srcA + pixels[offset + 2] * dstA * (1 - srcA)) / outA)
  pixels[offset + 3] = Math.round(outA * 255)
}

function drawRoundedRect(pixels, size, x, y, width, height, radius, colorForPoint) {
  const startX = Math.max(0, Math.floor(x - 2))
  const endX = Math.min(size - 1, Math.ceil(x + width + 2))
  const startY = Math.max(0, Math.floor(y - 2))
  const endY = Math.min(size - 1, Math.ceil(y + height + 2))
  const samples = [0.2, 0.5, 0.8]

  for (let py = startY; py <= endY; py += 1) {
    for (let px = startX; px <= endX; px += 1) {
      let coverage = 0
      for (const sy of samples) {
        for (const sx of samples) {
          if (isInsideRoundedRect(px + sx, py + sy, x, y, width, height, radius)) {
            coverage += 1
          }
        }
      }

      if (coverage === 0) continue
      const alpha = coverage / (samples.length * samples.length)
      const localX = (px + 0.5 - x) / width
      const localY = (py + 0.5 - y) / height
      const color = colorForPoint(localX, localY)
      blendPixel(pixels, size, px, py, color, alpha)
    }
  }
}

function renderIcon(size) {
  const pixels = createCanvas(size)

  const outerInset = size * 0.07
  const outerSize = size - outerInset * 2
  const outerRadius = size * 0.22

  drawRoundedRect(
    pixels,
    size,
    outerInset,
    outerInset,
    outerSize,
    outerSize,
    outerRadius,
    () => PANEL_EDGE
  )

  const borderInset = outerInset + Math.max(2, size * 0.008)
  drawRoundedRect(
    pixels,
    size,
    borderInset,
    borderInset,
    size - borderInset * 2,
    size - borderInset * 2,
    outerRadius - Math.max(2, size * 0.008),
    () => PANEL
  )

  const markSize = size * 0.43
  const markX = (size - markSize) / 2
  const markY = (size - markSize) / 2
  const markRadius = markSize * 0.24

  drawRoundedRect(
    pixels,
    size,
    markX,
    markY,
    markSize,
    markSize,
    markRadius,
    (lx, ly) => mixColor(G1, G2, Math.max(0, Math.min(1, (lx * 0.65) + (ly * 0.35)))))

  const cutoutWidth = markSize * 0.28
  const cutoutHeight = markSize * 0.54
  const cutoutX = markX + markSize * 0.42
  const cutoutY = markY + markSize * 0.23
  const cutoutRadius = markSize * 0.15

  drawRoundedRect(
    pixels,
    size,
    cutoutX,
    cutoutY,
    cutoutWidth,
    cutoutHeight,
    cutoutRadius,
    () => CUTOUT
  )

  return pixels
}

function createChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const name = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, crc])
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function encodePng(size, pixels) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (stride + 1)
    raw[rowOffset] = 0
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, rowOffset + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const compressed = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([
    header,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', Buffer.alloc(0))
  ])
}

function writePng(filePath, size) {
  const pixels = renderIcon(size)
  fs.writeFileSync(filePath, encodePng(size, pixels))
}

function writeIco(filePath, sizes) {
  const images = sizes.map((size) => ({
    size,
    buffer: encodePng(size, renderIcon(size))
  }))

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + images.length * 16

  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry[0] = image.size === 256 ? 0 : image.size
    entry[1] = image.size === 256 ? 0 : image.size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.buffer.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.buffer.length
    entries.push(entry)
  }

  fs.writeFileSync(filePath, Buffer.concat([header, ...entries, ...images.map((image) => image.buffer)]))
}

function generateIcns() {
  if (process.platform !== 'darwin') return

  fs.rmSync(iconsetDir, { recursive: true, force: true })
  fs.mkdirSync(iconsetDir, { recursive: true })

  for (const [name, size] of ICONSET_PNGS) {
    writePng(path.join(iconsetDir, name), size)
  }

  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(resourcesDir, 'icon.icns')], {
    stdio: 'inherit'
  })

  fs.rmSync(iconsetDir, { recursive: true, force: true })
}

fs.mkdirSync(resourcesDir, { recursive: true })
writePng(path.join(resourcesDir, 'icon.png'), 1024)
writeIco(path.join(resourcesDir, 'icon.ico'), ICO_SIZES)
generateIcns()

console.log('Release icons generated in resources/')
