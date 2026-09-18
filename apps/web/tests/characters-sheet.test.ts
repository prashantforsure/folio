import type { CastRow, SceneFacts } from '@folio/contracts'
import type { CharacterId, NodeId } from '@folio/script'
import { characterId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { figuresOf } from '../lib/characters/cast'
import { csvOf, defaultDirection, eighthsOf, introRefOf, scopeOf, sortFigures } from '../lib/characters/sheet'

/**
 * The Sheet's sort, its episode scope and the CSV - `lib/characters/sheet.ts`.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const scene = (n: number, episodeOrdinal: number, number: number, speaking: readonly CharacterId[], words: number, eighths: number | null): SceneFacts => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneFacts['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
  ie: 'INT',
  light: 'day',
  timeOfDay: 'DAY',
  set: null,
  speaking,
  mentioned: [],
  eighths,
  words,
})

// Scenes 1-3 in E1, 4-6 in E2. Meera speaks in 1, 2, 4, 5; Anil in 2, 3, 6; the Clerk in 3.
const index: readonly SceneFacts[] = [
  scene(1, 1, 1, [person(1)], 20, 8),
  scene(2, 1, 2, [person(1), person(2)], 30, null),
  scene(3, 1, 3, [person(2), person(3)], 24, 4),
  scene(4, 2, 1, [person(1)], 10, 2),
  scene(5, 2, 2, [person(1)], 10, 2),
  scene(6, 2, 3, [person(2)], 6, null),
]

const row = (n: number, name: string, role: string | null, scenes: readonly number[], lines: number, words: readonly number[]): CastRow => ({
  id: person(n),
  name,
  color: 'chip-1',
  hue: 1,
  gender: null,
  age: null,
  role,
  bio: null,
  appearance: null,
  status: 'draft',
  wants: null,
  needs: null,
  portraitUrl: null,
  origin: null,
  presence: scenes.length === 0 ? 'absent' : 'present',
  appearances: scenes.length,
  lines,
  mentions: 0,
  scenes: scenes.map(node),
  cues: [],
  words: words.reduce((total, w) => total + w, 0),
  speeches: lines,
  parens: 0,
  namedIn: 0,
  firstLine: null,
  lastLine: null,
  longest: null,
  introducedAt: n === 1 ? { nodeId: node(40), sceneNodeId: node(1) } : null,
  sceneCounts: scenes.map((s, at) => ({ scene: node(s), lines: 1, words: words[at] ?? 0 })),
  exchanges: [],
  quote: null,
  intro: null,
})

const figures = figuresOf(
  [
    row(1, 'Meera', 'Lead, 38', [1, 2, 4, 5], 40, [20, 20, 10, 10]),
    row(2, 'Anil', null, [2, 3, 6], 12, [10, 12, 6]),
    row(3, 'Clerk', 'A clerk', [3], 12, [12]),
    row(4, 'Ghost', null, [], 0, []),
  ],
  index,
  [1, 2],
  [],
)

describe('sortFigures', () => {
  it('sorts speaks desc by default and name asc on a tie', () => {
    expect(defaultDirection('speaks')).toBe('desc')
    expect(defaultDirection('name')).toBe('asc')
    expect(sortFigures(figures, 'speaks', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'lines', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'lines', 'asc').map((f) => f.name)).toEqual(['Ghost', 'Anil', 'Clerk', 'Meera'])
    expect(sortFigures(figures, 'words', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'share', 'desc')[0]?.name).toBe('Meera')
  })

  it('sorts a per-episode column and puts empties last either way', () => {
    expect(sortFigures(figures, 'e2', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'role', 'asc').map((f) => f.name)).toEqual(['Clerk', 'Meera', 'Anil', 'Ghost'])
    expect(sortFigures(figures, 'first', 'asc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'first', 'desc').map((f) => f.name)).toEqual(['Clerk', 'Anil', 'Meera', 'Ghost'])
    expect(sortFigures(figures, 'intro', 'asc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
    expect(sortFigures(figures, 'eighths', 'desc').map((f) => f.name)).toEqual(['Meera', 'Anil', 'Clerk', 'Ghost'])
  })
})

describe('the intro and eighths columns', () => {
  it('reads the introducing scene as a ref, and sums the measured eighths or none', () => {
    const [meera, anil, , ghost] = figures
    expect(introRefOf(meera as (typeof figures)[number])?.sceneNodeId).toBe(node(1))
    expect(introRefOf(anil as (typeof figures)[number])).toBeNull()
    expect(eighthsOf(meera as (typeof figures)[number])).toBe(12)
    expect(eighthsOf(anil as (typeof figures)[number])).toBe(4)
    expect(eighthsOf(ghost as (typeof figures)[number])).toBeNull()
  })
})

describe('scopeOf', () => {
  it('scopes the counts, the words, the share and the span to one episode, or the whole run', () => {
    const meera = figures[0]
    if (meera === undefined) throw new Error('fixture')
    expect(scopeOf(meera, null, index, [1, 2])).toEqual({ speaks: 4, mentioned: 0, words: 60, share: 60, first: index[0], last: index[4] })
    // E2: Meera speaks 20 of the 26 words under its headings.
    expect(scopeOf(meera, 2, index, [1, 2])).toEqual({ speaks: 2, mentioned: 0, words: 20, share: 77, first: index[3], last: index[4] })
    expect(scopeOf(meera, 3, index, [1, 2])).toEqual({ speaks: 0, mentioned: 0, words: 0, share: 0, first: null, last: null })
  })
})

describe('csvOf', () => {
  it('writes a header, one row per figure, and quotes a role with a comma', () => {
    const csv = csvOf(sortFigures(figures, 'speaks', 'desc'), [1, 2])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Name,Role,Status,Speaks,Mentioned,Lines,Words,Share,E1,E2,Intro,Eighths,First,Last')
    expect(lines[1]).toBe('Meera,"Lead, 38",Draft,4,0,40,60,60%,2,2,E1 Sc 1,12,E1 Sc 1,E2 Sc 2')
    expect(lines[4]).toBe('Ghost,,Draft,0,0,0,0,0%,0,0,,,,')
    expect(lines.at(-1)).toBe('')
  })

  it('doubles a quote inside a quoted cell', () => {
    const csv = csvOf([{ ...figures[2], role: 'The "clerk"' } as (typeof figures)[number]], [])
    expect(csv.split('\r\n')[1]).toBe('Clerk,"The ""clerk""",Draft,1,0,12,12,12%,,4,E1 Sc 3,E1 Sc 3')
  })
})
