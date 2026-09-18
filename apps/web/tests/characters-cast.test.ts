import type { BoundCueView, CastRow, CharacterMap, CueVariantRow, ResolveItem, SceneFacts } from '@folio/contracts'
import type { CharacterId, LocationId, NodeId } from '@folio/script'
import { characterId, locationId, nodeId } from '@folio/script'
import { describe, expect, it } from 'vitest'

import {
  aliasRowsOf,
  balanceOf,
  breakdownOf,
  castWidgetOf,
  conflictsOf,
  cueLine,
  episodeWords,
  figuresOf,
  firstLast,
  groupOf,
  initialsOf,
  introBeforeSpeech,
  leastUsedColor,
  longestGap,
  mapOf,
  neverShare,
  onPageOf,
  perEpisode,
  presenceCounts,
  reasonLabel,
  routeIdOf,
  sceneLabel,
  setsOf,
  shareOf,
  sharedPairs,
  sharedRefs,
  silentPair,
  statsLine,
  statusTone,
  stripGroups,
  stripOf,
  unmatchedLabel,
} from '../lib/characters/cast'
import { buildMap } from '../lib/characters/figures'

/**
 * The Characters route's derived fields - `lib/characters/cast.ts`. Every
 * figure the route prints is computed from the rows, and these are the
 * readings that make a card's numbers come out of the scene index.
 */

