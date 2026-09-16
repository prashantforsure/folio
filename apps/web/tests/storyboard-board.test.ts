// @vitest-environment node
import type { FrameState, ShotRow, StoryboardScene } from '@folio/contracts'
import { jobId, projectId, shotId } from '@folio/contracts'
import { nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  coverageOf,
  coverageRows,
  coverageTone,
  dayNight,
  groupLabel,
  matchesFilter,
  sceneNo,
  sceneSlug,
  sceneTone,
  shotEditOf,
  shotStateLabel,
  shotTone,
  sortShots,
  waitingCaption,
} from '../lib/storyboard/board'

/**
 * The Storyboard's derivations - the mockup's `data()` over real rows.
 * Every colour and count the three views, the sidebar group and its widget
 * print comes from here, so this is where they are held to the mockup's
 * rules and to the README's "semantic colour is strict".
 */

const JOB = jobId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')

const shot = (id: string, state: ShotRow['state'], frame: FrameState): ShotRow => ({
  id: shotId(id),
  projectId: projectId('p'),
  sceneNodeId: nodeId('scene-1'),
  orderKey: 'a',
  reelId: null,
  canvasX: null,
  canvasY: null,
  frameUploadUrl: null,
  origin: 'typed',
  state,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  size: 'ms',
  movement: 'static',
  angle: 'eye_level',
  lensMm: 50,
  durationSeconds: null,
  description: [],
  number: '01-01',
  frame,
})

const scene = (number: number, heading: string, shots: readonly ShotRow[]): StoryboardScene => ({
  sceneNodeId: nodeId(`scene-${String(number)}`),
  number,
  heading,
  ie: null,
  set: '',
  timeOfDay: null,
  locationId: null,
  shots: [...shots],
})

const EMPTY: FrameState = { kind: 'empty' }
const DRAWN: FrameState = { kind: 'drawn', jobId: JOB, url: 'https://frames/1.png' }
const QUEUED: FrameState = { kind: 'queued', jobId: JOB, cost: 4 }
const FAILED: FrameState = { kind: 'failed', jobId: JOB, error: null, refunded: true }
const BLOCKED: FrameState = { kind: 'blocked', jobId: JOB, reason: 'Nudity.' }
const UPLOADED: FrameState = { kind: 'uploaded', url: 'https://frames/up.png' }

describe('shotStateLabel and shotTone', () => {
  it('names the frame state in the writer’s terms, a proposal first', () => {
    expect(shotStateLabel(shot('a', 'accepted', EMPTY))).toBe('no frame')
    expect(shotStateLabel(shot('a', 'accepted', QUEUED))).toBe('queued')
    expect(shotStateLabel(shot('a', 'accepted', DRAWN))).toBe('drawn')
    expect(shotStateLabel(shot('a', 'accepted', BLOCKED))).toBe('refused')
    expect(shotStateLabel(shot('a', 'accepted', UPLOADED))).toBe('uploaded')
    expect(shotStateLabel(shot('a', 'proposed', EMPTY))).toBe('proposed')
  })

  it('is green once drawn, orange when failed or refused, amber for a proposal, ink otherwise', () => {
    expect(shotTone(shot('a', 'accepted', DRAWN))).toBe('ok')
    expect(shotTone(shot('a', 'accepted', UPLOADED))).toBe('ok')
    expect(shotTone(shot('a', 'accepted', FAILED))).toBe('live')
    expect(shotTone(shot('a', 'accepted', BLOCKED))).toBe('live')
    expect(shotTone(shot('a', 'proposed', EMPTY))).toBe('warn')
    expect(shotTone(shot('a', 'accepted', EMPTY))).toBe('none')
    expect(shotTone(shot('a', 'accepted', QUEUED))).toBe('none')
  })
})

describe('sceneTone', () => {
  it('follows the mockup: no shots is ink, every shot drawn is green, anything else amber', () => {
    expect(sceneTone(scene(1, 'X', []))).toBe('none')
    expect(sceneTone(scene(1, 'X', [shot('a', 'accepted', DRAWN), shot('b', 'accepted', DRAWN)]))).toBe('ok')
    expect(sceneTone(scene(1, 'X', [shot('a', 'accepted', DRAWN), shot('b', 'accepted', EMPTY)]))).toBe('warn')
  })

  it('counts a proposal as a decision waiting', () => {
    expect(sceneTone(scene(1, 'X', [shot('a', 'accepted', DRAWN), shot('b', 'proposed', EMPTY)]))).toBe('warn')
  })
})

describe('labels', () => {
  it('pads the scene number and names a missing heading', () => {
    expect(sceneNo(3)).toBe('03')
    expect(sceneNo(12)).toBe('12')
    expect(sceneSlug({ ie: 'ext', set: 'COMMUNITY PITCH', heading: 'EXT. COMMUNITY PITCH - DUSK' })).toBe('EXT. COMMUNITY PITCH')
    expect(sceneSlug({ ie: null, set: 'COMMUNITY PITCH', heading: 'COMMUNITY PITCH - DUSK' })).toBe('COMMUNITY PITCH')
    expect(sceneSlug({ ie: null, set: '', heading: 'INTERCUT - PHONE CALL' })).toBe('INTERCUT - PHONE CALL')
    expect(sceneSlug({ ie: null, set: '', heading: '' })).toBe('No heading yet')
    expect(groupLabel(1, 'EXT. COMMUNITY PITCH')).toBe('01 — EXT. COMMUNITY PITCH')
    expect(groupLabel(2, '')).toBe('02 — untitled')
    expect(dayNight('DUSK')).toBe('DUSK')
    expect(dayNight(null)).toBe('—')
  })
})

