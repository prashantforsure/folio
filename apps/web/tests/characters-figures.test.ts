import type { CharacterMap, MapColumn, SceneRef } from '@folio/contracts'
import type { LocationId } from '@folio/script'
import { locationId } from '@folio/script'
import { CHARACTER_COLORS, CHARACTER_COLOR_IDS, CharacterColorSchema, hueOfColor, projectId } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { buildMap, citeOf, factsLine, formatSceneRef, initialOf, sceneFactsOf, sceneRefOf, sharedScenes, subMap } from '../lib/characters/figures'

/**
 * The Characters route's figures - the scene ref and the scene facts, the
 * shared count, the map the Presence view's pairs read. Every one a pure
 * function over derived rows; nothing here reads a node or calls a model.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const column = (n: number, lines: number, scenes: number): MapColumn => ({
  id: person(n),
  name: `Person ${String(n)}`,
  hue: n,
  lines,
  scenes,
})

describe('colours', () => {
  it('names every one of the ten tokens exactly once', () => {
    expect(CHARACTER_COLORS.map((color) => color.id)).toEqual([...CHARACTER_COLOR_IDS])
    expect(new Set(CHARACTER_COLORS.map((color) => color.hue)).size).toBe(10)
    expect(CHARACTER_COLORS.map((color) => color.hue)).toEqual(CHARACTER_COLORS.map((_, index) => index + 1))
  })

  it('reads a token as its --chip-N index, and an unknown one as the first', () => {
    expect(hueOfColor('chip-7')).toBe(7)
    expect(hueOfColor('not-a-token')).toBe(1)
    expect(CharacterColorSchema.safeParse('chip-11').success).toBe(false)
    expect(CharacterColorSchema.safeParse('chip-10').success).toBe(true)
  })
})

describe('marks and lines', () => {
  it('takes the first character of the name as the initial', () => {
    expect(initialOf('Meera Pawar')).toBe('M')
    expect(initialOf('  suresh')).toBe('S')
    expect(initialOf('')).toBe('·')
  })

  it('prints the facts line and skips what is unset', () => {
    expect(factsLine({ gender: 'Female', age: '17', role: 'student' })).toBe('Female · 17 y/o · student')
    expect(factsLine({ gender: null, age: '40s', role: null })).toBe('40s')
    expect(factsLine({ gender: null, age: null, role: null })).toBe('')
  })

  const indexRow: SceneIndexRow = {
    sceneNodeId: node(1),
    number: 14,
    ordinalInEpisode: 3,
    heading: 'INT. WARD OFFICE - DAY',
    locationId: locationId('20000000-0000-4000-8000-000000000001') as LocationId,
    lines: 4,
    words: 31,
    cast: [person(1), person(2)],
    speaking: [person(1)],
    mentioned: [person(1), person(2)],
    episode: 'ep_002' as SceneIndexRow['episode'],
    episodeOrdinal: 2,
    ie: 'INT',
    light: 'day',
    timeOfDay: 'DAY',
  }

  it('prints a scene ref as E{episode} Sc {rank in episode}', () => {
    expect(formatSceneRef(sceneRefOf(indexRow))).toBe('E2 Sc 3')
  })

  it('reads the scene facts: the set by name, the mentioned disjoint from the speaking, the eighths or null', () => {
    const sets = new Map<LocationId, string>([[indexRow.locationId as LocationId, 'Ward Office']])
    const facts = sceneFactsOf(indexRow, new Map([[node(1), 6]]), sets)
    expect(facts.set).toEqual({ id: indexRow.locationId, name: 'Ward Office' })
    expect(facts.speaking).toEqual([person(1)])
    expect(facts.mentioned).toEqual([person(2)])
    expect(facts.eighths).toBe(6)
    expect(facts.words).toBe(31)
    expect(facts.light).toBe('day')
    const bare = sceneFactsOf({ ...indexRow, locationId: null }, new Map(), sets)
    expect(bare.set).toBeNull()
    expect(bare.eighths).toBeNull()
    // A set the location records no longer hold is no set.
    expect(sceneFactsOf(indexRow, new Map(), new Map()).set).toBeNull()
  })

  it('counts shared scenes regardless of order', () => {
    expect(sharedScenes([node(1), node(2), node(3)], [node(3), node(1)])).toBe(2)
    expect(sharedScenes([], [node(1)])).toBe(0)
  })
})

const map: CharacterMap = buildMap(
  [column(1, 40, 3), column(2, 10, 2), column(3, 0, 1)],
  new Map<CharacterId, readonly NodeId[]>([
    [person(1), [node(1), node(2), node(3)]],
    [person(2), [node(2), node(3)]],
    [person(3), [node(9)]],
  ]),
)

describe('the map', () => {
  it('has the own count on the diagonal and shared scenes elsewhere', () => {
    expect(map.cells).toEqual([
      [3, 2, 0],
      [2, 2, 0],
      [0, 0, 1],
    ])
  })

  it('subMap keeps the diagonal of the kept columns and re-indexes the cells', () => {
    const narrowed = subMap(map, new Set([person(1), person(3)]))
    expect(narrowed.columns.map((column) => column.id)).toEqual([person(1), person(3)])
    expect(narrowed.cells).toEqual([
      [3, 0],
      [0, 1],
    ])
    expect(subMap(map, new Set()).cells).toEqual([])
  })
})

describe('citations', () => {
  const ref: SceneRef = { sceneNodeId: node(4), episode: 'ep_002' as SceneRef['episode'], episodeOrdinal: 2, number: 9, heading: 'INT. CHAWL - NIGHT' }

  it('points at the episode script with the heading fragment', () => {
    expect(citeOf(projectId('p1'), 'episodic', ref)).toEqual({
      label: 'E2 Sc 9',
      href: `/app/project/p1/ep_002/script#n-${node(4)}`,
    })
    expect(citeOf(projectId('p1'), 'collapsed', ref).href).toBe(`/app/project/p1/script#n-${node(4)}`)
  })
})