const node = (n: number): NodeId => nodeId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const person = (n: number): CharacterId => characterId(`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const place = (n: number): LocationId => locationId(`20000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

const scene = (
  n: number,
  episodeOrdinal: number,
  number: number,
  parts: Partial<Pick<SceneFacts, 'speaking' | 'mentioned' | 'set' | 'light' | 'eighths' | 'words'>> = {},
): SceneFacts => ({
  sceneNodeId: node(n),
  episode: `ep_${String(episodeOrdinal).padStart(3, '0')}` as SceneFacts['episode'],
  episodeOrdinal,
  number,
  heading: `INT. SCENE ${String(n)} - DAY`,
  ie: 'INT',
  light: parts.light ?? 'day',
  timeOfDay: 'DAY',
  set: parts.set ?? null,
  speaking: parts.speaking ?? [],
  mentioned: parts.mentioned ?? [],
  eighths: parts.eighths ?? null,
  words: parts.words ?? 0,
})

// Three episodes: scenes 1-3 in E1, 4-6 in E2, 7-9 in E3.
const index: readonly SceneFacts[] = Array.from({ length: 9 }, (_, i) => scene(i + 1, Math.floor(i / 3) + 1, (i % 3) + 1))
const refs = new Map(index.map((entry) => [entry.sceneNodeId, entry]))

const row = (n: number, name: string, scenes: readonly number[], status: CastRow['status'] = 'draft', extra: Partial<CastRow> = {}): CastRow => ({
  id: person(n),
  name,
  color: 'chip-1',
  hue: 1,
  gender: null,
  age: null,
  role: null,
  bio: null,
  appearance: null,
  status,
  wants: null,
  needs: null,
  portraitUrl: null,
  origin: null,
  presence: scenes.length === 0 ? 'absent' : 'present',
  appearances: scenes.length,
  lines: scenes.length * 3,
  mentions: 0,
  scenes: scenes.map(node),
  cues: [],
  words: scenes.length * 10,
  speeches: scenes.length * 3,
  parens: 0,
  namedIn: 0,
  firstLine: null,
  lastLine: null,
  longest: null,
  introducedAt: null,
  sceneCounts: scenes.map((s) => ({ scene: node(s), lines: 3, words: 10 })),
  exchanges: [],
  quote: null,
  intro: null,
  ...extra,
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
  it('prints the scene count, zero included', () => {
    expect(sceneLabel(79)).toBe('79 scenes')
    expect(sceneLabel(1)).toBe('1 scene')
    expect(sceneLabel(0)).toBe('0 scenes')
  })

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

  it("counts the unmatched names in the banner's words", () => {
    expect(unmatchedLabel(3)).toBe("3 names in the script don't match a character")
    expect(unmatchedLabel(1)).toBe("1 name in the script doesn't match a character")
  })

  it('prints the stats row with thousands, the share and the V.O. count, and the honest zero', () => {
    const cues: CueVariantRow[] = [
      { cue: 'MEERA', key: 'MEERA', occurrences: 79, lines: 409, words: 3170 },
      { cue: 'MEERA (V.O.)', key: 'MEERA', occurrences: 3, lines: 3, words: 10 },
    ]
    expect(statsLine({ lines: 412, words: 3180, cues }, 22_700)).toBe('412 lines · 3,180 words · 14% of dialogue · 3 V.O.')
    expect(statsLine({ lines: 0, words: 0, cues: [] }, 100)).toBe('0 lines · 0 words')
    expect(statsLine({ lines: 1, words: 1, cues: [] }, 0)).toBe('1 line · 1 word')
  })

  it('shares as a whole percentage, capped, zero with nothing to share', () => {
    expect(shareOf(14, 100)).toBe(14)
    expect(shareOf(1, 3)).toBe(33)
    expect(shareOf(5, 0)).toBe(0)
    expect(shareOf(200, 100)).toBe(100)
  })

  it("lists the card's alias line busiest first", () => {
    expect(
      cueLine([
        { cue: 'YOUNG MEERA', occurrences: 2 },
        { cue: 'MEERA', occurrences: 79 },
        { cue: 'MEERA (V.O.)', occurrences: 3 },
      ]),
    ).toEqual(['MEERA 79', 'MEERA (V.O.) 3', 'YOUNG MEERA 2'])
  })
})

describe('status', () => {
  it('follows the README: amber draft, green defined, accent locked', () => {
    expect(statusTone('draft')).toBe('warn')
    expect(statusTone('defined')).toBe('ok')
    expect(statusTone('locked')).toBe('accent')
  })
})

describe('groups', () => {
  it("splits at a fifth of the lead's scenes", () => {
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
  const item = (cue: string, proposal: ResolveItem['proposal']): ResolveItem => ({ key: cue, cue, occurrences: 2, scenes: [], proposal, candidates: [] })

  it('is the open cues whose proposal names a record, by record', () => {
    const conflicts = conflictsOf([
      item('MIRA', { kind: 'character', id: person(1), name: 'Meera', hue: 1, confidence: 'certain', reason: { kind: 'edits', distance: 1 } }),
      item('MEERA P', { kind: 'character', id: person(1), name: 'Meera', hue: 1, confidence: 'likely', reason: null }),
      item('CLERK', { kind: 'new-record', confidence: 'possible' }),
      item('VOICE', null),
    ])
    expect(conflicts.get(person(1))?.map((entry) => entry.cue)).toEqual(['MIRA', 'MEERA P'])
    expect(conflicts.size).toBe(1)
  })
})

describe('presence', () => {
  const present: readonly SceneFacts[] = [
    scene(1, 1, 1, { speaking: [person(1)] }),
    scene(2, 1, 2, { mentioned: [person(1)] }),
    scene(3, 1, 3),
    scene(4, 2, 1),
    scene(5, 2, 2),
    scene(6, 2, 3),
    scene(7, 3, 1),
    scene(8, 3, 2),
    scene(9, 3, 3, { speaking: [person(1)] }),
  ]

  it('draws one cell per scene of the index: speaks, mentioned or absent', () => {
    const strip = stripOf(person(1), present)
    expect(strip).toEqual(['speaks', 'mentioned', 'absent', 'absent', 'absent', 'absent', 'absent', 'absent', 'speaks'])
    expect(presenceCounts(strip)).toEqual({ speaks: 2, mentioned: 1 })
  })

  it('groups the strip by episode with a titled cell each, in the ui strip\'s states', () => {
    const groups = stripGroups(stripOf(person(1), present), present)
    expect(groups.map((group) => group.label)).toEqual(['E1', 'E2', 'E3'])
    expect(groups[0]?.cells.map((cell) => cell.state)).toEqual(['full', 'half', 'none'])
    expect(groups[0]?.cells[0]?.title).toBe('E1 Sc 1 · INT. SCENE 1 - DAY · speaks')
  })

  it('finds the longest gap between two appearances, at the threshold, never before the first or after the last', () => {
    const gap = longestGap(stripOf(person(1), present), present)
    expect(gap?.scenes).toBe(6)
    expect(gap?.from.sceneNodeId).toBe(node(2))
    expect(gap?.to.sceneNodeId).toBe(node(9))
    // A gap of four is under the threshold; a single appearance has no gap.
    expect(longestGap(['speaks', 'absent', 'absent', 'absent', 'absent', 'speaks'], present.slice(0, 6))).toBeNull()
    expect(longestGap(['absent', 'absent', 'absent', 'absent', 'absent', 'absent', 'speaks'], present.slice(0, 7))).toBeNull()
  })
})

describe('breakdown and sets', () => {
  const chawl = { id: place(1), name: 'Kamathi Chawl' }
  const standpipe = { id: place(2), name: 'Standpipe' }
  const facts: readonly SceneFacts[] = [
    scene(1, 1, 1, { speaking: [person(1)], set: chawl, light: 'night', eighths: 12 }),
    scene(2, 1, 2, { mentioned: [person(1)], set: chawl, light: 'day', eighths: 4 }),
    scene(4, 2, 1, { speaking: [person(1)], set: standpipe, light: 'day' }),
  ]

  it('groups the scenes by episode with speaks, mentioned and the measured eighths', () => {
    const groups = breakdownOf(person(1), facts)
    expect(groups.map((group) => [group.ordinal, group.scenes.length, group.speaks, group.mentioned, group.eighths])).toEqual([
      [1, 2, 1, 1, 16],
      [2, 1, 1, 0, null],
    ])
  })

  it('lists the sets most scenes first with the day/night split', () => {
    expect(setsOf(facts)).toEqual([
      { id: place(1), name: 'Kamathi Chawl', scenes: 2, day: 1, night: 1 },
      { id: place(2), name: 'Standpipe', scenes: 1, day: 1, night: 0 },
    ])
    expect(setsOf([scene(3, 1, 3)])).toEqual([])
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

describe('pairs and findings', () => {
  it('lists every sharing pair, most shared first', () => {
    expect(sharedPairs(map)).toEqual([
      { a: 0, b: 1, shared: 2 },
      { a: 0, b: 2, shared: 1 },
    ])
  })

  it('names the busiest pair of principals with no scene together', () => {
    expect(neverShare(map, groups)).toEqual([1, 2])
    expect(neverShare(map, ['supporting', 'supporting', 'supporting', 'supporting'])).toBeNull()
  })

  it('narrows the map to the filter and keeps the order', () => {
    const narrowed = mapOf(map, new Set([person(3), person(1)]))
    expect(narrowed.columns.map((column) => column.id)).toEqual([person(1), person(3)])
    expect(narrowed.cells).toEqual([
      [6, 1],
      [1, 2],
    ])
  })

  it('finds the scenes two characters share, in script order', () => {
    expect(sharedRefs([6, 2, 1].map(node), [1, 2, 7].map(node), refs).map((ref) => ref.sceneNodeId)).toEqual([node(1), node(2)])
  })

  it('names two principals who share many scenes but rarely speak to each other', () => {
    const busy = buildMap(
      [
        { id: person(1), name: 'Meera', hue: 1, lines: 30, scenes: 6 },
        { id: person(2), name: 'Anil', hue: 2, lines: 12, scenes: 6 },
      ],
      new Map<CharacterId, readonly NodeId[]>([
        [person(1), [1, 2, 3, 4, 5, 6].map(node)],
        [person(2), [1, 2, 3, 4, 5, 6].map(node)],
      ]),
    )
    const quiet = new Map([[person(1), [{ other: person(2), count: 1, scenes: [node(1)] }]]])
    expect(silentPair(busy, quiet, ['principal', 'principal'])).toEqual({ a: 0, b: 1, shared: 6, talk: 1 })
    const chatty = new Map([[person(1), [{ other: person(2), count: 9, scenes: [1, 2, 3].map(node) }]]])
    expect(silentPair(busy, chatty, ['principal', 'principal'])).toBeNull()
    expect(silentPair(map, new Map(), groups)).toBeNull()
  })
})

describe('balance', () => {
  it('sums a record\'s words per episode from its scene counts', () => {
    const counts = [
      { scene: node(1), words: 10 },
      { scene: node(2), words: 5 },
      { scene: node(9), words: 20 },
      { scene: node(99), words: 7 },
    ]
    expect(episodeWords(counts, refs, [1, 2, 3])).toEqual([15, 0, 20])
  })

  it('names who carries each episode and how much of its dialogue that is', () => {
    const wordy = index.map((entry, at) => ({ ...entry, words: at < 3 ? 100 : at < 6 ? 0 : 50 }))
    const rows = balanceOf(
      [
        { id: person(1), name: 'Meera', episodeWords: [180, 0, 30] },
        { id: person(2), name: 'Anil', episodeWords: [120, 0, 120] },
      ],
      wordy,
      [1, 2, 3],
    )
    expect(rows).toEqual([
      { ordinal: 1, total: 300, voices: 2, lead: { id: person(1), name: 'Meera', words: 180, share: 60 } },
      { ordinal: 2, total: 0, voices: 0, lead: null },
      { ordinal: 3, total: 150, voices: 2, lead: { id: person(2), name: 'Anil', words: 120, share: 80 } },
    ])
  })
})

describe('the timing finding', () => {
  const figure = (first: number | null, intro: number | null, deliberate = false) => ({
    firstLine: first === null ? null : { nodeId: node(50), sceneNodeId: node(first) },
    introducedAt: intro === null ? null : { nodeId: node(51), sceneNodeId: node(intro) },
    intro: intro === null ? null : { nodeId: node(51), text: 'MEERA (38)', sceneNodeId: node(intro), age: 38, deliberate },
  })

  it('is the first speaking scene when it comes before the introducing one', () => {
    expect(introBeforeSpeech(figure(2, 5), refs)?.sceneNodeId).toBe(node(2))
    expect(introBeforeSpeech(figure(5, 2), refs)).toBeNull()
    expect(introBeforeSpeech(figure(2, 2), refs)).toBeNull()
  })

  it('is nothing when never introduced, waved through, or the scene has left the index', () => {
    expect(introBeforeSpeech(figure(2, null), refs)).toBeNull()
    expect(introBeforeSpeech(figure(2, 5, true), refs)).toBeNull()
    expect(introBeforeSpeech(figure(2, 99), refs)).toBeNull()
  })
})

describe('the figures, assembled', () => {
  it('joins every derived field onto the row', () => {
    const speaking = index.map((entry) => (entry.number === 1 ? { ...entry, speaking: [person(1)] } : entry))
    const figures = figuresOf(
      [row(1, 'Meera Pawar', [1, 2, 3, 4, 5, 6], 'defined'), row(2, 'The Driver', [7]), row(3, 'Ghost', [])],
      speaking,
      [1, 2, 3],
      [{ key: 'MIRA', cue: 'MIRA', occurrences: 1, scenes: [], proposal: { kind: 'character', id: person(1), name: 'Meera Pawar', hue: 1, confidence: 'certain', reason: null }, candidates: [] }],
    )
    expect(figures.map((figure) => figure.group)).toEqual(['principal', 'supporting', 'off-page'])
    expect(figures[0]?.perEpisode).toEqual([3, 3, 0])
    expect(figures[0]?.first?.number).toBe(1)
    expect(figures[0]?.last?.episodeOrdinal).toBe(2)
    expect(figures[0]?.conflicts.map((entry) => entry.cue)).toEqual(['MIRA'])
    expect(figures[0]?.speaks).toBe(3)
    expect(figures[0]?.strip).toHaveLength(9)
    expect(figures[0]?.episodeWords).toEqual([30, 30, 0])
    expect(figures[1]?.initial).toBe('D')
    expect(figures[2]?.first).toBeNull()
    expect(figures[2]?.refs).toEqual([])
    expect(figures[2]?.sets).toEqual([])
    expect(figures[2]?.gap).toBeNull()
  })
})

describe('the alias table', () => {
  const tally = (cue: string, key: string, occurrences: number, lines: number): CueVariantRow => ({ cue, key, occurrences, lines, words: lines * 3 })
  const bound = (cue: string, provenance: BoundCueView['provenance']): BoundCueView => ({ cue, provenance })

  it('groups MEERA (V.O.) under the MEERA row as a variant and marks the name row', () => {
    const rows = aliasRowsOf({
      name: 'Meera Pawar',
      cues: [tally('MEERA PAWAR', 'MEERA PAWAR', 79, 412), tally('MEERA PAWAR (V.O.)', 'MEERA PAWAR', 3, 9), tally('YOUNG MEERA', 'YOUNG MEERA', 2, 4)],
      bound: [bound('MEERA PAWAR', 'derived'), bound('YOUNG MEERA', 'you'), bound('मीरा', 'member')],
    })
    expect(rows.map((entry) => [entry.cue, entry.occurrences, entry.lines, entry.isName, entry.counted])).toEqual([
      ['MEERA PAWAR', 82, 421, true, true],
      ['YOUNG MEERA', 2, 4, false, true],
      ['मीरा', 0, 0, false, false],
    ])
    expect(rows[0]?.variants).toEqual([{ cue: 'MEERA PAWAR (V.O.)', modifiers: ['V.O.'], occurrences: 3 }])
    expect(rows[1]?.variants).toEqual([])
    expect(rows.map((entry) => entry.provenance)).toEqual(['derived', 'you', 'member'])
  })

  it('has no rows for a record nothing is bound to', () => {
    expect(aliasRowsOf({ name: 'Ghost', cues: [], bound: [] })).toEqual([])
  })
})

describe('colour, and the foot widget', () => {
  it('picks the first unused colour, else the least used', () => {
    expect(leastUsedColor([])).toBe('chip-1')
    expect(leastUsedColor([1, 2])).toBe('chip-3')
    expect(leastUsedColor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1])).toBe('chip-2')
  })

  it('counts the records on the page, of all, and the decisions waiting', () => {
    expect(onPageOf([{ presence: 'present' }, { presence: 'absent' }, { presence: 'present' }])).toEqual({ present: 2, total: 3 })
    expect(onPageOf([])).toEqual({ present: 0, total: 0 })
    expect(castWidgetOf([{ presence: 'present' }], 3)).toEqual({ decisions: 3, present: 1, total: 1 })
  })
})