describe('matchesFilter', () => {
  const drawn = shot('a', 'accepted', DRAWN)
  const waiting = shot('b', 'accepted', EMPTY)
  const queued = shot('c', 'accepted', QUEUED)
  const proposed = shot('d', 'proposed', EMPTY)
  const uploaded = shot('e', 'accepted', UPLOADED)

  it('reads the same rows four ways; an upload is a frame', () => {
    expect([drawn, waiting, queued, proposed].filter((entry) => matchesFilter(entry, 'all'))).toHaveLength(4)
    expect([drawn, waiting, queued, proposed, uploaded].filter((entry) => matchesFilter(entry, 'drawn'))).toEqual([drawn, uploaded])
    expect(matchesFilter(uploaded, 'waiting')).toBe(false)
    expect([drawn, waiting, queued, proposed].filter((entry) => matchesFilter(entry, 'waiting'))).toEqual([waiting, queued])
    expect([drawn, waiting, queued, proposed].filter((entry) => matchesFilter(entry, 'proposed'))).toEqual([proposed])
  })
})

describe('sortShots', () => {
  const ws = { ...shot('a', 'accepted', EMPTY), size: 'ws' as const, lensMm: 24 }
  const cu = { ...shot('b', 'accepted', DRAWN), size: 'cu' as const, lensMm: 85 }
  const ms = { ...shot('c', 'accepted', FAILED), size: 'ms' as const, lensMm: null }
  const ms2 = { ...shot('d', 'proposed', EMPTY), size: 'ms' as const, lensMm: 35 }
  const rows = [cu, ms, ws, ms2]

  it('leaves the sequence alone', () => {
    expect(sortShots(rows, 'sequence')).toBe(rows)
  })

  it('orders by the vocabulary, ties in story order', () => {
    expect(sortShots(rows, 'size').map((entry) => entry.id)).toEqual([ws.id, ms.id, ms2.id, cu.id])
  })

  it('orders by lens, a missing lens last', () => {
    expect(sortShots(rows, 'lens').map((entry) => entry.id)).toEqual([ws.id, ms2.id, cu.id, ms.id])
  })

  it('puts what needs work first', () => {
    expect(sortShots(rows, 'state').map((entry) => entry.id)).toEqual([ms2.id, ms.id, ws.id, cu.id])
  })

  it('does not mutate its input', () => {
    sortShots(rows, 'lens')
    expect(rows.map((entry) => entry.id)).toEqual([cu.id, ms.id, ws.id, ms2.id])
  })
})

describe('shotEditOf', () => {
  it('is the six spec fields and nothing else', () => {
    const row = shot('a', 'accepted', DRAWN)
    expect(shotEditOf(row)).toEqual({
      size: 'ms',
      movement: 'static',
      angle: 'eye_level',
      lensMm: 50,
      durationSeconds: null,
      description: [],
    })
  })
})

describe('coverage', () => {
  const board = [
    scene(1, 'EXT. COMMUNITY PITCH', [shot('a', 'accepted', DRAWN), shot('b', 'accepted', EMPTY), shot('c', 'accepted', QUEUED)]),
    scene(2, '', []),
    scene(3, 'EXT. COMMUNITY PITCH', [shot('d', 'proposed', EMPTY)]),
  ]

  it('counts accepted shots, proposals and drawn frames per scene', () => {
    expect(coverageRows(board)).toEqual([
      { sceneNodeId: nodeId('scene-1'), number: 1, heading: 'EXT. COMMUNITY PITCH', ie: null, set: '', shots: 3, proposed: 0, drawn: 1 },
      { sceneNodeId: nodeId('scene-2'), number: 2, heading: '', ie: null, set: '', shots: 0, proposed: 0, drawn: 0 },
      { sceneNodeId: nodeId('scene-3'), number: 3, heading: 'EXT. COMMUNITY PITCH', ie: null, set: '', shots: 0, proposed: 1, drawn: 0 },
    ])
  })

  it('is the mockup’s widget: boards drawn 1 / 3, 2 shots waiting on a frame', () => {
    const coverage = coverageOf(coverageRows(board))
    expect(coverage).toEqual({ boarded: 1, scenes: 3, waiting: 2, shots: 3, proposed: 1 })
    expect(waitingCaption(coverage)).toBe('2 shots waiting on a frame')
  })

  it('captions the two edges', () => {
    expect(waitingCaption({ boarded: 0, scenes: 3, waiting: 0, shots: 0, proposed: 0 })).toBe('No shots yet')
    expect(waitingCaption({ boarded: 1, scenes: 1, waiting: 0, shots: 2, proposed: 0 })).toBe('Every shot has a frame')
    expect(waitingCaption({ boarded: 1, scenes: 1, waiting: 1, shots: 2, proposed: 0 })).toBe('1 shot waiting on a frame')
  })

  it('tones a coverage row as the scene would be toned', () => {
    const rows = coverageRows(board)
    expect(rows.map(coverageTone)).toEqual(['warn', 'none', 'warn'])
    expect(coverageTone({ sceneNodeId: nodeId('x'), number: 1, heading: '', ie: null, set: '', shots: 2, proposed: 0, drawn: 2 })).toBe('ok')
  })
})
