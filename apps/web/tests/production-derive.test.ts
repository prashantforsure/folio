import type { ProductionCastMember, ProductionScene, Reel, ReelShot } from '@folio/contracts'
import { describe, expect, it } from 'vitest'

import { cameraLine, cameraString, secondsLabel, sheetCameraNote, sheetHeading } from '../lib/production/camera'
import {
  clampRetime,
  firstSelection,
  hasClip,
  missingAppearances,
  readinessOf,
  reelTiming,
  sceneDot,
  sceneFacts,
  sceneSummary,
  segmentTone,
  shotClocks,
  shotStatusOf,
  usedSeconds,
} from '../lib/production/derive'
import { fieldMatches, hideAllLabel, reorderFields, tableTemplate, toggleAll } from '../lib/production/fields'
import { filterActive, sortShots, statusPasses, visibleShots } from '../lib/production/filters'
import { acceptsFreeText, filterItems, menuItems, showsSearch, usedValues } from '../lib/production/menus'

const id = (n: number, kind = 'shot'): never => `${kind}-${String(n)}` as never

const shot = (over: Partial<ReelShot> & { readonly n: number }): ReelShot => ({
  id: id(over.n),
  reelId: id(1, 'reel'),
  number: over.n,
  position: String(over.n * 1000),
  title: null,
  durationS: 4,
  status: null,
  shotType: 'Wide angle',
  cameraAngle: 'Eye level',
  cameraMotion: 'Still',
  cameraBody: 'ARRI Alexa Mini LF',
  lens: '24mm T2.8',
  description: 'The cage under the floodlights.',
  parts: [{ kind: 'text', text: 'The cage under the floodlights.', characterId: null }],
  dialogue: null,
  proposed: false,
  blocked: false,
  blockReason: null,
  propId: null,
  locationId: null,
  intExt: null,
  shootDate: null,
  notes: null,
  assigneeId: null,
  priority: 'none',
  frameState: 'empty',
  frame: null,
  frameProgress: null,
  frameKept: false,
  takeIndex: null,
  characters: [],
  references: [],
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
  ...over,
})

const reel = (shots: readonly ReelShot[], over: Partial<Reel> = {}): Reel => ({
  id: id(1, 'reel'),
  sceneNodeId: id(1, 'scene'),
  name: 'Reel 1',
  clipLengthS: 15,
  continuity: 'natural',
  status: 'writing',
  finalized: false,
  position: '1000',
  shots,
  sheet: null,
  clip: null,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
  ...over,
})

const member = (name: string, appearanceReady: boolean): ProductionCastMember => ({
  id: id(name.length, 'char'),
  name,
  initials: name.slice(0, 2).toUpperCase(),
  hue: 1,
  portraitUrl: appearanceReady ? 'https://cdn/portrait.png' : null,
  appearanceReady,
})

const scene = (reels: readonly Reel[], over: Partial<ProductionScene> = {}): ProductionScene => ({
  sceneNodeId: id(1, 'scene'),
  number: 1,
  heading: 'EXT. COMMUNITY PITCH – DUSK',
  set: 'COMMUNITY PITCH',
  locationId: null,
  locationName: 'Community pitch',
  intExt: 'EXT',
  timeOfDay: 'DUSK',
  logline: 'The cage under the floodlights.',
  cast: [member('Ade', true), member('Old man', false)],
  plateReady: true,
  still: null,
  stillState: 'drawn',
  setup: { cameraBody: null, lens: null, propId: null, locationId: null, intExt: null, shootDate: null, priority: null, note: null },
  reels,
  ...over,
})

describe('shot status derivation (§6)', () => {
  it('follows the spec order: override, refused, proposed, then the frame', () => {
    expect(shotStatusOf(shot({ n: 1, status: 'drawn', blocked: true, blockReason: 'x' }))).toBe('drawn')
    expect(shotStatusOf(shot({ n: 1, blocked: true, blockReason: 'x', proposed: true }))).toBe('refused')
    expect(shotStatusOf(shot({ n: 1, proposed: true, frameState: 'drawn' }))).toBe('proposed')
    expect(shotStatusOf(shot({ n: 1, frameState: 'gen' }))).toBe('generating')
    expect(shotStatusOf(shot({ n: 1, frameState: 'queued' }))).toBe('queued')
    expect(shotStatusOf(shot({ n: 1, frameState: 'stale' }))).toBe('out_of_date')
    expect(shotStatusOf(shot({ n: 1, frameState: 'uploaded' }))).toBe('drawn')
    expect(shotStatusOf(shot({ n: 1, frameState: 'ready' }))).toBe('to_draw')
    expect(shotStatusOf(shot({ n: 1, frameState: 'failed' }))).toBe('to_draw')
  })
})

