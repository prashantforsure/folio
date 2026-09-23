import { GENERATION_COSTS } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import { costTable, costTableText, credits, imagesToDraw, missingPlates, shootPlan, totalOf } from '../lib/agent/production/plan'
import { member, reel, scene, sheetDone, shot, uid } from './helpers/production-fixtures'

/**
 * What an episode still needs drawn, and what it costs - roadmap task 5.1.
 * The cost table the writer confirms is this module's arithmetic over
 * `GENERATION_COSTS`, so every figure here is checked against that table,
 * never a number typed into the test.
 */

const NONE: ReadonlySet<string> = new Set()

describe('imagesToDraw', () => {
  it('lists every missing image in drawing order - the plate first, the frames last - each priced from GENERATION_COSTS', () => {
    const scenes = [scene(1, [reel(1, 1)], { plateReady: false, stillState: 'empty' })]
    const items = imagesToDraw({ scenes, live: NONE, plates: true, looks: false })
    expect(items.map((item) => item.kind)).toEqual(['plate', 'scene_image', 'sheet', 'frames'])
    expect(items.map((item) => item.cost)).toEqual([GENERATION_COSTS.location_plate, GENERATION_COSTS.scene_image, GENERATION_COSTS.storyboard_sheet, 3 * GENERATION_COSTS.shot_frame])
    expect(items[3]).toMatchObject({ kind: 'frames', shotIds: [uid('shot', 11), uid('shot', 12), uid('shot', 13)], label: '3 frames for Reel 1, scene 1' })
  })

  it('draws a plate only once the writer has said so, once per location, and never for a set with no location record', () => {
    const unplated = { plateReady: false }
    const scenes = [scene(1, [reel(1, 1)], unplated), scene(2, [reel(2, 2)], unplated), scene(3, [reel(3, 3)], { ...unplated, locationId: null, locationName: null, set: 'NOWHERE' })]
    expect(imagesToDraw({ scenes, live: NONE, plates: false, looks: false }).filter((item) => item.kind === 'plate')).toEqual([])
    const plates = imagesToDraw({ scenes, live: NONE, plates: true, looks: false }).filter((item) => item.kind === 'plate')
    expect(plates).toEqual([{ kind: 'plate', locationId: uid('location', 1), label: 'The plate for Jetty', cost: GENERATION_COSTS.location_plate }])
    expect(missingPlates(scenes)).toEqual([
      { id: uid('location', 1), name: 'Jetty' },
      { id: null, name: 'NOWHERE' },
    ])
  })

  it('leaves what is drawn, drawing, refused or proposed - and scenes nobody made a reel for', () => {
    const shots = [
      shot(11, { frameState: 'drawn' }),
      shot(12, { frameState: 'blocked', blocked: true }),
      shot(13, { proposed: true }),
      shot(14, { description: '  ' }),
      shot(15),
    ]
    const scenes = [
      scene(1, [reel(1, 1, { shots, sheet: sheetDone(1), clipLengthS: 15 })], { stillState: 'uploaded' }),
      scene(2, [], { stillState: 'empty', plateReady: false }),
    ]
    const items = imagesToDraw({ scenes, live: new Set([uid('shot', 15)]), plates: true, looks: false })
    expect(items).toEqual([])
  })

  it('draws a look for each of the cast with no portrait, once however many scenes they are in, after the plate (task 5.2)', () => {
    const cast = [member(1, 'MEERA'), member(2, 'ARJUN', false)]
    const scenes = [scene(1, [reel(1, 1, { sheet: sheetDone(1) })], { cast, plateReady: false }), scene(2, [reel(2, 2, { sheet: sheetDone(2) })], { cast, plateReady: false })]
    const items = imagesToDraw({ scenes, live: new Set([uid('shot', 11), uid('shot', 12), uid('shot', 13), uid('shot', 21), uid('shot', 22), uid('shot', 23)]), plates: true, looks: true })
    expect(items).toEqual([
      { kind: 'plate', locationId: uid('location', 1), label: 'The plate for Jetty', cost: GENERATION_COSTS.location_plate },
      { kind: 'look', characterId: uid('character', 2), label: 'The look for ARJUN', cost: GENERATION_COSTS.character_look },
    ])
    expect(imagesToDraw({ scenes, live: new Set([uid('character', 2)]), plates: false, looks: true }).filter((item) => item.kind === 'look')).toEqual([])
  })

  it('draws a sheet only from a shotlist that fills the clip', () => {
    const short = reel(1, 1, { shots: [shot(11)] })
    expect(imagesToDraw({ scenes: [scene(1, [short])], live: NONE, plates: false, looks: false }).map((item) => item.kind)).toEqual(['frames'])
  })
})

describe('the cost table', () => {
  it('groups the images by kind, adds the shoots to come at the reel price, and totals from GENERATION_COSTS', () => {
    const scenes = [scene(1, [reel(1, 1), reel(2, 1)], { stillState: 'empty' })]
    const items = imagesToDraw({ scenes, live: NONE, plates: false, looks: false })
    const lines = costTable(items, 2)
    expect(lines).toEqual([
      { label: 'scene image', count: 1, each: GENERATION_COSTS.scene_image, total: GENERATION_COSTS.scene_image },
      { label: 'storyboard sheets', count: 2, each: GENERATION_COSTS.storyboard_sheet, total: 2 * GENERATION_COSTS.storyboard_sheet },
      { label: 'frames', count: 6, each: GENERATION_COSTS.shot_frame, total: 6 * GENERATION_COSTS.shot_frame },
      { label: 'reel shoots', count: 2, each: GENERATION_COSTS.shoot_reel, total: 2 * GENERATION_COSTS.shoot_reel },
    ])
    const text = costTableText(lines, 500)
    const grand = lines.reduce((sum, line) => sum + line.total, 0)
    expect(text).toContain(`Total: ${credits(grand)}. You have ${credits(500)} available.`)
    expect(totalOf(items)).toBe(grand - 2 * GENERATION_COSTS.shoot_reel)
  })
})

describe('shootPlan', () => {
  it('splits the reels into ready, not ready with why, and shot - a reel shooting now is neither', () => {
    const ready = reel(1, 1, { sheet: sheetDone(1) })
    const noSheet = reel(2, 1)
    const shotAlready = reel(3, 1, { sheet: sheetDone(3), clip: { id: uid('clip', 3) as never, reelId: uid('reel', 3) as never, state: 'rendered', version: 1, poster: null, video: null, creditsSpent: 375, generationId: null, createdAt: '' } })
    const shooting = reel(4, 2, { sheet: sheetDone(4) })
    const scenes = [scene(1, [ready, noSheet, shotAlready]), scene(2, [shooting], { cast: [member(2, 'ARJUN', false)] })]
    const plan = shootPlan(scenes, new Set([uid('reel', 4)]))
    expect(plan.ready).toEqual([{ reelId: uid('reel', 1), label: 'Reel 1, scene 1' }])
    expect(plan.waiting).toEqual([{ reelId: uid('reel', 2), label: 'Reel 2, scene 1', failed: ['sheet'] }])
    expect(plan.shot).toBe(1)
  })
})
