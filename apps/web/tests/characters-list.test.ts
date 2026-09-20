// @vitest-environment node
import type { CastRow, SceneRef } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { figuresOf } from '../lib/characters/cast'
import { LIST_COLUMNS, csvOf, defaultDirection, shareOf, sortCast } from '../lib/characters/list'

/**
 * The List's sort, its optional columns and the CSV - `lib/characters/list.ts`.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const scene = (n: number, episodeOrdinal: number, number: number, words: number): SceneRef & { readonly words: number } => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneRef['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
  words,
})

const index = [scene(1, 1, 1, 20), scene(2, 1, 2, 30), scene(3, 1, 3, 24), scene(4, 2, 1, 10), scene(5, 2, 2, 10), scene(6, 2, 3, 6)]

const row = (n: number, name: string, extra: Partial<CastRow>, scenes: readonly number[], lines: number, words: number): CastRow => ({
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
  lines,
  scenes: scenes.map(node),
  cues: [],
  words,
  exchanges: [],
  canvas: null,
  ...extra,
})

const figures = figuresOf(
  [
    row(1, 'Meera', { role: 'Lead, 38', gender: 'female', age: '38' }, [1, 2, 4, 5], 40, 60),
    row(2, 'Anil', { gender: 'male', age: '40s' }, [2, 3, 6], 12, 28),
    row(3, 'Clerk', { role: 'A clerk', age: '25' }, [3], 12, 12),
    row(4, 'Ghost', {}, [], 0, 0),
  ],
  index,
  [1, 2],
  [],
)

describe('sortCast', () => {
  it('sorts counts down and words up by default, the name breaking ties', () => {
    expect(defaultDirection('scenes')).toBe('desc')
    expect(defaultDirection('name')).toBe('asc')
    expect(sortCast(figures, 'scenes', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortCast(figures, 'lines', 'asc').map((f) => f.name)).toEqual(['Ghost', 'Anil', 'Clerk', 'Meera'])
    expect(sortCast(figures, 'words', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortCast(figures, 'share', 'desc')[0]?.name).toBe('Meera')
  })

  it('sorts an episode column, a numeric age before a worded one, and puts empties last either way', () => {
    expect(sortCast(figures, 'e2', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortCast(figures, 'role', 'asc').map((f) => f.name)).toEqual(['Clerk', 'Meera', 'Anil', 'Ghost'])
    expect(sortCast(figures, 'role', 'desc').map((f) => f.name)).toEqual(['Meera', 'Clerk', 'Anil', 'Ghost'])
    expect(sortCast(figures, 'age', 'asc').map((f) => f.name)).toEqual(['Clerk', 'Meera', 'Anil', 'Ghost'])
    expect(sortCast(figures, 'gender', 'asc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
  })
})

describe('the columns', () => {
  it('six default, three optional, in the table order', () => {
    expect(LIST_COLUMNS.filter((column) => !column.optional).map((column) => column.id)).toEqual(['name', 'gender', 'age', 'role', 'scenes', 'lines'])
    expect(LIST_COLUMNS.filter((column) => column.optional).map((column) => column.id)).toEqual(['words', 'share', 'episodes'])
    expect(shareOf(60, 100)).toBe(60)
    expect(shareOf(1, 0)).toBe(0)
    expect(shareOf(200, 100)).toBe(100)
  })
})

describe('csvOf', () => {
  it('writes the default columns, the optional ones when shown, and quotes a role with a comma', () => {
    const sorted = sortCast(figures, 'scenes', 'desc')
    const plain = csvOf(sorted, { words: false, share: false, episodes: null }).split('\r\n')
    expect(plain[0]).toBe('Name,Gender,Age,Role,Scenes,Lines')
    expect(plain[1]).toBe('Meera,Female,38,"Lead, 38",4,40')
    expect(plain[4]).toBe('Ghost,,,,0,0')
    expect(plain.at(-1)).toBe('')
    const full = csvOf(sorted, { words: true, share: true, episodes: [1, 2] }).split('\r\n')
    expect(full[0]).toBe('Name,Gender,Age,Role,Scenes,Lines,Words,Share,E1,E2')
    expect(full[1]).toBe('Meera,Female,38,"Lead, 38",4,40,60,60%,2,2')
  })

  it('doubles a quote inside a quoted cell', () => {
    const csv = csvOf([{ ...figures[2], role: 'The "clerk"' } as (typeof figures)[number]], { words: false, share: false, episodes: null })
    expect(csv.split('\r\n')[1]).toBe('Clerk,,25,"The ""clerk""",1,12')
  })
})
