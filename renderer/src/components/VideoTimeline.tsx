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

const STRIP_HEIGHT = 60
const HANDLE_W = 4

export default function VideoTimeline({
  filePath, duration, thumbnails, start, end, currentTime, onTimeUpdate, onTrimChange
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<DragTarget>(null)

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  const posFromClientX = useCallback((clientX: number): number => {
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return clamp((clientX - rect.left) / rect.width * duration, 0, duration)
  }, [duration])

  // Drag handlers
  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent) => {
      const t = posFromClientX(e.clientX)
      let newStart = start
      let newEnd = end

      if (dragging === 'start') {
        newStart = clamp(t, 0, end - 0.1)
      } else {
        newEnd = clamp(t, start + 0.1, duration)
      }

      onTrimChange(newStart, newEnd)

      // Seek video to show the frame at the handle position
      if (videoRef.current) {
        videoRef.current.currentTime = dragging === 'start' ? newStart : newEnd
      }
    }

    const onUp = () => setDragging(null)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, start, end, duration, posFromClientX, onTrimChange])

  const handleStripClick = (e: React.MouseEvent) => {
    if (dragging) return
    const t = posFromClientX(e.clientX)
    const distStart = Math.abs(t - start)
    const distEnd = Math.abs(t - end)
    if (distStart <= distEnd) {
      onTrimChange(clamp(t, 0, end - 0.1), end)
    } else {
      onTrimChange(start, clamp(t, start + 0.1, duration))
    }
    if (videoRef.current) videoRef.current.currentTime = t
  }

  const src = filePath ? `safe-file:///${filePath.replace(/\\/g, '/')}` : null

  const startPct = duration > 0 ? (start / duration) * 100 : 0
  const endPct = duration > 0 ? (end / duration) * 100 : 100
  const playPct = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0

  const isFullRange = start <= 0.05 && end >= duration - 0.05

  return (
    <div style={{
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: '#000',
      userSelect: 'none'
    }}>
      {/* Video */}
      {!src ? (
        <div style={{
          aspectRatio: '16/9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          fontSize: 13,
          background: 'var(--surface)'
        }}>
          Select a video to preview
        </div>
      ) : (
        <video
          ref={videoRef}
          src={src}
          controls
          onTimeUpdate={(e) => onTimeUpdate((e.target as HTMLVideoElement).currentTime)}
          style={{
            width: '100%',
            aspectRatio: '16/9',
            display: 'block',
            background: '#000',
            borderRadius: 0
          }}
        />
      )}

      {/* Timeline strip */}
      {src && duration > 0 && (
        <div
          ref={stripRef}
          onClick={handleStripClick}
          style={{
            position: 'relative',
            height: STRIP_HEIGHT,
            background: '#080808',
            borderTop: '1px solid #1a1a1a',
            cursor: 'pointer',
            overflow: 'hidden'
          }}
        >
          {/* Thumbnail strip */}
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            overflow: 'hidden'
          }}>
            {thumbnails.length > 0
              ? thumbnails.map((thumb, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    flexShrink: 0,
                    backgroundImage: thumb ? `url(${thumb})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    background: thumb ? undefined : 'var(--surface2)'
                  }}
                />
              ))
              : (
                <div style={{
                  flex: 1,
                  background: 'var(--surface2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading previews...</span>
                </div>
              )
            }
          </div>

          {/* Dim outside selection — left */}
          <div style={{
            position: 'absolute',
            left: 0,
            width: `${startPct}%`,
            top: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.65)',
            pointerEvents: 'none'
          }} />

          {/* Dim outside selection — right */}
          <div style={{
            position: 'absolute',
            left: `${endPct}%`,
            right: 0,
            top: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.65)',
            pointerEvents: 'none'
          }} />

          {/* Selection top/bottom border */}
          {!isFullRange && (
            <div style={{
              position: 'absolute',
              left: `${startPct}%`,
              width: `${endPct - startPct}%`,
              top: 0,
              bottom: 0,
              borderTop: `2px solid var(--accent)`,
              borderBottom: `2px solid var(--accent)`,
              pointerEvents: 'none'
            }} />
          )}

          {/* Playhead */}
          <div style={{
            position: 'absolute',
            left: `${playPct}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#fff',
            opacity: 0.8,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 4
          }} />

          {/* Start handle — bracket shape */}
          <div
            onMouseDown={(e) => { e.stopPropagation(); setDragging('start') }}
            style={{
              position: 'absolute',
              left: `${startPct}%`,
              top: 0,
              bottom: 0,
              width: HANDLE_W + 6,
              transform: 'translateX(-50%)',
              cursor: 'ew-resize',
              zIndex: 5,
              display: 'flex',
              alignItems: 'stretch'
            }}
          >
            {/* Vertical bar */}
            <div style={{
              width: HANDLE_W,
              background: 'var(--accent)',
              borderRadius: '2px 0 0 2px',
              position: 'relative'
            }}>
              {/* Top cap */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 10,
                height: HANDLE_W,
                background: 'var(--accent)',
                borderRadius: '2px 2px 0 0'
              }} />
              {/* Bottom cap */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: 10,
                height: HANDLE_W,
                background: 'var(--accent)',
                borderRadius: '0 0 2px 2px'
              }} />
            </div>
          </div>

          {/* End handle — bracket shape */}
          <div
            onMouseDown={(e) => { e.stopPropagation(); setDragging('end') }}
            style={{
              position: 'absolute',
              left: `${endPct}%`,
              top: 0,
              bottom: 0,
              width: HANDLE_W + 6,
              transform: 'translateX(-50%)',
              cursor: 'ew-resize',
              zIndex: 5,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'flex-end'
            }}
          >
            <div style={{
              width: HANDLE_W,
              background: 'var(--accent)',
              borderRadius: '0 2px 2px 0',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 10,
                height: HANDLE_W,
                background: 'var(--accent)',
                borderRadius: '2px 2px 0 0'
              }} />
              <div style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 10,
                height: HANDLE_W,
                background: 'var(--accent)',
                borderRadius: '0 0 2px 2px'
              }} />
            </div>
          </div>

          {/* Time labels */}
          <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, pointerEvents: 'none', zIndex: 3 }}>
            <span style={{
              position: 'absolute',
              left: `${startPct}%`,
              transform: 'translateX(6px)',
              fontSize: 10,
              color: 'rgba(255,255,255,0.8)',
              fontVariantNumeric: 'tabular-nums',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              whiteSpace: 'nowrap'
            }}>
              {formatDuration(start)}
            </span>
            <span style={{
              position: 'absolute',
              left: `${endPct}%`,
              transform: 'translateX(calc(-100% - 6px))',
              fontSize: 10,
              color: 'rgba(255,255,255,0.8)',
              fontVariantNumeric: 'tabular-nums',
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              whiteSpace: 'nowrap'
            }}>
              {formatDuration(end)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
