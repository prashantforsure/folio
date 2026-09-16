// @vitest-environment node
import type { ClipState, FrameState, ProductionScene, ProductionShot, ReelRow, Take } from '@folio/contracts'
import { generationId, jobId, projectId, reelId, shotId } from '@folio/contracts'
import { characterId, mention, nodeId, text } from '@folio/script'
import { describe, expect, it } from 'vitest'

import type { GateInput } from '../lib/production/status'
import {
  coverageRows,
  episodeFrames,
  episodeStats,
  frameCaption,
  frameTileOf,
  orphanLabel,
  quotePieces,
  reelViewOf,
  reelsChip,
  sceneCoverageOf,
  sceneMeta,
  sceneStatus,
  sceneTabLabel,
  shotChips,
  shotRowTone,
  statTiles,
  statusLeft,
} from '../lib/production/view'

/**
 * The mockup's `data()` over rows: every tile state, the reel's labels and
 * the line under its buttons, the scene's coverage, and the counts the
 * header, the tiles, the widget and the status bar all print - from one
 * derivation, so they cannot disagree.
 */

const PROJECT = projectId('00000000-0000-4000-8000-000000000001')
const SCENE = nodeId('00000000-0000-4000-8000-0000000000aa')
const SCENE_2 = nodeId('00000000-0000-4000-8000-0000000000ab')
const ADE = characterId('00000000-0000-4000-8000-0000000000ad')
const T0 = '2026-09-15T10:00:00.000Z'
const T1 = '2026-09-15T10:05:00.000Z'
const T2 = '2026-09-15T10:10:00.000Z'

const input: GateInput = { available: 220, frameCost: 4, renderCost: 40, resolution: '720p' }

