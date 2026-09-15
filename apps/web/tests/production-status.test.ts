// @vitest-environment node
import type { ClipState, FrameState, ProductionScene, ProductionShot, ReelRow, Take } from '@folio/contracts'
import { generationId, jobId, projectId, reelId, shotId } from '@folio/contracts'
import { characterId, mention, nodeId, text } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { describeReason, episodeStats, hasDescription, isFlagged, needsFrame, reelGates, reelTiming, sceneMode } from '../lib/production/status'
import type { GateInput } from '../lib/production/status'

/**
 * The reel fold: nine statuses, the reason under the buttons, the timing
 * cap, and the six route modes - every one from rows, none stored. The
 * copy is asserted where the mock fixed it and the rule asserted
 * everywhere.
 */

const PROJECT = projectId('00000000-0000-4000-8000-000000000001')
const SCENE = nodeId('00000000-0000-4000-8000-0000000000aa')
const ADE = characterId('00000000-0000-4000-8000-0000000000ad')
const T0 = '2026-09-15T10:00:00.000Z'
const T1 = '2026-09-15T10:05:00.000Z'
const T2 = '2026-09-15T10:10:00.000Z'

const input: GateInput = { available: 220, frameCost: 4, renderCost: 40, resolution: '720p' }

let seq = 0
const uuid = (): string => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`

const drawn = (): FrameState => ({ kind: 'drawn', jobId: jobId(uuid()), url: 'https://frames.example/one.png' })
const take = (frame: FrameState, at = T0, kept = false): Take => ({ generationId: generationId(uuid()), frame, kept, createdAt: at })

type ShotOverrides = Partial<Pick<ProductionShot, 'durationSeconds' | 'description' | 'state' | 'updatedAt' | 'takes' | 'frame'>>

const shot = (number: string, overrides: ShotOverrides = {}): ProductionShot => {
  const takes = overrides.takes ?? []
  return {
    id: shotId(uuid()),
    projectId: PROJECT,
    sceneNodeId: SCENE,
    orderKey: number,
    reelId: null,
    size: 'ws',
    movement: 'static',
    angle: 'eye_level',
    lensMm: 35,
    durationSeconds: 5,
    description: [text('Wide on the pitch. '), mention({ entity: 'character', id: ADE }), text(' alone.')],
    origin: 'typed',
    state: 'accepted',
    createdAt: T0,
    updatedAt: T0,
    number,
    frame: overrides.frame ?? takes[0]?.frame ?? { kind: 'empty' },
    takes,
    ...overrides,
  }
}

const reel = (shots: readonly ProductionShot[], overrides: Partial<Pick<ReelRow, 'clipSeconds' | 'finalizedAt' | 'clip'>> = {}): ReelRow => ({
  id: reelId(uuid()),
  projectId: PROJECT,
  sceneNodeId: SCENE,
  orderKey: 'a',
  name: 'Reel 1',
  clipSeconds: 15,
  finalizedAt: null,
  createdAt: T0,
  updatedAt: T0,
  number: 1,
  shots: [...shots],
  clip: { kind: 'none' },
  ...overrides,
})

const scene = (reels: readonly ReelRow[]): ProductionScene => ({
  sceneNodeId: SCENE,
  number: 1,
  heading: 'EXT. COMMUNITY PITCH - DUSK',
  ie: 'EXT',
  set: 'COMMUNITY PITCH',
  timeOfDay: 'DUSK',
  locationId: null,
  cast: [ADE],
  reels: [...reels],
  unreeled: [],
})

const threeDrawn = (): ProductionShot[] => [
  shot('01-01', { durationSeconds: 4, takes: [take(drawn())] }),
  shot('01-02', { durationSeconds: 3, takes: [take(drawn())] }),
  shot('01-03', { durationSeconds: 8, takes: [take(drawn())] }),
]

describe('reelTiming', () => {
  it('sums accepted shots, counts the untimed, and says which way the gap runs', () => {
    const under = reelTiming([shot('a', { durationSeconds: 4 }), shot('b', { durationSeconds: 3 }), shot('c', { durationSeconds: 5 })], 15)
    expect(under).toMatchObject({ total: 12, missing: 0, remaining: 3, over: 0, exact: false })
    const over = reelTiming([shot('a', { durationSeconds: 4 }), shot('b', { durationSeconds: 3 }), shot('c', { durationSeconds: 2 })], 8)
    expect(over).toMatchObject({ total: 9, missing: 0, remaining: 0, over: 1, exact: false })
    const exact = reelTiming(threeDrawn(), 15)
    expect(exact).toMatchObject({ total: 15, missing: 0, remaining: 0, over: 0, exact: true })
  })

  it('ignores proposals and reports a missing duration as missing, never as zero', () => {
    const timing = reelTiming(
      [shot('a', { durationSeconds: 10 }), shot('b', { durationSeconds: null }), shot('p', { state: 'proposed', durationSeconds: 99 })],
      15,
    )
    expect(timing).toMatchObject({ total: 10, missing: 1, remaining: 5, exact: false })
    expect(timing.segments.map((segment) => segment.seconds)).toEqual([10, null])
  })

  it('is never exact with no shots', () => {
    expect(reelTiming([], 15).exact).toBe(false)
  })
})

describe('the shot-level facts', () => {
  it('a description is text or a mention; whitespace is nothing', () => {
    expect(hasDescription(shot('a', { description: [text('   ')] }))).toBe(false)
    expect(hasDescription(shot('a', { description: [] }))).toBe(false)
    expect(hasDescription(shot('a', { description: [mention({ entity: 'character', id: ADE })] }))).toBe(true)
  })

  it('a refused frame flags the shot until the shot is rewritten', () => {
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    const untouched = shot('a', { takes: [take(refused, T1)], updatedAt: T0 })
    expect(isFlagged(untouched)).toBe(true)
    expect(needsFrame(untouched)).toBe(false)
    const rewritten = shot('a', { takes: [take(refused, T1)], updatedAt: T2 })
    expect(isFlagged(rewritten)).toBe(false)
    expect(needsFrame(rewritten)).toBe(true)
  })

  it('a failed or cancelled frame needs a frame; a drawn or in-flight one does not', () => {
    const failed: FrameState = { kind: 'failed', jobId: jobId(uuid()), error: null, refunded: true }
    expect(needsFrame(shot('a', { takes: [take(failed)] }))).toBe(true)
    expect(needsFrame(shot('a', { takes: [take({ kind: 'cancelled', jobId: jobId(uuid()) })] }))).toBe(true)
    expect(needsFrame(shot('a', { takes: [take(drawn())] }))).toBe(false)
    expect(needsFrame(shot('a', { takes: [take({ kind: 'queued', jobId: jobId(uuid()), cost: 4 })] }))).toBe(false)
  })
})

describe('reelGates', () => {
  it('an empty reel is writing, with no button live', () => {
    const gates = reelGates(reel([]), input)
    expect(gates.status).toBe('writing')
    expect(gates.reason).toEqual({ kind: 'no-shots' })
    expect(gates).toMatchObject({ canGenerate: false, canFinalize: false, canRender: false, canUnlock: false })
  })

  it('a shot without a description keeps the reel writing and names the count', () => {
    const gates = reelGates(reel([shot('a'), shot('b', { description: [] }), shot('c', { description: [text(' ')] })]), input)
    expect(gates.status).toBe('writing')
    expect(gates.reason).toEqual({ kind: 'missing-descriptions', count: 2 })
    expect(describeReason(gates.reason)).toBe('2 shots need a description before frames can generate.')
    expect(describeReason({ kind: 'missing-descriptions', count: 1 })).toBe('1 shot needs a description before frames can generate.')
  })

  it('a complete list is ready: the pending shots, and their cost, named', () => {
    const shots = [shot('a', { takes: [take(drawn())] }), shot('b'), shot('c')]
    const gates = reelGates(reel(shots), input)
    expect(gates.status).toBe('ready')
    expect(gates.pending.map((entry) => entry.number)).toEqual(['b', 'c'])
    expect(gates.cost).toBe(8)
    expect(gates.canGenerate).toBe(true)
    expect(describeReason(gates.reason)).toBe('Complete list. 2 frames at 4 credits each.')
  })

  it('short of credits, nothing generates and the numbers are printed', () => {
    const gates = reelGates(reel([shot('a'), shot('b'), shot('c')]), { ...input, available: 4 })
    expect(gates.status).toBe('needs-credits')
    expect(gates.canGenerate).toBe(false)
    expect(describeReason(gates.reason)).toBe('Needs 12 credits, you have 4. Top up to continue.')
  })

  it('a frame in flight is generating, and generating again is refused', () => {
    const shots = [shot('a', { takes: [take(drawn())] }), shot('b', { takes: [take({ kind: 'queued', jobId: jobId(uuid()), cost: 4 })] }), shot('c')]
    const gates = reelGates(reel(shots), input)
    expect(gates.status).toBe('generating')
    expect(gates.canGenerate).toBe(false)
    expect(describeReason(gates.reason)).toBe("Frames are generating. You can keep editing shots that haven't started.")
  })

  it("a refused frame blocks the reel with the refusal in the writer's terms, until the shot is rewritten", () => {
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    const shots = [shot('01-01', { takes: [take(drawn())] }), shot('01-02', { takes: [take(refused, T1)], updatedAt: T0 }), shot('01-03')]
    const gates = reelGates(reel(shots), input)
    expect(gates.status).toBe('blocked')
    expect(describeReason(gates.reason)).toBe(
      "Shot 01-02 can't be rendered: It describes an injury. Fix it and the rest of the reel generates.",
    )
    const rewritten = shots.map((entry) => (entry.number === '01-02' ? { ...entry, updatedAt: T2 } : entry))
    const after = reelGates(reel(rewritten), input)
    expect(after.status).toBe('ready')
    expect(after.pending.map((entry) => entry.number)).toEqual(['01-02', '01-03'])
  })

  it('every frame drawn and the clip filled exactly is frames-done, and Finalize is live', () => {
    const gates = reelGates(reel(threeDrawn()), input)
    expect(gates.status).toBe('frames-done')
    expect(gates.canFinalize).toBe(true)
    expect(gates.canGenerate).toBe(false)
    expect(describeReason(gates.reason)).toBe('All frames done. Finalize locks them, then the reel can render.')
  })

  it('every frame drawn but the clip not filled is frames-done with Finalize refused, and says how far', () => {
    const under = reelGates(
      reel([shot('a', { durationSeconds: 4, takes: [take(drawn())] }), shot('b', { durationSeconds: 3, takes: [take(drawn())] })]),
      input,
    )
    expect(under.status).toBe('frames-done')
    expect(under.canFinalize).toBe(false)
    expect(describeReason(under.reason)).toBe('Shots run 7 s; the clip is 15 s. Add 8 s, or pick a shorter clip.')

    const over = reelGates(reel(threeDrawn(), { clipSeconds: 10 }), input)
    expect(over.canFinalize).toBe(false)
    expect(describeReason(over.reason)).toBe('Shots run 15 s; the clip is 10 s. Cut 5 s, or pick a longer clip.')

    const untimed = reelGates(reel([shot('a', { durationSeconds: null, takes: [take(drawn())] })]), input)
    expect(untimed.canFinalize).toBe(false)
    expect(describeReason(untimed.reason)).toBe('All frames done. 1 shot needs a duration before the reel can be finalized.')
  })

  it('a finalized reel may render or unlock, never generate', () => {
    const gates = reelGates(reel(threeDrawn(), { finalizedAt: T1 }), input)
    expect(gates.status).toBe('finalized')
    expect(gates).toMatchObject({ canGenerate: false, canFinalize: false, canUnlock: true, canRender: true })
    expect(describeReason(gates.reason)).toBe('Finalized. Render the reel, or unlock to keep editing.')
    const broke = reelGates(reel(threeDrawn(), { finalizedAt: T1 }), { ...input, available: 39 })
    expect(broke.canRender).toBe(false)
  })

  it('a render in flight is rendering; unlock waits', () => {
    const clip: ClipState = { kind: 'queued', jobId: jobId(uuid()), cost: 40 }
    const gates = reelGates(reel(threeDrawn(), { finalizedAt: T1, clip }), input)
    expect(gates.status).toBe('rendering')
    expect(gates.canUnlock).toBe(false)
    expect(describeReason(gates.reason)).toBe('The clip is rendering. Unlock waits until it is done.')
  })

  it('a rendered clip is rendered, with the resolution and the cost spent', () => {
    const clip: ClipState = { kind: 'rendered', jobId: jobId(uuid()), url: 'https://clips.example/one.mp4' }
    const gates = reelGates(reel(threeDrawn(), { finalizedAt: T1, clip }), input)
    expect(gates.status).toBe('rendered')
    expect(gates.canRender).toBe(true)
    expect(describeReason(gates.reason)).toBe('Rendered at 720p · 40 credits spent.')
  })

  it('a failed or refused render stays finalized and says so', () => {
    const failed: ClipState = { kind: 'failed', jobId: jobId(uuid()), error: 'The model timed out.', refunded: true }
    expect(describeReason(reelGates(reel(threeDrawn(), { finalizedAt: T1, clip: failed }), input).reason)).toBe(
      'The render failed and the credits were refunded. The model timed out.',
    )
    const refused: ClipState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'The clip depicts a real person.' }
    const gates = reelGates(reel(threeDrawn(), { finalizedAt: T1, clip: refused }), input)
    expect(gates.status).toBe('finalized')
    expect(describeReason(gates.reason)).toBe('The render was refused: The clip depicts a real person.')
  })

  it('proposals are not shots: a reel of only proposals is writing', () => {
    const gates = reelGates(reel([shot('p', { state: 'proposed' })]), input)
    expect(gates.status).toBe('writing')
    expect(gates.reason).toEqual({ kind: 'no-shots' })
  })
})

describe('sceneMode', () => {
  it('folds a scene into the six route modes by precedence', () => {
    expect(sceneMode(scene([]), input)).toBe('empty')
    expect(sceneMode(scene([reel([shot('a')])]), input)).toBe('authoring')
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'x' }
    expect(sceneMode(scene([reel([shot('a')]), reel([shot('b', { takes: [take(refused, T1)] })])]), input)).toBe('blocked')
    expect(sceneMode(scene([reel([shot('a'), shot('b'), shot('c')])]), { ...input, available: 0 })).toBe('nocredits')
    const queued: FrameState = { kind: 'queued', jobId: jobId(uuid()), cost: 4 }
    expect(sceneMode(scene([reel([shot('a', { takes: [take(queued)] })])]), input)).toBe('generating')
    const rendered: ClipState = { kind: 'rendered', jobId: jobId(uuid()), url: 'u' }
    expect(sceneMode(scene([reel(threeDrawn(), { finalizedAt: T1, clip: rendered })]), input)).toBe('finished')
  })
})

describe('episodeStats', () => {
  it('counts scenes with reels, reels, accepted shots, drawn frames and rendered clips', () => {
    const rendered: ClipState = { kind: 'rendered', jobId: jobId(uuid()), url: 'u' }
    const scenes = [
      scene([reel([shot('a', { takes: [take(drawn())] }), shot('b'), shot('p', { state: 'proposed' })]), reel([shot('c')])]),
      scene([]),
      scene([reel(threeDrawn(), { finalizedAt: T1, clip: rendered, clipSeconds: 8 })]),
    ]
    expect(episodeStats(scenes)).toEqual({
      scenes: 3,
      scenesWithReels: 2,
      reels: 3,
      shots: 6,
      framesDone: 4,
      framesTotal: 6,
      clipsRendered: 1,
      renderedSeconds: 8,
    })
  })
})
