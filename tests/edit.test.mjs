import test from 'node:test'
import assert from 'node:assert/strict'
import { clipEnd, clipLength, sourceTimeAt, clipsAt, freeTrack, snapToCanvas, insertAssets, pasteClips, sourceDuration, textClip, TEXT_SOURCE_SECONDS, moveClips, primaryClipAt, removeMedia, selectClips, snapTargets, snapTime, splitAt, timelineEnd, trackCount, trimEdge, updateClipRange } from '../renderer/src/lib/edit.ts'
import { isNewerVersion } from '../shared/version.ts'
import { dbToGain, gainToDb } from '../shared/exportPlan.ts'
import { anchoredScrollLeft, clampZoom, formatRulerTime, parseMediaIds, rulerStep, wheelZoomFactor } from '../renderer/src/lib/timeline.ts'

const clip = (over = {}) => ({ id: 'c', mediaId: 'a', kind: 'video', track: 0, timelineStart: 0, startSeconds: 0, endSeconds: 4, x: 0, y: 0, scale: 1, opacity: 1, volume: 1, muted: false, ...over })

test('split cuts clips under the playhead and keeps source continuity', () => {
  let n = 0
  const clips = [clip({ id: 'a' }), clip({ id: 'b', track: 1, timelineStart: 1, startSeconds: 2, endSeconds: 6 }), clip({ id: 'far', timelineStart: 10 })]
  const all = splitAt(clips, 2, null, () => `n${++n}`)
  assert.deepEqual(all.map(c => [c.id, c.track, c.timelineStart, c.startSeconds, c.endSeconds]), [
    ['a', 0, 0, 0, 2], ['n1', 0, 2, 2, 4],
    ['b', 1, 1, 2, 3], ['n2', 1, 2, 3, 6],
    ['far', 0, 10, 0, 4]
  ])
  const only = splitAt(clips, 2, ['b'], () => 'x')
  assert.equal(only.length, 4)
  assert.ok(only.some(c => c.id === 'a' && c.endSeconds === 4), 'unselected clips are left alone')
  assert.strictEqual(splitAt(clips, 0.05, null, () => 'x'), clips, 'too close to an edge is a no-op')
  assert.strictEqual(splitAt(clips, 7, null, () => 'x'), clips, 'nothing under the playhead')
})

test('trimming the start keeps the out point where it is on the timeline', () => {
  const c = clip({ timelineStart: 5, startSeconds: 2, endSeconds: 6 })
  const start = trimEdge(c, 'start', 3, 8)
  assert.deepEqual([start.timelineStart, start.startSeconds, start.endSeconds], [6, 3, 6])
  assert.equal(trimEdge(c, 'start', -5, 8).startSeconds, 0)
  assert.equal(trimEdge(c, 'start', -5, 8).timelineStart, 3)
  assert.equal(trimEdge(c, 'end', 99, 8).endSeconds, 8)
  assert.ok(trimEdge(c, 'start', 9, 8).startSeconds <= 5.9)
  assert.equal(trimEdge(c, 'start', 2.123, 8, 25).startSeconds, 2.12)
  assert.strictEqual(trimEdge(c, 'end', NaN, 8), c)
  const ranged = updateClipRange([c], c.id, 3, 5, 8)
  assert.deepEqual([ranged[0].timelineStart, ranged[0].startSeconds, ranged[0].endSeconds], [6, 3, 5])
  const same = [c]
  assert.strictEqual(updateClipRange(same, c.id, 2, 6, 8), same, 'unchanged range creates no edit')
  assert.strictEqual(updateClipRange(same, c.id, 6, 2, 8), same, 'inverted ranges are rejected')
})

test('moving groups preserves offsets and clamps at the first track and time zero', () => {
  const clips = [clip({ id: 'a', timelineStart: 1 }), clip({ id: 'b', track: 1, timelineStart: 3 }), clip({ id: 'c', timelineStart: 9 })]
  const moved = moveClips(clips, ['a', 'b'], 2, 1)
  assert.deepEqual(moved.map(c => [c.id, c.track, c.timelineStart]), [['a', 1, 3], ['b', 2, 5], ['c', 0, 9]])
  const clamped = moveClips(clips, ['a', 'b'], -5, -3)
  assert.deepEqual(clamped.map(c => [c.id, c.track, c.timelineStart]), [['a', 0, 0], ['b', 1, 2], ['c', 0, 9]], 'the earliest clip stops at 0 and the lowest at track 0')
  assert.strictEqual(moveClips(clips, ['zzz'], 1, 0), clips)
  assert.strictEqual(moveClips(clips, ['a'], 0, 0), clips)
})