let seq = 0
const uuid = (): string => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`

const drawn = (url = 'https://frames.example/one.png'): FrameState => ({ kind: 'drawn', jobId: jobId(uuid()), url })
const take = (frame: FrameState, at = T0, kept = false): Take => ({ generationId: generationId(uuid()), frame, kept, createdAt: at })

type ShotOverrides = Partial<Pick<ProductionShot, 'durationSeconds' | 'description' | 'state' | 'updatedAt' | 'takes' | 'frame' | 'reelId'>>

const shot = (number: string, overrides: ShotOverrides = {}): ProductionShot => {
  const takes = overrides.takes ?? []
  return {
    id: shotId(uuid()),
    projectId: PROJECT,
    sceneNodeId: SCENE,
    orderKey: number,
    reelId: null,
    canvasX: null,
    canvasY: null,
    frameUploadUrl: null,
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

const reel = (shots: readonly ProductionShot[], overrides: Partial<Pick<ReelRow, 'clipSeconds' | 'finalizedAt' | 'clip' | 'name'>> = {}): ReelRow => ({
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

const scene = (reels: readonly ReelRow[], overrides: Partial<ProductionScene> = {}): ProductionScene => ({
  sceneNodeId: SCENE,
  number: 1,
  heading: 'EXT. COMMUNITY PITCH – DUSK',
  ie: 'EXT',
  set: 'COMMUNITY PITCH',
  timeOfDay: 'DUSK',
  locationId: null,
  cast: [ADE],
  reels: [...reels],
  unreeled: [],
  ...overrides,
})

const threeDrawn = (): ProductionShot[] => [
  shot('1', { durationSeconds: 4, takes: [take(drawn())] }),
  shot('2', { durationSeconds: 3, takes: [take(drawn())] }),
  shot('3', { durationSeconds: 8, takes: [take(drawn())] }),
]

describe('the shot row', () => {
  it('prints size, movement and angle from the core’s own labels', () => {
    expect(shotChips(shot('1'))).toEqual(['Wide shot', 'Static', 'Eye level'])
  })

  it('splits a spoken line out of the text, straight or curly, and leaves an unclosed quote as text', () => {
    expect(quotePieces('Ade strikes. “Not good enough.” He turns.')).toEqual([
      { kind: 'text', text: 'Ade strikes. ' },
      { kind: 'quote', text: '“Not good enough.”' },
      { kind: 'text', text: ' He turns.' },
    ])
    expect(quotePieces('"I said I\'m done."')).toEqual([{ kind: 'quote', text: '"I said I\'m done."' }])
    expect(quotePieces('He says "wait')).toEqual([{ kind: 'text', text: 'He says "wait' }])
    expect(quotePieces('')).toEqual([])
  })

  it('tones a proposal amber and a refused shot red, until the shot is rewritten', () => {
    expect(shotRowTone(shot('1'))).toBe('plain')
    expect(shotRowTone(shot('1', { state: 'proposed' }))).toBe('proposed')
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    expect(shotRowTone(shot('2', { takes: [take(refused, T1)], updatedAt: T0 }))).toBe('flagged')
    expect(shotRowTone(shot('2', { takes: [take(refused, T1)], updatedAt: T2 }))).toBe('plain')
  })
})

describe('the frame tile', () => {
  it('is one of nine states, each from the job row', () => {
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    const failed: FrameState = { kind: 'failed', jobId: jobId(uuid()), error: null, refunded: true }
    const cases: readonly [ProductionShot, string, string][] = [
      [shot('1', { takes: [take(drawn())] }), 'done', 'Done'],
      [shot('2'), 'await', 'Awaiting frame'],
      [shot('3', { description: [] }), 'needs', 'Needs description'],
      [shot('4', { takes: [take({ kind: 'queued', jobId: jobId(uuid()), cost: 4 })] }), 'queued', 'Queued'],
      [shot('5', { takes: [take({ kind: 'running', jobId: jobId(uuid()), cost: 4 })] }), 'generating', 'Generating'],
      [shot('6', { takes: [take(refused, T1)], updatedAt: T0 }), 'blocked', 'Blocked'],
      [shot('6', { takes: [take(refused, T1)], updatedAt: T2 }), 'await', 'Awaiting frame'],
      [shot('7', { takes: [take(failed)] }), 'failed', 'Failed'],
      [shot('8', { takes: [take({ kind: 'cancelled', jobId: jobId(uuid()) })] }), 'cancelled', 'Cancelled'],
      [shot('9', { state: 'proposed' }), 'proposed', 'Proposed'],
    ]
    for (const [row, kind, word] of cases) {
      const tile = frameTileOf(row)
      expect(tile.kind).toBe(kind)
      expect(tile.word).toBe(word)
    }
  })

  it('says why a blocked tile cannot render and names the shot to rewrite', () => {
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    const tile = frameTileOf(shot('2', { takes: [take(refused, T1)], updatedAt: T0 }))
    expect(tile.label).toBe("Can't render — Rewrite shot 2")
    expect(tile.tone).toBe('bad')
    expect(tile.dashed).toBe(false)
  })

  it('has no percentage until a job carries one, and says takes are on their way while it runs', () => {
    const tile = frameTileOf(shot('5', { takes: [take({ kind: 'running', jobId: jobId(uuid()), cost: 4 })] }))
    expect(tile.progress).toBeNull()
    expect(tile.noTakesLabel).toBe('takes appear when the frame lands')
    expect(frameTileOf(shot('2')).noTakesLabel).toBe('no takes yet')
  })

  it('captions the tile with the shot and its seconds', () => {
    expect(frameCaption(shot('2', { durationSeconds: 5 }))).toBe('Shot 2 · 5s ·')
    expect(frameCaption(shot('3', { durationSeconds: null }))).toBe('Shot 3 · — ·')
  })
})

describe('the reel', () => {
  it('reads Writing shots with a shot to describe, and names the frames Generate would queue', () => {
    const view = reelViewOf(reel([shot('1', { takes: [take(drawn())] }), shot('2'), shot('3', { description: [] })]), input)
    expect(view.status).toEqual({ label: 'Writing shots', tone: 'none' })
    expect(view.shotMeta).toBe('3 shots · 15 s')
    expect(view.durLabel).toBe('15 / 15 s')
    expect(view.generate.label).toBe('✦ Generate 2 frames · 8 cr')
    expect(view.generate.enabled).toBe(false)
    expect(view.reason.text).toBe('1 shot needs a description before frames can generate.')
    expect(view.lock).toEqual({ label: 'Finalize', enabled: false })
    expect(view.render).toEqual({ kind: 'render', label: '▶ Render reel · 40 cr', enabled: false })
  })

  it('speaks of a proposal still waiting before it speaks of the frames', () => {
    const view = reelViewOf(reel([shot('1'), shot('2'), shot('3', { state: 'proposed' })], { clipSeconds: 10 }), input)
    expect(view.proposed).toBe(1)
    expect(view.reason.text).toBe('1 shot is still a proposal. Accept it to generate frames.')
    expect(view.generate).toMatchObject({ label: '✦ Generate 2 frames · 8 cr', enabled: true })
  })

  it('reads Needs credits in orange when the balance is short, and the button says the numbers', () => {
    const view = reelViewOf(reel([shot('1'), shot('2'), shot('3')]), { ...input, available: 4 })
    expect(view.gates.status).toBe('needs-credits')
    expect(view.status.label).toBe('Writing shots')
    expect(view.reason).toEqual({ text: 'Needs 12 credits, you have 4. Top up to continue.', tone: 'live' })
    expect(view.generate.title).toBe('4 credits available · 12 needed')
  })

  it('reads Generating frames in accent while a job is in flight', () => {
    const view = reelViewOf(
      reel([shot('1', { takes: [take(drawn())] }), shot('2', { takes: [take({ kind: 'queued', jobId: jobId(uuid()), cost: 4 })] }), shot('3')]),
      input,
    )
    expect(view.status).toEqual({ label: 'Generating frames', tone: 'accent' })
    expect(view.reason.text).toBe("You can keep editing shots that haven't started.")
  })

  it('reads Blocked in red with the refused shot’s segment in red', () => {
    const refused: FrameState = { kind: 'blocked', jobId: jobId(uuid()), reason: 'It describes an injury.' }
    const shots = [shot('1', { durationSeconds: 4, takes: [take(drawn())] }), shot('2', { durationSeconds: 5, takes: [take(refused, T1)], updatedAt: T0 }), shot('3', { durationSeconds: 3 })]
    const view = reelViewOf(reel(shots, { clipSeconds: 15 }), input)
    expect(view.status).toEqual({ label: 'Blocked', tone: 'bad' })
    expect(view.reason).toEqual({ text: 'Shot 2 is blocked. Rewrite it to generate the remaining 1 frame.', tone: 'bad' })
    expect(view.segments.map((segment) => segment.tone)).toEqual(['seg-1', 'bad', 'seg-3'])
  })

  it('draws the overrun in red past the clip and prints the duration in red', () => {
    const view = reelViewOf(reel([shot('1', { durationSeconds: 4 }), shot('2', { durationSeconds: 3 }), shot('3', { durationSeconds: 3 })], { clipSeconds: 8 }), input)
    expect(view.over).toBe(true)
    expect(view.durLabel).toBe('10 / 8 s')
    expect(view.segments.at(-1)?.tone).toBe('bad')
    expect(view.segments.slice(0, 3).reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100)
  })

  it('reads Rendered · view with the clip, Regenerate at the full price, and Unlock', () => {
    const clip: ClipState = { kind: 'rendered', jobId: jobId(uuid()), url: 'https://clips.example/one.mp4' }
    const view = reelViewOf(reel(threeDrawn(), { finalizedAt: T1, clip }), input)
    expect(view.status).toEqual({ label: 'Rendered · view', tone: 'ok' })
    expect(view.render).toEqual({ kind: 'view', label: 'Rendered · view', url: 'https://clips.example/one.mp4' })
    expect(view.generate).toEqual({ label: '✦ Regenerate frames · 12 cr', enabled: false, title: 'Unlock the reel to regenerate its frames' })
    expect(view.lock).toEqual({ label: 'Unlock', enabled: true })
    expect(view.reason.text).toBe('All 3 frames kept. Reel rendered at 720p.')
  })

  it('offers Finalize once every frame is drawn and the clip is filled exactly, then Render once finalized', () => {
    const done = reelViewOf(reel(threeDrawn()), input)
    expect(done.status).toEqual({ label: 'Frames done', tone: 'ok' })
    expect(done.lock).toEqual({ label: 'Finalize', enabled: true })
    const finalized = reelViewOf(reel(threeDrawn(), { finalizedAt: T1 }), input)
    expect(finalized.status).toEqual({ label: 'Finalized', tone: 'ok' })
    expect(finalized.render).toEqual({ kind: 'render', label: '▶ Render reel · 40 cr', enabled: true })
    const rendering = reelViewOf(reel(threeDrawn(), { finalizedAt: T1, clip: { kind: 'queued', jobId: jobId(uuid()), cost: 40 } }), input)
    expect(rendering.render).toEqual({ kind: 'rendering', label: 'Rendering…' })
    const failed = reelViewOf(reel(threeDrawn(), { finalizedAt: T1, clip: { kind: 'failed', jobId: jobId(uuid()), error: null, refunded: true } }), input)
    expect(failed.render).toEqual({ kind: 'render', label: '▶ Render again · 40 cr', enabled: true })
  })
})

describe('the scene and the episode', () => {
  const rendered = (): ReelRow =>
    reel(threeDrawn(), { finalizedAt: T1, clip: { kind: 'rendered', jobId: jobId(uuid()), url: 'https://clips.example/one.mp4' } })

  it('folds a scene’s coverage: reels, shots, frames done, seconds, and the shots not yet in a reel', () => {
    const coverage = sceneCoverageOf(
      scene([reel([shot('1', { takes: [take(drawn())] }), shot('2'), shot('3', { description: [] })]), reel([shot('4'), shot('5'), shot('6', { state: 'proposed' })], { clipSeconds: 8 })], {
        unreeled: [shot('7'), shot('8', { state: 'proposed' })],
      }),
      input,
    )
    expect(coverage).toMatchObject({ mode: 'authoring', reels: 2, shots: 5, done: 1, total: 5, seconds: 23, unreeled: 1 })
    expect(sceneMeta(coverage)).toBe('1/5 frames · 2 reels')
    expect(sceneTabLabel(coverage)).toBe('1. EXT. COMMUNITY PITCH – DUSK')
  })

  it('reads an empty scene as No reels and a rendered one as Rendered', () => {
    const empty = sceneCoverageOf(scene([]), input)
    expect(empty).toMatchObject({ mode: 'empty', reels: 0, seconds: null })
    expect(sceneMeta(empty)).toBe('no reels')
    expect(sceneStatus(empty.mode)).toEqual({ label: 'No reels', tone: 'none' })
    const done = sceneCoverageOf(scene([rendered()]), input)
    expect(done.mode).toBe('finished')
    expect(sceneMeta(done)).toBe('rendered')
    expect(sceneStatus('blocked')).toEqual({ label: 'Blocked', tone: 'bad' })
    expect(sceneStatus('nocredits')).toEqual({ label: 'Needs credits', tone: 'live' })
  })

  it('counts once and prints everywhere: the tiles, the widget, the chip and the status bar agree', () => {
    const scenes = [
      scene([reel([shot('1', { takes: [take(drawn())] }), shot('2'), shot('3', { description: [] })]), reel([shot('4'), shot('5'), shot('6')], { clipSeconds: 8 })]),
      scene([], { sceneNodeId: SCENE_2, number: 2, heading: 'EXT. COMMUNITY PITCH – MOMENTS LATER' }),
      scene([rendered()], { sceneNodeId: nodeId('00000000-0000-4000-8000-0000000000ac'), number: 3, heading: 'EXT. COMMUNITY PITCH – NIGHT' }),
    ]
    const stats = episodeStats(scenes)
    const coverage = coverageRows(scenes, input)
    expect(stats).toMatchObject({ scenes: 3, scenesWithReels: 2, reels: 3, framesDone: 4, framesTotal: 9, clipsRendered: 1, renderedSeconds: 15 })

    const tiles = statTiles(stats, coverage, '720p')
    expect(tiles.map((tile) => [tile.label, tile.value, tile.note])).toEqual([
      ['Scenes with reels', '2 / 3', 'of 3 in the episode'],
      ['Reels', '3', '2 in Scene 1 · 1 in Scene 3'],
      ['Frames done', '4 / 9', '5 awaiting generation'],
      ['Clips rendered', '1', '720p · 15 s total'],
    ])
    expect(tiles[3]?.tone).toBe('ok')
    expect(episodeFrames(stats)).toEqual({ label: '4 / 9', percent: 44, note: '5 frames left to generate' })
    expect(reelsChip(2)).toBe('2 reels in this scene')
    expect(reelsChip(1)).toBe('1 reel in this scene')
    expect(statusLeft(1, stats, coverage[0] ?? null, 'Writing shots')).toBe('Ep 1 · 3 scenes · 2 reels · Scene 1 · Writing shots')
    expect(statusLeft(1, stats, coverage[1] ?? null, null)).toBe('Ep 1 · 3 scenes · 0 reels · Scene 2 · No reels')
    expect(statusLeft(2, stats, null, null)).toBe('Ep 2 · 3 scenes')
  })

  it('names the orphans in the writer’s terms', () => {
    expect(orphanLabel(3)).toBe("3 shots from the Storyboard aren't in a reel yet")
    expect(orphanLabel(1)).toBe("1 shot from the Storyboard isn't in a reel yet")
  })
})
