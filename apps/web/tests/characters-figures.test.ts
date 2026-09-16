import type { CharacterMap, MapColumn } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_COLOR_IDS, CharacterColorSchema, hueOfColor } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { buildMap, factsLine, formatSceneRef, initialOf, sceneRefOf, sharedScenes } from '../lib/characters/figures'

/**
 * The Characters route's figures - the scene ref, the shared count, the map
 * the v2 graph draws (`tests/characters-cast.test.ts` has that geometry). Every
 * one a pure function over derived rows; nothing here reads a node or
 * calls a model.
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

  it('prints a scene ref as E{episode} Sc {rank in episode}', () => {
    const row: SceneIndexRow = {
      sceneNodeId: node(1),
      number: 14,
      ordinalInEpisode: 3,
      heading: 'INT. WARD OFFICE - DAY',
      locationId: null,
      lines: 4,
      cast: [],
      speaking: [],
      episode: 'ep_002' as SceneIndexRow['episode'],
      episodeOrdinal: 2,
      ie: 'INT',
      light: 'day',
      timeOfDay: 'DAY',
    }
    expect(formatSceneRef(sceneRefOf(row))).toBe('E2 Sc 3')
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
})