test('snapping finds the nearest edge or playhead within tolerance', () => {
  const clips = [clip({ id: 'a', timelineStart: 1 }), clip({ id: 'b', timelineStart: 7, endSeconds: 2 })]
  const targets = snapTargets(clips, ['b'], 4.25)
  assert.deepEqual(targets.sort((x, y) => x - y), [0, 1, 4.25, 5])
  assert.deepEqual(snapTime(5.1, targets, 0.2), { time: 5, snapped: 5 })
  assert.deepEqual(snapTime(6, targets, 0.2), { time: 6, snapped: null })
  assert.deepEqual(snapTime(4.2, targets, 0.2), { time: 4.25, snapped: 4.25 }, 'the playhead counts as a target')
})

test('selection, lookup and track counting', () => {
  const clips = [clip({ id: 'a', timelineStart: 0 }), clip({ id: 'b', timelineStart: 5 }), clip({ id: 'c', timelineStart: 10 }), clip({ id: 'top', track: 2, timelineStart: 0 }), clip({ id: 'm', kind: 'audio', timelineStart: 2 })]
  assert.deepEqual(selectClips(clips, ['a'], 'c', 'range', 'a'), ['a', 'b', 'c'])
  assert.deepEqual(selectClips(clips, ['a'], 'top', 'range', 'a'), ['top'], 'ranges stay on one track')
  assert.deepEqual(selectClips(clips, ['a', 'b'], 'a', 'toggle', 'a'), ['b'])
  assert.deepEqual(selectClips(clips, ['a'], 'm', 'add', 'a'), ['a', 'm'])
  assert.deepEqual(clipsAt(clips, 2).map(c => c.id), ['a', 'top', 'm'])
  assert.equal(primaryClipAt(clips, 2).id, 'a')
  assert.equal(trackCount(clips, 'video'), 4, 'three used tracks plus one spare')
  assert.equal(trackCount(clips, 'audio'), 2)
  assert.equal(trackCount([], 'audio'), 1)
  assert.equal(timelineEnd(clips), 14)
})

test('inserting assets lays them back to back on the right kind of track', () => {
  const meta = (durationSeconds, width = 320) => ({ durationSeconds, width, height: 180, fileName: 'x', filePath: 'x', audioCodec: 'none', videoCodec: 'h264', format: 'mp4', videoBitrate: 0, audioBitrate: 0, totalBitrate: 0, fileSizeBytes: 1, fps: 30 })
  const assets = [{ id: 'v1', kind: 'video', metadata: meta(2) }, { id: 'm1', kind: 'audio', metadata: meta(3, 0) }, { id: 'v2', kind: 'video', metadata: meta(4) }]
  let n = 0
  const existing = [clip({ id: 'base', endSeconds: 10 })]
  const onV2 = insertAssets(existing, assets, { kind: 'video', track: 1, time: 1 }, () => `n${++n}`)
  assert.deepEqual(onV2.clips.slice(1).map(c => [c.mediaId, c.kind, c.track, c.timelineStart, c.scale]), [['v1', 'video', 1, 1, 0.4], ['m1', 'audio', 0, 1, 1], ['v2', 'video', 1, 3, 0.4]], 'video stacks as PiP on V2, audio goes to A1')
  assert.equal(onV2.ids.length, 3)
  const onA2 = insertAssets([], assets, { kind: 'audio', track: 1, time: 0 }, () => `a${++n}`)
  assert.deepEqual(onA2.clips.map(c => [c.kind, c.track, c.timelineStart, c.scale]), [['video', 0, 0, 1], ['audio', 1, 0, 1], ['video', 0, 2, 1]], 'video dropped on an audio track lands full-frame on V1')
  assert.strictEqual(insertAssets(existing, [], { kind: 'video', track: 0, time: 0 }, () => 'z').clips, existing)
  assert.equal(removeMedia(onV2.clips, ['v1', 'v2']).length, 2)
  assert.strictEqual(removeMedia(existing, ['nope']), existing)
})

