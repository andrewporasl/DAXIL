
export const MIN_ZOOM = 1

// Deep enough to reach single frames on long sources without creating absurd layout widths.
export function maxZoom(span: number): number {
  return Math.max(8, Math.min(2000, span * 2))
}

export function clampZoom(zoom: number, span: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.max(MIN_ZOOM, Math.min(maxZoom(span), zoom))
}

// Wheel deltas arrive in pixels, lines or pages; normalise so trackpads and mice feel the same.
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.002)
}

// After the strip is re-laid out, scroll so `time` lands back under `anchorClientX`.
export function anchoredScrollLeft(scrollLeft: number, stripLeft: number, stripWidth: number, span: number, time: number, anchorClientX: number): number {
  if (span <= 0 || stripWidth <= 0) return scrollLeft
  return Math.max(0, scrollLeft + stripLeft + time / span * stripWidth - anchorClientX)
}

const RULER_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

export function rulerStep(pixelsPerSecond: number, minSpacing = 72): number {
  return RULER_STEPS.find(step => step * pixelsPerSecond >= minSpacing) ?? RULER_STEPS[RULER_STEPS.length - 1]
}

export function formatRulerTime(seconds: number, step: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  const secondsText = step < 1 ? rest.toFixed(step < 0.5 ? 2 : 1).padStart(step < 0.5 ? 5 : 4, '0') : String(Math.round(rest)).padStart(2, '0')
  return `${minutes}:${secondsText}`
}

export const MEDIA_MIME = 'application/x-daxil-media'
export const MEDIA_EXTENSIONS = /\.(mp4|mov|mkv|avi|webm|m4v|mp3|wav|aac|m4a|ogg|flac)$/i

// Media drags carry either a single id (older drags) or a JSON list of ids.
export function parseMediaIds(data: string): string[] {
  if (!data) return []
  try {
    const parsed = JSON.parse(data)
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
  } catch { /* plain id */ }
  return [data]
}

export function rectsIntersect(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
