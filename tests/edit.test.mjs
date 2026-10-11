import test from 'node:test'
import assert from 'node:assert/strict'
import { clipsAt, insertAssets, moveClips, primaryClipAt, removeMedia, selectClips, snapTargets, snapTime, splitAt, timelineEnd, trackCount, trimEdge, updateClipRange } from '../renderer/src/lib/edit.ts'
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
  assert.equal(clampZoom(0.2, 10), 1)
  assert.ok(Math.abs(wheelZoomFactor(-100) * wheelZoomFactor(100) - 1) < 1e-12)
  assert.equal(rulerStep(100), 1)
  assert.equal(rulerStep(1000), 0.1)
  assert.equal(formatRulerTime(75, 5), '1:15')
  assert.deepEqual(parseMediaIds('["a","b"]'), ['a', 'b'])
  assert.deepEqual(parseMediaIds('abc'), ['abc'])
})
