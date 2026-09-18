// @vitest-environment node
import { episodeSlug } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { NO_LOCATION_COUNTS, ieOf, peopleAt, perEpisodeCounts, subtreeOf, sumEighths, treeOrder, wouldCycle } from '../lib/locations/figures'

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

type TreeRow = { readonly id: LocationId; readonly name: string; readonly parentId: LocationId | null; readonly rollup: typeof NO_LOCATION_COUNTS }

/** What the tree walk reads of a row: the edge and the weight. */
const row = (name: string, n: number, parts: { readonly scenes?: number; readonly parentId?: LocationId } = {}): TreeRow => ({
  id: place(n),
  name,
  parentId: parts.parentId ?? null,
  rollup: { ...NO_LOCATION_COUNTS, scenes: parts.scenes ?? 0 },
})

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
  words: 0,
  cast: [],
  speaking: [],
  mentioned: [],
  episode: episodeSlug(`ep_${String(episodeOrdinal).padStart(3, '0')}`),
  episodeOrdinal,
  ie: 'INT',
  light: 'day',
  timeOfDay: 'DAY',
  ...parts,
})

describe('treeOrder', () => {
  it('lists each primary set by weight, followed by its sub-sets by weight', () => {
    const chawl = row('Kamathi Chawl', 1, { scenes: 18 })
    const corridor = row('Corridor', 2, { parentId: chawl.id, scenes: 6 })
    const courtyard = row('Courtyard', 3, { parentId: chawl.id, scenes: 5 })
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

describe('perEpisodeCounts', () => {
  it('gives every episode a slot, zero included - the README’s episode bars', () => {
    const e1 = [indexRow(1, 1), indexRow(1, 2), indexRow(1, 3)]
    const e2 = [indexRow(2, 1)]
    const index = [...e1, ...e2]
    const here = new Set<NodeId>([e1[0]?.sceneNodeId as NodeId, e1[1]?.sceneNodeId as NodeId])
    expect(perEpisodeCounts([{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }], index, here)).toEqual([2, 0, 0])
  })
})

describe('peopleAt', () => {
  it('counts scenes per character at the set, most first, everyone, named from the cast; a limit cuts the list', () => {
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
      { id: kadam, name: 'Kadam', hue: 3, scenes: 1 },
    ])
    expect(peopleAt(rows, here, people, 3).map((row) => row.name)).toEqual(['Meera', 'Anil', 'Farida'])
  })
})
