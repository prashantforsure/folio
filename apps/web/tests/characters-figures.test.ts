// @vitest-environment node
import type { MapColumn } from '@folio/contracts'
import { episodeSlug } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  GAP_SCENES,
  buildMap,
  formatGap,
  formatSceneRef,
  hueOf,
  initialOf,
  perEpisodeBars,
  placesOf,
  presenceGap,
  sceneRefOf,
  sharedScenes,
} from '../lib/characters/figures'

/**
 * The Characters route's figures. Each is arithmetic over derived rows, and
 * each test says which sentence of the bundle it prints.
 *
 * Node environment: nothing here renders (`apps/web/CLAUDE.md`, trap 1).
 */

let counter = 0
const scene = (): NodeId => nodeId(`00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`)
const character = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const location = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const row = (
  episodeOrdinal: number,
  ordinalInEpisode: number,
  parts: Partial<SceneIndexRow> = {},
): SceneIndexRow => ({
  sceneNodeId: scene(),
  number: ordinalInEpisode,
  ordinalInEpisode,
  heading: `INT. SOMEWHERE - DAY`,
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

/** An episode of `n` scenes, the character present at the given ordinals. */
const episode = (ordinal: number, n: number): SceneIndexRow[] =>
  Array.from({ length: n }, (_, at) => row(ordinal, at + 1))

describe('identity marks', () => {
  it('gives the same id the same hue, in 1..6', () => {
    const id = character(7)
    expect(hueOf(id)).toBe(hueOf(id))
    expect(hueOf(id)).toBeGreaterThanOrEqual(1)
    expect(hueOf(id)).toBeLessThanOrEqual(6)
    expect(hueOf('')).toBe(1)
  })

  it('takes the first character of the name as the initial', () => {
    expect(initialOf('Meera Pawar')).toBe('M')
    expect(initialOf('  kadam')).toBe('K')
    expect(initialOf('मीरा')).toBe('म')
    expect(initialOf('')).toBe('·')
  })
})

describe('scene refs', () => {
  it('prints E1 Sc 4 from the rank within the episode, not the project-wide number', () => {
    const entry = row(2, 4, { number: 38 })
    expect(formatSceneRef(sceneRefOf(entry))).toBe('E2 Sc 4')
  })

  it('counts shared scenes regardless of order', () => {
    const [a, b, c] = [scene(), scene(), scene()]
    expect(sharedScenes([a, b], [b, a, c])).toBe(2)
    expect(sharedScenes([], [a])).toBe(0)
  })
})

describe('per-episode bars', () => {
  it('gives every episode a bar, zero included', () => {
    const e1 = episode(1, 3)
    const e2 = episode(2, 2)
    const present = new Set<NodeId>([e1[0]?.sceneNodeId ?? scene(), e1[2]?.sceneNodeId ?? scene()])
    const bars = perEpisodeBars(
      [
        { slug: episodeSlug('ep_001'), ordinal: 1 },
        { slug: episodeSlug('ep_002'), ordinal: 2 },
      ],
      [...e1, ...e2],
      present,
    )
    expect(bars.map((bar) => bar.scenes)).toEqual([2, 0])
  })
})

describe('presence gap', () => {
  it('reports the longest run of absent scenes between two appearances, from the threshold up', () => {
    const e1 = episode(1, 20)
    // In at 5 and 19: absent 6..18, thirteen scenes.
    const present = new Set<NodeId>([e1[4]?.sceneNodeId ?? scene(), e1[18]?.sceneNodeId ?? scene()])
    expect(presenceGap(e1, present)).toEqual({ episodeOrdinal: 1, from: 6, to: 18 })
    expect(formatGap(presenceGap(e1, present))).toBe('gap · E1 Sc 6–18')
  })

  it('is no gap below the threshold, and never counts the run before the first or after the last', () => {
    const e1 = episode(1, 20)
    const present = new Set<NodeId>([e1[0]?.sceneNodeId ?? scene(), e1[GAP_SCENES - 1]?.sceneNodeId ?? scene()])
    // Absent 2..GAP_SCENES-1: GAP_SCENES - 2 scenes, under the threshold.
    expect(presenceGap(e1, present)).toBeNull()
    expect(formatGap(null)).toBe('no gaps')
    // Present only at 1: the eighteen scenes after are not a gap.
    expect(presenceGap(e1, new Set([e1[0]?.sceneNodeId ?? scene()]))).toBeNull()
  })

  it('does not run a gap across an episode boundary', () => {
    const e1 = episode(1, 10)
    const e2 = episode(2, 10)
    const present = new Set<NodeId>([e1[0]?.sceneNodeId ?? scene(), e2[9]?.sceneNodeId ?? scene()])
    expect(presenceGap([...e1, ...e2], present)).toBeNull()
  })
})

describe('places', () => {
  it('counts the character’s scenes per location, most first, three at most', () => {
    const chawl = location(1)
    const office = location(2)
    const stand = location(3)
    const tank = location(4)
    const rows = [
      row(1, 1, { locationId: chawl }),
      row(1, 2, { locationId: chawl }),
      row(1, 3, { locationId: office }),
      row(1, 4, { locationId: stand }),
      row(1, 5, { locationId: tank }),
      row(1, 6, { locationId: null }),
    ]
    const names = new Map<LocationId, string>([
      [chawl, 'Kamathi Chawl'],
      [office, 'Ward office'],
      [stand, 'Water tanker stand'],
      [tank, 'Tank room'],
    ])
    const places = placesOf(rows, new Set(rows.map((entry) => entry.sceneNodeId)), names)
    expect(places.map((place) => [place.name, place.scenes])).toEqual([
      ['Kamathi Chawl', 2],
      ['Tank room', 1],
      ['Ward office', 1],
    ])
  })
})

describe('the map', () => {
  const column = (n: number, group: MapColumn['group']): MapColumn => ({
    id: character(n),
    name: `C${String(n)}`,
    hue: 1,
    group,
  })

  it('fills the matrix with shared counts and lists principals who never meet', () => {
    const [a, b, c] = [scene(), scene(), scene()]
    const meera = column(1, 'principal')
    const kadam = column(2, 'principal')
    const farida = column(3, 'principal')
    const driver = column(4, 'supporting')
    const map = buildMap(
      [meera, kadam, farida, driver],
      new Map([
        [meera.id, [a, b, c]],
        [kadam.id, [a]],
        [farida.id, [b]],
        [driver.id, []],
      ]),
    )
    expect(map.cells).toEqual([
      [3, 1, 1, 0],
      [1, 1, 0, 0],
      [1, 0, 1, 0],
      [0, 0, 0, 0],
    ])
    expect(map.standouts.map((pair) => [pair.a.name, pair.b.name])).toEqual([['C2', 'C3']])
  })
})
