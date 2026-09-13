import type { CharacterMap, MapColumn } from '@folio/contracts'
import { CHARACTER_COLORS, CHARACTER_COLOR_IDS, CharacterColorSchema, hueOfColor } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { buildMap, factsLine, formatSceneRef, initialOf, sceneRefOf, sharedScenes } from '../lib/characters/figures'
import {
  arcPath,
  bubbleBounds,
  chordLayout,
  edgesOf,
  packBubbles,
  ribbonPath,
  ringLayout,
} from '../lib/characters/graphs'

/**
 * The Characters route's figures and the geometry behind its graphs. Every
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

  it('lists every sharing pair once, strongest first', () => {
    expect(edgesOf(map)).toEqual([{ a: 0, b: 1, shared: 2 }])
  })
})

describe('the ring', () => {
  it('puts one node at the centre and n nodes on the circle, the first at the top', () => {
    expect(ringLayout(1, 50, 50, 20)).toEqual([{ index: 0, x: 50, y: 50 }])
    const ring = ringLayout(4, 0, 0, 10)
    expect(ring[0]?.x).toBeCloseTo(0)
    expect(ring[0]?.y).toBeCloseTo(-10)
    for (const point of ring) expect(Math.hypot(point.x, point.y)).toBeCloseTo(10)
  })
})

describe('the bubbles', () => {
  it('scales by the square root of lines with a floor, and never overlaps', () => {
    const bubbles = packBubbles([100, 25, 0, 1, 50, 9], 100, 20)
    expect(bubbles).toHaveLength(6)
    const largest = bubbles.find((bubble) => bubble.index === 0)
    expect(largest?.r).toBe(100)
    expect(largest?.x).toBe(0)
    expect(bubbles.find((bubble) => bubble.index === 1)?.r).toBeCloseTo(50)
    expect(bubbles.find((bubble) => bubble.index === 2)?.r).toBe(20)
    for (const a of bubbles) {
      for (const b of bubbles) {
        if (a === b) continue
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r)
      }
    }
    const box = bubbleBounds(bubbles)
    expect(box.maxX - box.minX).toBeGreaterThan(200)
  })

  it('draws a cast with no lines at all as equal circles', () => {
    const bubbles = packBubbles([0, 0, 0], 100, 30)
    expect(bubbles.every((bubble) => bubble.r === 30)).toBe(true)
  })
})

describe('the chord', () => {
  it('gives every character an arc proportional to lines, with a sliver for silence', () => {
    const layout = chordLayout(map, 0.1)
    expect(layout.arcs).toHaveLength(3)
    const spans = layout.arcs.map((arc) => arc.end - arc.start)
    expect(spans.reduce((sum, span) => sum + span, 0)).toBeCloseTo(Math.PI * 2 - 0.3)
    expect(spans[0]).toBeCloseTo((40 / 51) * (Math.PI * 2 - 0.3))
    expect(spans[2]).toBeGreaterThan(0)
    for (let i = 1; i < layout.arcs.length; i += 1) {
      expect(layout.arcs[i]?.start).toBeGreaterThan(layout.arcs[i - 1]?.end ?? 0)
    }
  })

  it('tiles each arc with its ribbons and never crosses an arc boundary', () => {
    const layout = chordLayout(map)
    expect(layout.ribbons).toHaveLength(1)
    const ribbon = layout.ribbons[0]
    const arcA = layout.arcs[0]
    const arcB = layout.arcs[1]
    expect(ribbon?.aStart).toBeCloseTo(arcA?.start ?? -1)
    expect(ribbon?.aEnd).toBeCloseTo(arcA?.end ?? -1)
    expect(ribbon?.bStart).toBeCloseTo(arcB?.start ?? -1)
    expect(ribbon?.bEnd).toBeCloseTo(arcB?.end ?? -1)
  })

  it('writes closed SVG paths', () => {
    const layout = chordLayout(map)
    expect(arcPath(0, 0, 10, 20, 0, 1)).toMatch(/^M .* Z$/)
    const ribbon = layout.ribbons[0]
    expect(ribbon).toBeDefined()
    if (ribbon !== undefined) expect(ribbonPath(0, 0, 10, ribbon)).toMatch(/^M .*Q 0 0 .* Z$/)
  })

  it('is empty for an empty cast', () => {
    expect(chordLayout({ columns: [], cells: [] })).toEqual({ arcs: [], ribbons: [] })
  })
})
