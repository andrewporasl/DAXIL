import React, { useRef, useState, useEffect, useCallback } from 'react'
import { formatDuration } from '../lib/sizeEstimator'

interface Props {
  filePath: string | null
  duration: number
  thumbnails: string[]
  start: number
  end: number
  currentTime: number
  onTimeUpdate: (t: number) => void
  onTrimChange: (start: number, end: number) => void
}

type DragTarget = 'start' | 'end' | null

const STRIP_HEIGHT = 68
const RAIL_HEIGHT = 16
const HANDLE_W = 6

export default function VideoTimeline({
  filePath,
  duration,
  thumbnails,
  start,
  end,
  currentTime,
  onTimeUpdate,
  onTrimChange
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragTarget>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

  const posFromClientX = useCallback((clientX: number, rect: DOMRect): number => {
    if (duration <= 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }, [duration])

  const setVideoTime = useCallback((time: number) => {
    const next = clamp(time, 0, duration || 0)
    if (videoRef.current) videoRef.current.currentTime = next
    onTimeUpdate(next)
  }, [duration, onTimeUpdate])

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      if (currentTime < start || currentTime > end) setVideoTime(start)
      try {
        await video.play()
      } catch {
        // no-op
      }
    } else {
      video.pause()
    }
  }, [currentTime, end, setVideoTime, start])

  const seekBy = useCallback((delta: number) => {
    setVideoTime(currentTime + delta)
  }, [currentTime, setVideoTime])

  useEffect(() => {
    if (!dragging) return

    const onMove = (event: MouseEvent) => {
      const rect = stripRef.current?.getBoundingClientRect()
      if (!rect) return

      const time = posFromClientX(event.clientX, rect)
      let nextStart = start
      let nextEnd = end

      if (dragging === 'start') nextStart = clamp(time, 0, end - 0.1)
      else nextEnd = clamp(time, start + 0.1, duration)

      onTrimChange(nextStart, nextEnd)
      setVideoTime(dragging === 'start' ? nextStart : nextEnd)
    }

    const onUp = () => setDragging(null)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, duration, end, onTrimChange, posFromClientX, setVideoTime, start])

  useEffect(() => {
    if (!isPlaying || duration <= 0) return
    if (currentTime >= end && end < duration - 0.05) {
      videoRef.current?.pause()
      setIsPlaying(false)
      setVideoTime(end)
    }
  }, [currentTime, duration, end, isPlaying, setVideoTime])

  const handlePreviewScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setVideoTime(posFromClientX(event.clientX, rect))
  }

  const handleStripClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (dragging) return
    const rect = event.currentTarget.getBoundingClientRect()
    setVideoTime(posFromClientX(event.clientX, rect))
  }

  const src = filePath ? `safe-file://video?path=${encodeURIComponent(filePath)}` : null
  const startPct = duration > 0 ? (start / duration) * 100 : 0
  const endPct = duration > 0 ? (end / duration) * 100 : 100
  const playPct = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0
  const selectionPct = Math.max(endPct - startPct, 0)

  if (!src) {
    return (
      <div className="card" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No preview loaded</div>
          <div className="surface-note">Choose a file to open the video and timeline.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="badge badge-accent">In {formatDuration(start)}</div>
          <div className="badge badge-accent">Out {formatDuration(end)}</div>
          <div className="badge">Playhead {formatDuration(currentTime)}</div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={() => onTrimChange(currentTime, end)}>Set In</button>
          <button className="btn-ghost" onClick={() => onTrimChange(start, currentTime)}>Set Out</button>
          <button className="btn-ghost" onClick={() => onTrimChange(0, duration)}>Reset</button>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: '#0a0c12',
          overflow: 'hidden'
        }}
      >
        <video
          key={src}
          ref={videoRef}
          src={src}
          playsInline
          preload="metadata"
          onClick={togglePlayback}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(event) => onTimeUpdate((event.target as HTMLVideoElement).currentTime)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            cursor: 'pointer'
          }}
        />

        {!isPlaying && (
          <button
            className="btn-ghost"
            onClick={togglePlayback}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(23, 27, 36, 0.9)'
            }}
          >
            {currentTime > 0 ? 'Resume' : 'Play'}
          </button>
        )}
      </div>

      <div className="transport-row">
        <div className="transport-group">
          <button className="transport-button primary" onClick={togglePlayback}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button className="transport-button" onClick={() => seekBy(-5)}>-5s</button>
          <button className="transport-button" onClick={() => seekBy(5)}>+5s</button>
        </div>

        <div
          onClick={handlePreviewScrub}
          style={{
            flex: 1,
            height: 10,
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: 'var(--panel-3)',
            overflow: 'hidden',
            cursor: 'pointer'
          }}
        >
          <div style={{ width: `${playPct}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
        </div>

        <div style={{ minWidth: 92, textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>

      <div
        ref={stripRef}
        onClick={handleStripClick}
        style={{
          position: 'relative',
          height: STRIP_HEIGHT,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--panel-2)',
          overflow: 'hidden',
          cursor: 'pointer'
        }}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: STRIP_HEIGHT - RAIL_HEIGHT, display: 'flex', overflow: 'hidden' }}>
          {thumbnails.length > 0 ? thumbnails.map((thumb, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                backgroundImage: thumb ? `url(${thumb})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRight: index === thumbnails.length - 1 ? 'none' : '1px solid rgba(60, 70, 95, 0.4)'
              }}
            />
          )) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
              Building timeline...
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: RAIL_HEIGHT, background: 'var(--panel-3)', borderTop: '1px solid var(--border)' }} />
        <div style={{ position: 'absolute', left: 0, width: `${startPct}%`, top: 0, bottom: 0, background: 'rgba(16, 19, 26, 0.46)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: `${endPct}%`, right: 0, top: 0, bottom: 0, background: 'rgba(16, 19, 26, 0.46)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: `${startPct}%`, width: `${selectionPct}%`, bottom: 0, height: RAIL_HEIGHT, background: 'var(--accent-dim)', borderTop: '1px solid var(--accent-border)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: `${playPct}%`, top: 0, bottom: 0, width: 2, background: 'var(--text)', transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 4 }} />

        <div
          onMouseDown={(event) => {
            event.stopPropagation()
            setDragging('start')
          }}
          style={{
            position: 'absolute',
            left: `${startPct}%`,
            bottom: 0,
            width: HANDLE_W + 12,
            height: RAIL_HEIGHT + 14,
            transform: 'translateX(-50%)',
            cursor: 'ew-resize',
            zIndex: 6
          }}
        >
          <div style={{ position: 'absolute', left: '50%', top: 6, bottom: 0, width: HANDLE_W, transform: 'translateX(-50%)', borderRadius: 999, background: 'var(--accent)' }} />
        </div>

        <div
          onMouseDown={(event) => {
            event.stopPropagation()
            setDragging('end')
          }}
          style={{
            position: 'absolute',
            left: `${endPct}%`,
            bottom: 0,
            width: HANDLE_W + 12,
            height: RAIL_HEIGHT + 14,
            transform: 'translateX(-50%)',
            cursor: 'ew-resize',
            zIndex: 6
          }}
        >
          <div style={{ position: 'absolute', left: '50%', top: 6, bottom: 0, width: HANDLE_W, transform: 'translateX(-50%)', borderRadius: 999, background: 'var(--accent)' }} />
        </div>
      </div>
    </div>
  )
}