test('zoom anchoring, ruler steps and drag payloads', () => {
  assert.equal(anchoredScrollLeft(0, 50, 2000, 10, 3, 350), 300)
  assert.equal(anchoredScrollLeft(0, 0, 1000, 10, 0, 500), 0)
  assert.equal(clampZoom(0.1, 10), 0.25)
  assert.ok(Math.abs(wheelZoomFactor(-100) * wheelZoomFactor(100) - 1) < 1e-12)
  assert.equal(rulerStep(100), 1)
  assert.equal(rulerStep(1000), 0.1)
  assert.equal(formatRulerTime(75, 5), '1:15')
  assert.deepEqual(parseMediaIds('["a","b"]'), ['a', 'b'])
  assert.deepEqual(parseMediaIds('abc'), ['abc'])
})

test('paste keeps spacing from the playhead and lifts each kind clear of existing clips', () => {
  let n = 0
  const existing = [clip({ id: 'v', timelineStart: 0, endSeconds: 10 }), clip({ id: 'm', kind: 'audio', mediaId: 's', timelineStart: 20, endSeconds: 2 })]
  const copied = [clip({ id: 'x', timelineStart: 3, endSeconds: 2 }), clip({ id: 'y', timelineStart: 4, endSeconds: 2, kind: 'audio', mediaId: 's' })]
  const { clips, ids } = pasteClips(existing, copied, 5, () => `p${++n}`)
  assert.deepEqual(ids, ['p1', 'p2'])
  const pasted = clips.filter(c => ids.includes(c.id)).map(c => [c.kind, c.track, c.timelineStart])
  assert.deepEqual(pasted, [['video', 1, 5], ['audio', 0, 6]], 'video lifts above V1; audio fits on A1')
  assert.equal(clips.length, 4)
  assert.deepEqual(pasteClips(existing, [], 0, () => 'z').clips, existing)
})

test('text clips have no source limit and land on the first free text track', () => {
  const t = textClip(0, 2, 't1')
  assert.equal(t.kind, 'text')
  assert.equal(t.mediaId, '')
  assert.equal(sourceDuration(t, []), TEXT_SOURCE_SECONDS)
  assert.equal(trimEdge(t, 'end', 30, sourceDuration(t, [])).endSeconds, 30, 'text can be stretched')
  assert.equal(freeTrack([t], 'text', 3, 3), 1)
  assert.equal(freeTrack([t], 'text', 5, 3), 0)
  assert.equal(trackCount([t], 'text'), 2)
})

test('timeline span: headroom past the last clip, zooming out past fit grows the range', async () => {
  const { timelineHeadroom, visibleSpan } = await import('../renderer/src/lib/timeline.ts')
  assert.equal(timelineHeadroom(0), 3)
  assert.equal(timelineHeadroom(10), 13)
  assert.equal(timelineHeadroom(100), 120)
  assert.equal(visibleSpan(12, 1, 8), 12, 'at fit the axis is the visible range')
  assert.equal(visibleSpan(12, 4, 8), 12, 'zooming in scrolls; the full range stays the axis')
  assert.equal(visibleSpan(12, 0.5, 8), 24, 'zooming out past fit shows more empty timeline')
  assert.equal(visibleSpan(12, 1, 15), 15, 'never shorter than the clips (dragging an edge past the end)')
})

test('layers snap their nearest edge or centre to the canvas edges and centre', () => {
  assert.deepEqual(snapToCanvas(0.01, 0.4, 0.02), { offset: -0.01, guide: 0 }, 'left edge to the left side')
  assert.deepEqual(snapToCanvas(0.595, 0.4, 0.02).guide, 1, 'right edge to the right side')
  const centred = snapToCanvas(0.29, 0.4, 0.02)
  assert.equal(centred.guide, 0.5)
  assert.ok(Math.abs(centred.offset - 0.01) < 1e-9, 'centre to the middle')
  assert.deepEqual(snapToCanvas(0.2, 0.4, 0.02), { offset: 0, guide: null }, 'nothing near')
  assert.deepEqual(snapToCanvas(0.01, 0.4, 0), { offset: 0, guide: null }, 'zero tolerance turns it off')
})

