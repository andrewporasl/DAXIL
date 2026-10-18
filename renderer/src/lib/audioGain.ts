// Media elements can't play louder than 100 %, so preview sound goes through a Web Audio gain
// stage, letting clip boosts up to +12 dB be heard live, as they will be in the export.
// Elements must load with crossOrigin="anonymous" (the safe-file protocol answers with CORS
// headers); otherwise the browser would route them as silence.
let context: AudioContext | null = null
const gains = new WeakMap<HTMLMediaElement, GainNode>()

function gainFor(element: HTMLMediaElement): GainNode | null {
  const existing = gains.get(element)
  if (existing) return existing
  try {
    context ??= new AudioContext()
    const node = context.createGain()
    context.createMediaElementSource(element).connect(node).connect(context.destination)
    gains.set(element, node)
    return node
  } catch { return null }
}

// Set a clip's playback gain (1 = unchanged). Elements are only routed through Web Audio once a
// boost is needed; after that they stay routed, since an element can only be connected once.
export function setPreviewGain(element: HTMLMediaElement, gain: number): void {
  const level = Number.isFinite(gain) ? Math.max(0, gain) : 1
  const node = level > 1 || gains.has(element) ? gainFor(element) : null
  if (!node) { element.volume = Math.min(1, level); return }
  element.volume = 1
  node.gain.value = level
  element.dataset.gain = level.toFixed(3)
  if (context?.state === 'suspended' && !element.paused) void context.resume()
}

// Playback starts from a user gesture, which is when a suspended context may resume.
export function resumePreviewAudio(): void {
  if (context?.state === 'suspended') void context.resume()
}