describe('timing (§3.1–3.2)', () => {
  const full = reel([shot({ n: 1, durationS: 4 }), shot({ n: 2, durationS: 3 }), shot({ n: 3, durationS: 5 }), shot({ n: 4, durationS: 3 })])

  it('counts used seconds without proposals and is ok when equal', () => {
    expect(usedSeconds(full)).toBe(15)
    const timing = reelTiming(full)
    expect(timing.tone).toBe('ok')
    expect(timing.segments.map((segment) => segment.width)).toEqual(['26.67%', '20.00%', '33.33%', '20.00%'])
    expect(timing.rest).toBe(0)
  })

  it('is dim under, red over, and hatches a proposal into the denominator', () => {
    const under = reel([shot({ n: 1, durationS: 4 }), shot({ n: 2, durationS: 3 }), shot({ n: 3, durationS: 3, proposed: true })], { clipLengthS: 10 })
    const timing = reelTiming(under)
    expect(timing.used).toBe(7)
    expect(timing.tone).toBe('dim')
    expect(timing.segments[2]?.proposed).toBe(true)
    expect(timing.rest).toBe(0)
    const over = reel([shot({ n: 1, durationS: 8 }), shot({ n: 2, durationS: 8 })], { clipLengthS: 10 })
    expect(reelTiming(over).tone).toBe('bad')
    expect(reelTiming(over).segments[0]?.width).toBe('50.00%')
    const empty = reel([], { clipLengthS: 15 })
    expect(reelTiming(empty)).toMatchObject({ rest: 15, restWidth: '100.00%', tone: 'dim' })
  })

  it('clamps a retime to 1 … min(clip, 15) − others, whole seconds', () => {
    expect(clampRetime(full, id(3), 9.6)).toBe(5)
    expect(clampRetime(full, id(3), 0)).toBe(1)
    const loose = reel([shot({ n: 1, durationS: 2 }), shot({ n: 2, durationS: 2 })], { clipLengthS: 8 })
    expect(clampRetime(loose, id(2), 7.4)).toBe(6)
  })

  it('cycles four segment tones and clocks the shots', () => {
    expect([0, 1, 2, 3, 4].map(segmentTone)).toEqual(['seg-1', 'seg-2', 'seg-3', 'seg-4', 'seg-1'])
    expect(shotClocks(full).map((clock) => `${String(clock.from)}–${String(clock.to)}`)).toEqual(['0–4', '4–7', '7–12', '12–15'])
  })
})

describe('readiness (§3.7)', () => {
  const full = reel([shot({ n: 1, durationS: 8 }), shot({ n: 2, durationS: 7 })], {
    sheet: { id: id(1, 'sheet'), reelId: id(1, 'reel'), state: 'done', asset: null, progress: null, generatedAt: null, creditsSpent: 40, artStyleId: null, generationId: null, frames: [] },
  })

  it('fails step 4 on the cast member with no portrait and names them', () => {
    const readiness = readinessOf(scene([full]), full)
    expect(readiness).toMatchObject({ shotlist: true, sheet: true, sceneImage: true, characters: false, canShoot: false, failed: ['characters'] })
    expect(missingAppearances(scene([full])).map((m) => m.name)).toEqual(['Old man'])
  })

  it('passes all four and lists every failing flag in step order', () => {
    const ready = scene([full], { cast: [member('Ade', true)] })
    expect(readinessOf(ready, full).canShoot).toBe(true)
    const bare = reel([], { clipLengthS: 15 })
    expect(readinessOf(scene([bare], { plateReady: false, stillState: 'empty' }), bare).failed).toEqual(['shotlist', 'sheet', 'scene_image', 'characters'])
  })

  it('counts an uploaded still, needs the plate, and says Reshoot once a clip exists', () => {
    expect(readinessOf(scene([full], { stillState: 'uploaded', cast: [] }), full).sceneImage).toBe(true)
    expect(readinessOf(scene([full], { plateReady: false, cast: [] }), full).sceneImage).toBe(false)
    expect(hasClip(full)).toBe(false)
    expect(hasClip(reel([], { clip: { id: id(1, 'clip'), reelId: id(1, 'reel'), state: 'rendered', version: 2, poster: null, video: null, creditsSpent: 375, generationId: null, createdAt: '' } }))).toBe(true)
    expect(hasClip(reel([], { clip: { id: id(1, 'clip'), reelId: id(1, 'reel'), state: 'gate', version: 1, poster: null, video: null, creditsSpent: 0, generationId: null, createdAt: '' } }))).toBe(false)
  })
})

