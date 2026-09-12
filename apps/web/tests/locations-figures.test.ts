// @vitest-environment node
import type { LocationRow } from '@folio/contracts'
import { episodeSlug } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  NO_LOCATION_COUNTS,
  dayNightSplit,
  ieOf,
  kindOf,
  peopleAt,
  perEpisodeCells,
  subtreeOf,
  sumEighths,
  treeOrder,
  wouldCycle,
} from '../lib/locations/figures'

/**
 * The Locations route's figures. Each is arithmetic over derived rows or a
 * walk over the authored tree, and each test says which line of the bundle
 * it prints.
 *
 * Node environment: nothing here renders (`apps/web/CLAUDE.md`, trap 1).
 */

let counter = 0
const scene = (): NodeId => nodeId(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const place = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const row = (
  name: string,
  n: number,
  parts: Partial<LocationRow> & { readonly scenes?: number; readonly day?: number; readonly night?: number } = {},
): LocationRow => {
  const { scenes = 0, day = 0, night = 0, ...rest } = parts
  const counts = { ...NO_LOCATION_COUNTS, scenes, dayScenes: day, nightScenes: night }
  return {
    id: place(n),
    name,
    parentId: null,
    depth: 0,
    ie: 'INT',
    presence: scenes > 0 ? 'present' : 'absent',
    own: counts,
    rollup: counts,
    children: 0,
    ...rest,
  }
}

const indexRow = (
  episodeOrdinal: number,
  ordinalInEpisode: number,
  parts: Partial<SceneIndexRow> = {},
): SceneIndexRow => ({
  sceneNodeId: scene(),
  number: ordinalInEpisode,
  ordinalInEpisode,
  heading: 'INT. SOMEWHERE - DAY',
  locationId: null,
  lines: 0,
  cast: [],
  speaking: [],
  episode: episodeSlug(`ep_${String(episodeOrdinal).padStart(3, '0')}`),
  episodeOrdinal,
  ie: 'INT',
  light: 'day',
  timeOfDay: 'DAY',
  ...parts,
})

describe('treeOrder', () => {
  it('lists each primary set by weight, followed by its sub-sets by weight', () => {
    const chawl = row('Kamathi Chawl', 1, { scenes: 18, children: 2 })
    const corridor = row('Corridor', 2, { parentId: chawl.id, depth: 1, scenes: 6 })
    const courtyard = row('Courtyard', 3, { parentId: chawl.id, depth: 1, scenes: 5 })
    const tanker = row('Water tanker stand', 4, { scenes: 6 })
    const ward = row('Ward office', 5, { scenes: 3 })
    const ordered = treeOrder([ward, courtyard, tanker, corridor, chawl])
    expect(ordered.map((entry) => entry.name)).toEqual([
      'Kamathi Chawl',
      'Corridor',
      'Courtyard',
      'Water tanker stand',
      'Ward office',
    ])
  })

  it('lists a record whose parent is gone as a root, and never loses a cycle', () => {
    const orphan = row('Orphan', 1, { parentId: place(99), scenes: 2 })
    const a = row('A', 2, { parentId: place(3), scenes: 1 })
    const b = row('B', 3, { parentId: place(2), scenes: 1 })
    const ordered = treeOrder([orphan, a, b])
    expect(ordered.map((entry) => entry.name).sort()).toEqual(['A', 'B', 'Orphan'])
    expect(ordered[0]?.name).toBe('Orphan')
  })
})

describe('subtreeOf and wouldCycle', () => {
  const chawl = row('Kamathi Chawl', 1)
  const corridor = row('Corridor', 2, { parentId: chawl.id })
  const alcove = row('Alcove', 3, { parentId: corridor.id })
  const ward = row('Ward office', 4)
  const rows = [chawl, corridor, alcove, ward]

  it('walks every level down', () => {
    expect([...subtreeOf(chawl.id, rows)].sort()).toEqual([chawl.id, corridor.id, alcove.id].sort())
    expect([...subtreeOf(ward.id, rows)]).toEqual([ward.id])
  })

  it('refuses a parent inside the record’s own subtree, and allows any other', () => {
    expect(wouldCycle(chawl.id, alcove.id, rows)).toBe(true)
    expect(wouldCycle(chawl.id, chawl.id, rows)).toBe(true)
    expect(wouldCycle(alcove.id, ward.id, rows)).toBe(false)
    expect(wouldCycle(chawl.id, null, rows)).toBe(false)
  })
})

describe('ieOf', () => {
  it('reads INT, EXT, or INT/EXT when both occur; null with no heading', () => {
    expect(ieOf([])).toBeNull()
    expect(ieOf(['INT', 'INT'])).toBe('INT')
    expect(ieOf(['EXT'])).toBe('EXT')
    expect(ieOf(['INT', 'EXT'])).toBe('INT/EXT')
    expect(ieOf(['INT', 'INT/EXT'])).toBe('INT/EXT')
    expect(ieOf(['EST', 'EXT'])).toBe('EXT')
    expect(ieOf(['EST'])).toBe('EST')
  })
})

describe('kindOf', () => {
  it('prints the bundle’s kind line from the tree and the count', () => {
    expect(kindOf(row('Kamathi Chawl', 1, { scenes: 18, children: 5 }))).toBe('Primary set · 5 sub-locations')
    expect(kindOf(row('Corridor', 2, { parentId: place(1), scenes: 6 }))).toBe('Sub-location')
    expect(kindOf(row('Kadam’s office', 3, { scenes: 4, ie: 'INT' }))).toBe('Recurring interior')
    expect(kindOf(row('Tanker stand', 4, { scenes: 6, ie: 'EXT' }))).toBe('Recurring exterior')
    expect(kindOf(row('Rooftop', 5, { scenes: 1, ie: 'EXT' }))).toBe('Single exterior')
    expect(kindOf(row('Gone', 6))).toBe('0 scenes · record kept')
  })
})

describe('dayNightSplit', () => {
  it('leaves an unspecified heading to the track rather than folding it into day', () => {
    expect(dayNightSplit({ scenes: 4, dayScenes: 2, nightScenes: 1 })).toEqual({ day: 0.5, night: 0.25, unspecified: 0.25 })
    expect(dayNightSplit({ scenes: 0, dayScenes: 0, nightScenes: 0 })).toEqual({ day: 0, night: 0, unspecified: 0 })
  })
})

describe('sumEighths', () => {
  it('sums what the measurement knows and is null when it knows nothing', () => {
    const a = scene()
    const b = scene()
    const c = scene()
    const measured = new Map<NodeId, number>([
      [a, 10],
      [b, 3],
    ])
    expect(sumEighths([a, b, c], measured)).toBe(13)
    expect(sumEighths([c], measured)).toBeNull()
    expect(sumEighths([], measured)).toBeNull()
  })
})

describe('perEpisodeCells', () => {
  it('gives every episode a cell, zero included, with the day/night split and the pages', () => {
    const e1 = [indexRow(1, 1, { light: 'day' }), indexRow(1, 2, { light: 'night' }), indexRow(1, 3, { light: 'unspecified' })]
    const e2 = [indexRow(2, 1, { light: 'day' })]
    const index = [...e1, ...e2]
    const here = new Set<NodeId>([e1[0]?.sceneNodeId as NodeId, e1[1]?.sceneNodeId as NodeId])
    const eighths = new Map<NodeId, number>([[e1[0]?.sceneNodeId as NodeId, 12]])
    const episodes = [
      { slug: episodeSlug('ep_001'), ordinal: 1 },
      { slug: episodeSlug('ep_002'), ordinal: 2 },
    ]
    expect(perEpisodeCells(episodes, index, here, eighths)).toEqual([
      { episode: 'ep_001', ordinal: 1, scenes: 2, dayScenes: 1, nightScenes: 1, eighths: 12 },
      { episode: 'ep_002', ordinal: 2, scenes: 0, dayScenes: 0, nightScenes: 0, eighths: null },
    ])
  })
})

describe('peopleAt', () => {
  it('counts scenes per character at the set, most first, top three, named from the cast', () => {
    const meera = person(1)
    const anil = person(2)
    const kadam = person(3)
    const farida = person(4)
    const rows = [
      indexRow(1, 1, { cast: [meera, anil] }),
      indexRow(1, 2, { cast: [meera, kadam] }),
      indexRow(1, 3, { cast: [meera, anil, farida] }),
      indexRow(1, 4, { cast: [farida] }),
    ]
    const here = new Set(rows.slice(0, 3).map((entry) => entry.sceneNodeId))
    const people = new Map<CharacterId, { name: string; hue: number }>([
      [meera, { name: 'Meera', hue: 1 }],
      [anil, { name: 'Anil', hue: 2 }],
      [kadam, { name: 'Kadam', hue: 3 }],
      [farida, { name: 'Farida', hue: 4 }],
    ])
    expect(peopleAt(rows, here, people)).toEqual([
      { id: meera, name: 'Meera', hue: 1, scenes: 3 },
      { id: anil, name: 'Anil', hue: 2, scenes: 2 },
      { id: farida, name: 'Farida', hue: 4, scenes: 1 },
    ])
  })
})
