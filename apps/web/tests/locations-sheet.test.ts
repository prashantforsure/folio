// @vitest-environment node
import type { LocationRow, LocationSceneRow, SceneRef } from '@folio/contracts'
import { episodeSlug } from '@folio/contracts'
import type { InteriorExterior, Light, LocationId } from '@folio/script'
import { NO_QUADRANT, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { NO_LOCATION_COUNTS } from '../lib/locations/figures'
import { breakdownCsvOf, csvOf, defaultDirection, scopeOf, sortRows, totalsOf } from '../lib/locations/sheet'

/**
 * The Sheet view's arithmetic - sort, episode scope, totals, CSV - over
 * location rows. Node environment: nothing here renders.
 */

const place = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const ref = (episodeOrdinal: number, number: number): SceneRef => ({
  sceneNodeId: nodeId(`00000000-0000-4000-8000-${String(episodeOrdinal * 100 + number).padStart(12, '0')}`),
  episode: episodeSlug(`ep_${String(episodeOrdinal).padStart(3, '0')}`),
  episodeOrdinal,
  number,
  heading: 'INT. SOMEWHERE - DAY',
})

const scene = (episodeOrdinal: number, number: number, ie: InteriorExterior, light: Light, eighths: number | null, at: LocationRow): LocationSceneRow => ({
  scene: ref(episodeOrdinal, number),
  ie,
  light,
  timeOfDay: light === 'unspecified' ? null : light.toUpperCase(),
  storyDay: null,
  storyClock: null,
  flashback: false,
  gist: null,
  cast: [],
  eighths,
  at: { id: at.id, name: at.name },
})

const row = (name: string, n: number, parts: Partial<LocationRow> = {}): LocationRow => ({
  id: place(n),
  name,
  parentId: null,
  parent: null,
  depth: 0,
  ie: 'INT',
  presence: 'present',
  kind: 'recurring',
  own: NO_LOCATION_COUNTS,
  rollup: NO_LOCATION_COUNTS,
  children: 0,
  status: 'pending',
  address: null,
  description: null,
  scheduledDays: 0,
  photoUrl: null,
  sluglines: [],
  boundSluglines: [],
  bound: [],
  intro: null,
  quadrant: NO_QUADRANT,
  rollupQuadrant: NO_QUADRANT,
  clips: [],
  similar: [],
  scenes: [],
  people: [],
  perEpisode: [],
  eighths: null,
  firstSeen: null,
  lastSeen: null,
  nameHeadings: 0,
  conflicts: [],
  ...parts,
})

const withScenes = (base: LocationRow, scenes: readonly LocationSceneRow[]): LocationRow => {
  const quadrant = {
    intDay: scenes.filter((s) => s.ie === 'INT' && s.light === 'day').length,
    intNight: scenes.filter((s) => s.ie === 'INT' && s.light === 'night').length,
    extDay: scenes.filter((s) => s.ie !== 'INT' && s.light === 'day').length,
    extNight: scenes.filter((s) => s.ie !== 'INT' && s.light === 'night').length,
    unlit: scenes.filter((s) => s.light === 'unspecified').length,
  }
  const measured = scenes.filter((s) => s.eighths !== null)
  return {
    ...base,
    scenes,
    rollup: { ...NO_LOCATION_COUNTS, scenes: scenes.length, dayScenes: quadrant.intDay + quadrant.extDay, nightScenes: quadrant.intNight + quadrant.extNight, shootingDays: base.rollup.shootingDays },
    quadrant,
    rollupQuadrant: quadrant,
    eighths: measured.length === 0 ? null : measured.reduce((sum, s) => sum + (s.eighths ?? 0), 0),
    firstSeen: scenes[0]?.scene ?? null,
    lastSeen: scenes.at(-1)?.scene ?? null,
    perEpisode: [1, 2].map((ordinal) => scenes.filter((s) => s.scene.episodeOrdinal === ordinal).length),
  }
}

const chawlBase = row('KAMATHI CHAWL', 1, { kind: 'primary', children: 1, scheduledDays: 2, rollup: { ...NO_LOCATION_COUNTS, shootingDays: 5 } })
const chawl = withScenes(chawlBase, [
  scene(1, 1, 'INT', 'day', 2, chawlBase),
  scene(1, 5, 'EXT', 'night', 5, chawlBase),
  scene(2, 3, 'INT', 'night', null, chawlBase),
])
const corridor = withScenes(row('CORRIDOR', 2, { kind: 'sub', parentId: chawl.id, parent: { id: chawl.id, name: chawl.name }, depth: 1, scheduledDays: 3, rollup: { ...NO_LOCATION_COUNTS, shootingDays: 3 } }), [
  scene(2, 3, 'INT', 'night', null, chawlBase),
])
const tanker = withScenes(row('WATER TANKER STAND', 3, { ie: 'EXT', status: 'scouted' }), [scene(1, 3, 'EXT', 'day', 6, chawlBase), scene(1, 9, 'EXT', 'unspecified', 1, chawlBase)])
const ward = row('WARD OFFICE', 4, { kind: 'off-page', presence: 'absent', ie: null })

describe('scopeOf', () => {
  it('reads the whole run off the roll-up, and one episode off the scene list', () => {
    expect(scopeOf(chawl, null)).toMatchObject({ scenes: 3, day: 1, night: 2, eighths: 7 })
    expect(scopeOf(chawl, 1)).toMatchObject({ scenes: 2, day: 1, night: 1, eighths: 7, quadrant: { intDay: 1, extNight: 1 } })
    expect(scopeOf(chawl, 2)).toMatchObject({ scenes: 1, night: 1, eighths: null })
    expect(scopeOf(chawl, 2).first?.number).toBe(3)
    expect(scopeOf(ward, null)).toMatchObject({ scenes: 0, eighths: null, first: null, last: null })
  })

  it('counts an unlit heading in neither day nor night', () => {
    expect(scopeOf(tanker, 1)).toMatchObject({ day: 1, night: 0, quadrant: { unlit: 1 } })
  })
})

describe('sortRows', () => {
  const rows = [ward, tanker, corridor, chawl]

  it('sorts scenes descending by default and names ascending, empties last', () => {
    expect(sortRows(rows, 'scenes', 'desc', null).map((r) => r.name)).toEqual(['KAMATHI CHAWL', 'WATER TANKER STAND', 'CORRIDOR', 'WARD OFFICE'])
    expect(sortRows(rows, 'name', 'asc', null).map((r) => r.name)).toEqual(['CORRIDOR', 'KAMATHI CHAWL', 'WARD OFFICE', 'WATER TANKER STAND'])
    expect(sortRows(rows, 'pages', 'asc', null).map((r) => r.name)).toEqual(['KAMATHI CHAWL', 'WATER TANKER STAND', 'CORRIDOR', 'WARD OFFICE'])
    expect(sortRows(rows, 'days', 'desc', null).map((r) => r.name)).toEqual(['KAMATHI CHAWL', 'CORRIDOR', 'WARD OFFICE', 'WATER TANKER STAND'])
  })

  it('scopes the sort to one episode', () => {
    expect(sortRows(rows, 'scenes', 'desc', 2).map((r) => r.name)).toEqual(['CORRIDOR', 'KAMATHI CHAWL', 'WARD OFFICE', 'WATER TANKER STAND'])
  })

  it('starts names and kinds ascending, counts descending', () => {
    expect(defaultDirection('name')).toBe('asc')
    expect(defaultDirection('first')).toBe('asc')
    expect(defaultDirection('scenes')).toBe('desc')
    expect(defaultDirection('e1')).toBe('desc')
  })
})

describe('totalsOf', () => {
  it('totals over the primary sets, so a sub-set’s scene is counted once', () => {
    const totals = totalsOf([chawl, corridor, tanker, ward], null, [1, 2])
    expect(totals).toEqual({ scenes: 5, day: 2, night: 2, eighths: 14, days: 5, perEpisode: [4, 1] })
  })

  it('counts a sub-set for itself when its parent is not on the sheet', () => {
    expect(totalsOf([corridor, tanker], null, [1, 2]).scenes).toBe(3)
  })
})

describe('csvOf', () => {
  it('writes the header, one row per record as shown, RFC 4180 line ends and quoting', () => {
    const csv = csvOf([chawl, corridor], null, [1, 2])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Location,Part of,Type,Status,Address,Scenes,INT/EXT,INT D,INT N,EXT D,EXT N,Unlit,Pages,Shooting days,Roll-up days,Cast,E1,E2,First,Last,Sluglines')
    expect(lines[1]).toBe('KAMATHI CHAWL,,Primary set,Pending,,3,INT,1,1,0,1,0,0 7/8,2,5,,2,1,E1 Sc 1,E2 Sc 3,')
    expect(lines[2]).toBe('CORRIDOR,KAMATHI CHAWL,Inside KAMATHI CHAWL,Pending,,1,INT,0,1,0,0,0,,3,3,,0,1,E2 Sc 3,E2 Sc 3,')
    expect(csv.endsWith('\r\n')).toBe(true)
    const quoted = csvOf([row('A "PLACE", SAID', 9, { address: 'Line 1, line 2' })], null, [])
    expect(quoted.split('\r\n')[1]?.startsWith('"A ""PLACE"", SAID",,Recurring interior,Pending,"Line 1, line 2"')).toBe(true)
  })

  it('writes one set’s breakdown, a row per scene', () => {
    const lines = breakdownCsvOf(tanker).split('\r\n')
    expect(lines[0]).toBe('Scene,INT/EXT,Light,Time of day,Story day,Clock,Flashback,Heading,Set,Synopsis,Cast,Eighths')
    expect(lines[1]).toBe('E1 Sc 3,EXT,day,DAY,,,,INT. SOMEWHERE - DAY,KAMATHI CHAWL,,,6')
    expect(lines[2]).toBe('E1 Sc 9,EXT,,,,,,INT. SOMEWHERE - DAY,KAMATHI CHAWL,,,1')
  })
})