describe('scene-level (§4, §7)', () => {
  it('ranks the status dot and prints the summary and facts', () => {
    expect(sceneDot(scene([]))).toBe('none')
    expect(sceneDot(scene([reel([shot({ n: 1, blocked: true, blockReason: 'x' })], { status: 'generating' })]))).toBe('bad')
    expect(sceneDot(scene([reel([shot({ n: 1, proposed: true })])]))).toBe('warn')
    expect(sceneDot(scene([reel([], { status: 'stale' })]))).toBe('warn')
    expect(sceneDot(scene([reel([], { status: 'generating' })]))).toBe('accent')
    expect(sceneDot(scene([reel([], { status: 'rendered' }), reel([], { status: 'rendered' })]))).toBe('ok')
    expect(sceneDot(scene([reel([], { status: 'rendered' }), reel([])]))).toBe('idle')
    expect(sceneSummary(scene([reel([shot({ n: 1, durationS: 4 }), shot({ n: 2, durationS: 3, proposed: true })])]))).toBe('1 reel · 2 shots · 4 s')
    expect(sceneSummary(scene([]))).toBe('0 reels · 0 shots · 0 s')
    expect(sceneFacts(scene([]))).toBe('EXT · DUSK')
    expect(sceneFacts(scene([], { timeOfDay: null }))).toBe('EXT')
  })

  it('opens on the first scene with reels, else the first', () => {
    const empty = scene([], { sceneNodeId: id(9, 'scene') })
    const withReels = scene([reel([])])
    expect(firstSelection([empty, withReels])).toEqual({ sceneNodeId: id(1, 'scene'), reelId: id(1, 'reel') })
    expect(firstSelection([empty])).toEqual({ sceneNodeId: id(9, 'scene'), reelId: null })
    expect(firstSelection([])).toBeNull()
  })
})

describe('camera lines', () => {
  const s = shot({ n: 1, shotType: 'Medium', cameraAngle: 'Eye level', cameraMotion: 'Handheld', cameraBody: 'ARRI Alexa Mini LF', lens: '35mm T2.0' })
  it('prints the card line, the drawer string and the sheet notes as the mockup does', () => {
    expect(cameraLine(s)).toBe('ARRI Alexa Mini LF, 35mm T2.0 — medium, eye level, handheld')
    expect(cameraLine({ ...s, cameraBody: '', lens: '' })).toBe('medium, eye level, handheld')
    expect(cameraString(s)).toBe('Medium · Eye level · Handheld · ARRI Alexa Mini LF · 35mm T2.0')
    expect(sheetHeading(1, s)).toBe('2. MEDIUM – HANDHELD')
    expect(sheetCameraNote({ cameraBody: 'ARRI Alexa Mini LF', lens: '' })).toBe('ARRI Alexa Mini LF · lens tbd')
    expect(secondsLabel(4)).toBe('4 s')
    expect(secondsLabel(null)).toBe('— s')
  })
})

describe('filter & sort (§2.5)', () => {
  const shots = [
    shot({ n: 1, durationS: 4, frameState: 'drawn' }),
    shot({ n: 2, durationS: 3, frameState: 'ready', assigneeId: id(7, 'user') }),
    shot({ n: 3, durationS: 5, proposed: true }),
    shot({ n: 4, durationS: 3, frameState: 'queued' }),
  ]
  it('matches the three filters and the unassigned toggle', () => {
    expect(statusPasses('queued', 'todraw')).toBe(true)
    expect(statusPasses('drawn', 'todraw')).toBe(false)
    expect(statusPasses('proposed', 'attention')).toBe(true)
    expect(visibleShots(shots, { statusFilter: 'todraw', unassignedOnly: false, sort: 'order' }).map((s) => s.number)).toEqual([2, 4])
    expect(visibleShots(shots, { statusFilter: 'all', unassignedOnly: true, sort: 'order' }).map((s) => s.number)).toEqual([1, 3, 4])
  })
  it('sorts longest first and by the status menu order, stably', () => {
    expect(sortShots(shots, 'longest').map((s) => s.number)).toEqual([3, 1, 2, 4])
    expect(sortShots(shots, 'status').map((s) => s.number)).toEqual([2, 3, 4, 1])
    expect(sortShots(shots, 'order')).toBe(shots)
    expect(filterActive({ statusFilter: 'all', unassignedOnly: false, sort: 'order' })).toBe(false)
    expect(filterActive({ statusFilter: 'all', unassignedOnly: false, sort: 'status' })).toBe(true)
  })
})