test('dragging up opens at most one new track above the other clips', async () => {
  const { maxTrackShift } = await import('../renderer/src/lib/edit.ts')
  const clips = [clip({ id: 'a', track: 0 }), clip({ id: 'b', track: 1 }), clip({ id: 't', kind: 'text', track: 0 })]
  assert.equal(maxTrackShift(clips, ['b'], 'video'), 0, 'the top clip cannot climb onto an endless stack of new tracks')
  assert.equal(maxTrackShift(clips, ['a'], 'video'), 2, 'a lower clip can go one above the highest other clip')
  assert.equal(maxTrackShift([clip({ id: 'solo', track: 0 })], ['solo'], 'video'), 0, 'a lone clip stays on the bottom track')
  assert.equal(maxTrackShift(clips, ['a', 'b'], 'video'), 0, 'a group with nothing else of its kind stays put')
  assert.equal(maxTrackShift(clips, ['t'], 'text'), 0, 'text tracks follow the same rule')
  assert.equal(maxTrackShift([...clips, clip({ id: 'c', track: 3 })], ['b'], 'video'), 3, 'room up to one above the highest other clip')
})

test('compactTracks closes up empty tracks so clips cannot leapfrog upward forever', async () => {
  const { compactTracks } = await import('../renderer/src/lib/edit.ts')
  // A on V1 and B on V2; A jumps to V3, then B jumps to V4: empty V1 and V2 would pile up below.
  const leapt = [clip({ id: 'a', track: 2 }), clip({ id: 'b', track: 3 }), clip({ id: 'm', kind: 'audio', track: 4 })]
  const { clips: compacted, remap } = compactTracks(leapt)
  assert.deepEqual(compacted.map(c => [c.id, c.track]), [['a', 0], ['b', 1], ['m', 0]], 'order is kept, gaps are gone, per kind')
  assert.equal(remap('video', 3), 1)
  assert.equal(remap('audio', 4), 0)
  const tidy = [clip({ id: 'a', track: 0 }), clip({ id: 'b', track: 1 })]
  assert.equal(compactTracks(tidy).clips, tidy, 'no change returns the same array')
})

test('update checks compare release versions numerically', () => {
  assert.equal(isNewerVersion('0.4.0', '0.3.0'), true)
  assert.equal(isNewerVersion('v0.3.10', '0.3.9'), true, 'tags may carry a v, and 10 > 9')
  assert.equal(isNewerVersion('0.3.0', '0.3.0'), false)
  assert.equal(isNewerVersion('0.2.9', '0.3.0'), false)
  assert.equal(isNewerVersion('1.0.0', '1.0.0-beta.2'), true, 'a release beats its pre-release')
  assert.equal(isNewerVersion('1.0.0-beta.2', '1.0.0'), false)
  assert.equal(isNewerVersion('1.0', '1.0.0'), false)
})

test('a clip with its own speed is shorter or longer on the timeline, and splits and trims stay in source time', () => {
  const fast = clip({ id: 'f', timelineStart: 1, startSeconds: 2, endSeconds: 6, speed: 2 })
  assert.equal(clipLength(fast), 2, '4 s of source at 2x lasts 2 s')
  assert.equal(clipEnd(fast), 3)
  assert.equal(sourceTimeAt(fast, 2), 4, 'one timeline second in is two source seconds in')
  let n = 0
  const [a, b] = splitAt([fast], 2, null, () => `n${++n}`)
  assert.deepEqual([a.startSeconds, a.endSeconds, b.startSeconds, b.endSeconds, b.timelineStart], [2, 4, 4, 6, 2])
  assert.equal(b.speed, 2, 'both halves keep the speed')
  const trimmed = trimEdge(fast, 'start', 3, 10)
  assert.equal(trimmed.timelineStart, 1.5, 'trimming 1 s of source moves the start half a timeline second')
  assert.equal(clipEnd(trimmed), 3, 'the out point stays put')
  const slow = clip({ endSeconds: 2, speed: 0.5 })
  assert.equal(clipLength(slow), 4)
})

test('clip gain converts between decibels and linear volume', () => {
  assert.equal(gainToDb(1), 0)
  assert.ok(Math.abs(gainToDb(2) - 6.0206) < 1e-3)
  assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 1e-3)
  assert.ok(Math.abs(dbToGain(12) - 3.981) < 1e-3)
  assert.equal(dbToGain(-40), 0, 'the bottom of the range is silence')
  assert.equal(gainToDb(0), -Infinity)
})
