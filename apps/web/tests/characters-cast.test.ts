// @vitest-environment node
import type { CastRow, Relationship, SceneRef } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { figuresOf, initialsOf, leastUsedColor, perEpisode, reasonLabel, refsOf, routeIdOf, unmatchedLabel } from '../lib/characters/cast'

/**
 * The derived fields the Characters route prints - `lib/characters/cast.ts`,
 * cut to what the fourth pass reads (2026-09-20). Every one a pure function
 * over the rows the loader joins.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const scene = (n: number, episodeOrdinal: number, number: number, words = 10): SceneRef & { readonly words: number } => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneRef['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
  words,
})

// Three episodes: scenes 1-3 in E1, 4-6 in E2, 7-9 in E3.
const index = Array.from({ length: 9 }, (_, i) => scene(i + 1, Math.floor(i / 3) + 1, (i % 3) + 1))
const refs = new Map(index.map((entry) => [entry.sceneNodeId, entry]))

const row = (n: number, name: string, scenes: readonly number[], extra: Partial<CastRow> = {}): CastRow => ({
  id: person(n),
  name,
  color: 'chip-1',
  hue: 1,
  gender: null,
  age: null,
  role: null,
  bio: null,
  appearance: null,
  portraitUrl: null,
  origin: null,
  presence: scenes.length === 0 ? 'absent' : 'present',
  appearances: scenes.length,
  lines: scenes.length * 3,
  words: scenes.length * 10,
  scenes: scenes.map(node),
  cues: [],
  exchanges: [],
  canvas: null,
  ...extra,
})

const relationship = (a: number, b: number): Relationship => ({
  aId: person(a),
  bId: person(b),
  aIs: 'x',
  bIs: 'y',
  description: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
})

describe('scenes per episode', () => {
  it('counts the character in every episode, zero where absent', () => {
    expect(perEpisode([node(1), node(2), node(9)], refs, [1, 2, 3])).toEqual([2, 0, 1])
    expect(perEpisode([], refs, [1, 2])).toEqual([0, 0])
  })

  it('ignores a scene the index no longer has, and orders refs by episode then number', () => {
    expect(perEpisode([node(1), node(99)], refs, [1, 2, 3])).toEqual([1, 0, 0])
    expect(refsOf([node(9), node(2), node(5)], refs).map((ref) => ref.sceneNodeId)).toEqual([node(2), node(5), node(9)])
  })
})

describe('labels', () => {
  it("says why the queue is asking, in the writer's words", () => {
    expect(reasonLabel({ kind: 'exact' })).toBe('same name')
    expect(reasonLabel({ kind: 'leading', shorter: 'SURESH' })).toBe('first name')
    expect(reasonLabel({ kind: 'leading', shorter: 'SURESH KADAM' })).toBe('starts the same')
    expect(reasonLabel({ kind: 'contains', inner: 'MEERA' })).toBe('contains MEERA')
    expect(reasonLabel({ kind: 'edits', distance: 1 })).toBe('1 letter off')
    expect(reasonLabel({ kind: 'edits', distance: 2 })).toBe('2 letters off')
  })

  it("prints the status bar's route id with the first eight characters of an open record", () => {
    expect(routeIdOf(null)).toBe('characters')
    expect(routeIdOf({ id: '10000000-0000-4000-8000-000000000001' })).toBe('characters/10000000')
  })

  it('takes the initial past an article', () => {
    expect(initialsOf('Meera Pawar')).toBe('M')
    expect(initialsOf('the driver')).toBe('D')
    expect(initialsOf('')).toBe('·')
  })

  it("counts the unmatched names in the queue's words", () => {
    expect(unmatchedLabel(3)).toBe("3 names in the script don't match a character")
    expect(unmatchedLabel(1)).toBe("1 name in the script doesn't match a character")
  })
})

describe('the figures, assembled', () => {
  it('joins the per-episode count, the share and the relationship count onto the row', () => {
    const figures = figuresOf(
      [row(1, 'Meera Pawar', [1, 2, 3, 4, 5, 6]), row(2, 'The Driver', [7]), row(3, 'Ghost', [])],
      index,
      [1, 2, 3],
      [relationship(1, 2), relationship(1, 3)],
    )
    expect(figures[0]?.episodeScenes).toEqual([3, 3, 0])
    // 60 of the 90 dialogue words under the index's headings.
    expect(figures[0]?.share).toBe(67)
    expect(figures.map((figure) => figure.relationships)).toEqual([2, 1, 1])
    expect(figures[1]?.initial).toBe('D')
    expect(figures[2]?.episodeScenes).toEqual([0, 0, 0])
    expect(figures[2]?.share).toBe(0)
  })
})

describe('colour', () => {
  it('picks the first unused colour, else the least used', () => {
    expect(leastUsedColor([])).toBe('chip-1')
    expect(leastUsedColor([1, 2])).toBe('chip-3')
    expect(leastUsedColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1])).toBe('chip-2')
  })
})