describe('fields (§2.4, §4)', () => {
  const all = Object.fromEntries(['title', 'status', 'desc', 'dialogue', 'refs', 'type', 'motion', 'duration', 'cast', 'prop', 'lens', 'date', 'loc', 'intext', 'notes', 'assignee', 'priority'].map((f) => [f, true])) as Record<string, boolean>
  it('drops a hidden column from the table template and flips Hide/Show all', () => {
    // The trailing 140px is the Prop column, added with the Props route - `prop` was in `FIELD_IDS` from the v12 build with no column.
    expect(tableTemplate({ fieldVisibility: all as never })).toBe('56px 200px 130px 140px minmax(220px,1.3fr) 130px 100px 150px 140px 140px')
    expect(tableTemplate({ fieldVisibility: { ...all, desc: false, cast: false } as never })).toBe('56px 200px 130px 140px 130px 100px 140px 140px')
    expect(tableTemplate({ fieldVisibility: { ...all, prop: false } as never })).toBe('56px 200px 130px 140px minmax(220px,1.3fr) 130px 100px 150px 140px')
    expect(hideAllLabel({ fieldVisibility: all as never })).toBe('Hide all')
    const off = toggleAll({ fieldVisibility: all as never })
    expect(Object.values(off).every((v) => !v)).toBe(true)
    expect(hideAllLabel({ fieldVisibility: off })).toBe('Show all')
  })
  it('reorders a field before another or to the end', () => {
    expect(reorderFields(['title', 'status', 'desc'], 'desc', 'title')).toEqual(['desc', 'title', 'status'])
    expect(reorderFields(['title', 'status', 'desc'], 'title', null)).toEqual(['status', 'desc', 'title'])
    expect(fieldMatches('Camera movement', 'move')).toBe(true)
  })
})

describe('menus (§5.3)', () => {
  const context = {
    cast: [member('Ade', true), member('Nia', true)],
    locations: [{ id: 'loc-1', name: 'Community pitch' }],
    members: [{ id: id(1, 'user'), name: 'Ada O.' }],
    // The props table, not "what somebody typed into another shot" - the Props route owns this list since `0030`.
    props: [{ id: 'prop-1', name: 'Flat ball' }],
    usedLenses: ['50mm T2.0', '24mm T2.8'],
  }
  it('lists the spec values with a clearing first item, and merges used values without repeats', () => {
    expect(menuItems('status', context).map((i) => i.label)).toEqual(['To draw', 'Proposed', 'Queued', 'Generating', 'Drawn', 'Out of date', 'Refused'])
    expect(menuItems('duration', context)[0]).toEqual({ value: null, label: 'No duration' })
    expect(menuItems('lens', context).map((i) => i.label)).toEqual(['No lens', '24mm T2.8', '35mm T2.0', '50mm T2.0', '85mm T1.8'])
    expect(menuItems('prop', context).map((i) => i.label)).toEqual(['No prop', 'Flat ball'])
    // A prop item's value is the record's id, so the menu writes `prop_id`, not a name.
    expect(menuItems('prop', context).map((i) => i.value)).toEqual([null, 'prop-1'])
    expect(menuItems('cast', context).map((i) => i.label)).toEqual(['No character', 'Ade', 'Nia'])
    expect(menuItems('priority', context).map((i) => i.value)).toEqual([null, 'low', 'medium', 'high'])
    expect(showsSearch(menuItems('status', context))).toBe(true)
    expect(showsSearch(menuItems('intext', context))).toBe(false)
    expect(filterItems(menuItems('motion', context), 'tr').map((i) => i.label)).toEqual(['Track'])
    // A typed string is no longer a prop: a prop is a record, made on the Props route.
    expect(acceptsFreeText('prop')).toBe(false)
    expect(acceptsFreeText('lens')).toBe(true)
    expect(acceptsFreeText('status')).toBe(false)
  })
  it('collects used lenses across an episode - props come from the table now', () => {
    const scenes = [scene([reel([shot({ n: 1, lens: '85mm T1.8' }), shot({ n: 2, lens: '' })])])]
    expect(usedValues(scenes)).toEqual({ usedLenses: ['85mm T1.8'] })
  })
})
