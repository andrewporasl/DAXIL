import type { Clip, TextStyle } from '../../../shared/types'

// System font stacks that exist on Windows and macOS, with fallbacks for Linux.
export const TEXT_FONTS: Array<{ id: string; label: string; family: string }> = [
  { id: 'sans', label: 'Sans', family: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif' },
  { id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", Times, "Liberation Serif", serif' },
  { id: 'mono', label: 'Mono', family: '"Courier New", Courier, "Liberation Mono", monospace' },
  { id: 'impact', label: 'Impact', family: 'Impact, Haettenschweiler, "Arial Black", sans-serif' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet', family: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: 'script', label: 'Script', family: '"Segoe Script", "Brush Script MT", "Apple Chancery", cursive' },
  { id: 'comic', label: 'Comic', family: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive' }
]

export const fontFamily = (id: string): string => (TEXT_FONTS.find(font => font.id === id) ?? TEXT_FONTS[0]).family
export const fontString = (style: TextStyle, px: number): string => `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px}px ${fontFamily(style.font)}`

export interface TextLayout { lines: string[]; widths: number[]; px: number; lineHeight: number; pad: number; left: number; top: number; width: number; height: number }

// Everything scales with the frame height, so the preview (drawn at display size) and the
// export (drawn at project size) lay out the same way.
export function layoutText(ctx: CanvasRenderingContext2D, clip: Clip, frameWidth: number, frameHeight: number): TextLayout | null {
  const style = clip.text
  if (!style) return null
  const px = Math.max(1, style.size * frameHeight)
  ctx.font = fontString(style, px)
  const lines = (style.content || ' ').split('\n')
  const widths = lines.map(line => ctx.measureText(line).width)
  const lineHeight = px * 1.2
  const pad = style.effect === 'box' ? px * 0.35 : 0
  const width = Math.max(...widths) + pad * 2
  const height = lines.length * lineHeight + pad * 2
  return { lines, widths, px, lineHeight, pad, width, height, left: clip.x * frameWidth - width / 2, top: clip.y * frameHeight - height / 2 }
}

export function drawText(ctx: CanvasRenderingContext2D, clip: Clip, frameWidth: number, frameHeight: number): TextLayout | null {
  const layout = layoutText(ctx, clip, frameWidth, frameHeight)
  const style = clip.text
  if (!layout || !style) return null
  const { lines, widths, px, lineHeight, pad, left, top, width, height } = layout
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, clip.opacity))
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  if (style.effect === 'box') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.beginPath()
    ctx.roundRect(left, top, width, height, px * 0.18)
    ctx.fill()
  }
  if (style.effect === 'shadow') {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = px * 0.18
    ctx.shadowOffsetY = px * 0.05
  }
  const inner = width - pad * 2
  lines.forEach((line, index) => {
    const x = left + pad + (style.align === 'left' ? 0 : style.align === 'right' ? inner - widths[index] : (inner - widths[index]) / 2)
    const y = top + pad + lineHeight * (index + 0.5)
    if (style.effect === 'outline') {
      ctx.lineJoin = 'round'
      ctx.lineWidth = px * 0.14
      ctx.strokeStyle = isLight(style.color) ? '#000000' : '#ffffff'
      ctx.strokeText(line, x, y)
    }
    ctx.fillStyle = style.color
    ctx.fillText(line, x, y)
  })
  ctx.restore()
  return layout
}

function isLight(hex: string): boolean {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!value) return true
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16))
  return r * 0.299 + g * 0.587 + b * 0.114 > 140
}

// One transparent, full-frame PNG per text clip, which FFmpeg overlays during export.
export async function renderTextImages(clips: Clip[], frameWidth: number, frameHeight: number): Promise<Record<string, string>> {
  const images: Record<string, string> = {}
  for (const clip of clips) {
    if (clip.kind !== 'text' || !clip.text) continue
    await document.fonts.load(fontString(clip.text, 32)).catch(() => [])
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    drawText(ctx, clip, frameWidth, frameHeight)
    images[clip.id] = canvas.toDataURL('image/png')
  }
  return images
}
