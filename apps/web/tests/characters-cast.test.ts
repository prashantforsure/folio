import type { CastRow, CharacterMap, ResolveItem, SceneRef } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  conflictsOf,
  definedOf,
  edgeWidth,
  figuresOf,
  firstLast,
  graphEdges,
  graphLayout,
  groupOf,
  initialsOf,
  neverShare,
  perEpisode,
  sceneLabel,
  shortName,
  statusTone,
  unmatchedLabel,
} from '../lib/characters/cast'
import { buildMap } from '../lib/characters/figures'

/**
 * The v2 Characters route's derived fields - `lib/characters/cast.ts`.
 * The mockup's `data()` authors these (`perEp: [28, 24, 27]`, `first:
 * "E1 Sc 1"`, `group: "Principal"`); here each is computed from the rows,
 * and these are the readings that make the mockup's numbers come out of
 * its own data.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const ref = (n: number, episodeOrdinal: number, number: number): SceneRef => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneRef['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
})

// Three episodes: scenes 1-3 in E1, 4-6 in E2, 7-9 in E3.
const index: readonly SceneRef[] = Array.from({ length: 9 }, (_, i) => ref(i + 1, Math.floor(i / 3) + 1, (i % 3) + 1))
const refs = new Map(index.map((entry) => [entry.sceneNodeId, entry]))

const row = (n: number, name: string, scenes: readonly number[], status: CastRow['status'] = 'draft'): CastRow => ({
  id: person(n),
  name,
  color: 'chip-1',
  hue: 1,
  gender: null,
  age: null,
  role: null,
  bio: null,
  status,
  wants: null,
  needs: null,
  portraitUrl: null,
  presence: scenes.length === 0 ? 'absent' : 'present',
  appearances: scenes.length,
  lines: scenes.length * 3,
  mentions: 0,
  scenes: scenes.map(node),
})

describe('scenes per episode, first and last', () => {
  it('counts the character in every episode, zero where absent', () => {
    expect(perEpisode([node(1), node(2), node(9)], refs, [1, 2, 3])).toEqual([2, 0, 1])
    expect(perEpisode([], refs, [1, 2])).toEqual([0, 0])
  })

  it('ignores a scene the index no longer has', () => {
    expect(perEpisode([node(1), node(99)], refs, [1, 2, 3])).toEqual([1, 0, 0])
  })

  it('finds the first and last by episode then number, whatever the array order', () => {
    const ends = firstLast([node(9), node(2), node(5)], refs)
    expect(ends?.first.sceneNodeId).toBe(node(2))
    expect(ends?.last.sceneNodeId).toBe(node(9))
    expect(firstLast([], refs)).toBeNull()
  })
})

describe('labels', () => {
  it('prints the scene count, and the README line for none', () => {
    expect(sceneLabel(79)).toBe('79 scenes')
    expect(sceneLabel(1)).toBe('1 scene')
    expect(sceneLabel(0)).toBe('Not on the page yet')
  })

  it('shortens a name as the mockup does', () => {
    expect(shortName('Meera Pawar')).toBe('Meera')
    expect(shortName('The Driver')).toBe('Driver')
    expect(shortName("Kadam's man")).toBe("Kadam's")
    expect(shortName('')).toBe('')
  })

  it('takes the initial past an article', () => {
    expect(initialsOf('Meera Pawar')).toBe('M')
    expect(initialsOf('the driver')).toBe('D')
    expect(initialsOf('')).toBe('·')
  })

  it("counts the unmatched names in the banner's words", () => {
    expect(unmatchedLabel(3)).toBe("3 names in the script don't match a character")
    expect(unmatchedLabel(1)).toBe("1 name in the script doesn't match a character")
  })
})

describe('status', () => {
  it('follows the README: amber draft, green defined, accent locked', () => {
    expect(statusTone('draft')).toBe('warn')
    expect(statusTone('defined')).toBe('ok')
    expect(statusTone('locked')).toBe('accent')
  })

  it('counts everything past draft as defined', () => {
    const rows = [{ status: 'draft' as const }, { status: 'defined' as const }, { status: 'locked' as const }, { status: 'draft' as const }]
    expect(definedOf(rows)).toEqual({ defined: 2, total: 4, percent: 50, note: '2 still drafts' })
    expect(definedOf([{ status: 'draft' }]).note).toBe('1 still a draft')
    expect(definedOf([{ status: 'locked' }]).note).toBe('Nothing still a draft')
    expect(definedOf([])).toEqual({ defined: 0, total: 0, percent: 0, note: 'No characters yet' })
  })
})

describe('groups', () => {
  it("splits at a fifth of the lead's scenes - the mockup's cast comes out as drawn", () => {
    // Meera 79, Anil 34, Kadam 18 principal; Farida 12, Driver 7, Kadam's man 11 supporting.
    expect([79, 34, 18, 12, 7, 11].map((n) => groupOf(n, 79))).toEqual([
      'principal',
      'principal',
      'principal',
      'supporting',
      'supporting',
      'supporting',
    ])
  })

  it('puts a record with no scene off the page', () => {
    expect(groupOf(0, 79)).toBe('off-page')
    expect(groupOf(1, 1)).toBe('principal')
  })
})

describe('conflicts', () => {
  const item = (cue: string, proposal: ResolveItem['proposal']): ResolveItem => ({ key: cue, cue, occurrences: 2, scenes: [], proposal })

  it('is the open cues whose proposal names a record, by record', () => {
    const conflicts = conflictsOf([
      item('MIRA', { kind: 'character', id: person(1), name: 'Meera', hue: 1, confidence: 'certain' }),
      item('MEERA P', { kind: 'character', id: person(1), name: 'Meera', hue: 1, confidence: 'likely' }),
      item('CLERK', { kind: 'new-record', confidence: 'possible' }),
      item('VOICE', null),
    ])
    expect(conflicts.get(person(1))?.map((entry) => entry.cue)).toEqual(['MIRA', 'MEERA P'])
    expect(conflicts.size).toBe(1)
  })
})

const map: CharacterMap = buildMap(
  [
    { id: person(1), name: 'Meera Pawar', hue: 1, lines: 30, scenes: 6 },
    { id: person(2), name: 'Anil Kadam', hue: 2, lines: 12, scenes: 3 },
    { id: person(3), name: 'Suresh Kadam', hue: 3, lines: 9, scenes: 2 },
    { id: person(4), name: 'Farida Sheikh', hue: 4, lines: 3, scenes: 1 },
  ],
  new Map<CharacterId, readonly NodeId[]>([
    [person(1), [1, 2, 3, 4, 5, 6].map(node)],
    [person(2), [1, 2, 7].map(node)],
    [person(3), [4, 8].map(node)],
    [person(4), [9].map(node)],
  ]),
)
const groups = ['principal', 'principal', 'principal', 'supporting'] as const

describe('the graph', () => {
  it('draws every sharing pair and the principals who never share, strongest first', () => {
    expect(graphEdges(map, groups)).toEqual([
      { a: 0, b: 1, shared: 2 },
      { a: 0, b: 2, shared: 1 },
      { a: 1, b: 2, shared: 0 },
    ])
  })

  it('names the busiest pair of principals with no scene together', () => {
    expect(neverShare(map, groups)).toEqual([1, 2])
    expect(neverShare(map, ['supporting', 'supporting', 'supporting', 'supporting'])).toBeNull()
  })

  it('widths as the mockup: 1.5 to 7, a dash of 1.5 for none', () => {
    expect(edgeWidth(0)).toBe(1.5)
    expect(edgeWidth(3)).toBe(1.5)
    expect(edgeWidth(21)).toBeCloseTo(6.5625)
    expect(edgeWidth(40)).toBe(7)
  })

  it('places every node inside the ground, apart, and the same way every time', () => {
    const points = graphLayout(map)
    expect(points).toHaveLength(4)
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(14)
      expect(point.x).toBeLessThanOrEqual(86)
      expect(point.y).toBeGreaterThanOrEqual(16)
      expect(point.y).toBeLessThanOrEqual(84)
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const p = points[i]
        const q = points[j]
        expect(Math.hypot((p?.x ?? 0) - (q?.x ?? 0), (p?.y ?? 0) - (q?.y ?? 0))).toBeGreaterThan(8)
      }
    }
    expect(graphLayout(map)).toEqual(points)
    expect(graphLayout(buildMap([], new Map()))).toEqual([])
    expect(graphLayout(buildMap([{ id: person(1), name: 'M', hue: 1, lines: 0, scenes: 0 }], new Map()))).toEqual([{ x: 50, y: 50 }])
  })
})

describe('the figures, assembled', () => {
  it('joins every derived field onto the row', () => {
    const figures = figuresOf(
      [row(1, 'Meera Pawar', [1, 2, 3, 4, 5, 6], 'defined'), row(2, 'The Driver', [7]), row(3, 'Ghost', [])],
      index,
      [1, 2, 3],
      [{ key: 'MIRA', cue: 'MIRA', occurrences: 1, scenes: [], proposal: { kind: 'character', id: person(1), name: 'Meera Pawar', hue: 1, confidence: 'certain' } }],
    )
    expect(figures.map((figure) => figure.group)).toEqual(['principal', 'supporting', 'off-page'])
    expect(figures[0]?.perEpisode).toEqual([3, 3, 0])
    expect(figures[0]?.first?.number).toBe(1)
    expect(figures[0]?.last?.episodeOrdinal).toBe(2)
    expect(figures[0]?.conflicts.map((entry) => entry.cue)).toEqual(['MIRA'])
    expect(figures[1]?.short).toBe('Driver')
    expect(figures[1]?.initial).toBe('D')
    expect(figures[2]?.first).toBeNull()
    expect(figures[2]?.refs).toEqual([])
  })
})
