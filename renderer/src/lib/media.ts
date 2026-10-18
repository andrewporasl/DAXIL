import type { MediaAsset } from '../../../shared/types'

export const assetName = (asset: MediaAsset | undefined, fallback = ''): string => asset ? (asset.name?.trim() || asset.metadata.fileName) : fallback

export const sanitizeName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

// Whether Chromium's <video> can actually show this file. Some sources FFmpeg reads fine (iPhone
// HEVC/HDR, ProRes, Motion JPEG) fail here or load as sound only; those get a preview copy instead.
export function canPreviewVideo(filePath: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    const done = (ok: boolean) => { clearTimeout(timer); video.removeAttribute('src'); video.load(); resolve(ok) }
    const timer = setTimeout(() => done(false), timeoutMs)
    video.onloadeddata = () => done(video.videoWidth > 0)
    video.onerror = () => done(false)
    video.src = `safe-file://video?path=${encodeURIComponent(filePath)}`
  })
}
