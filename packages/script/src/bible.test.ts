import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  BIBLE_ENTRY_STATUSES,
  BIBLE_SECTIONS,
  PITCH_FIELD_KEYS,
  isCheckedAgainstDraft,
  isReadableByLenses,
  liveCites,
  openConflicts,
  sceneOpenings,
  termUsage,
} from './bible'
import type { BibleEntryStatus } from './bible'
import { characterId, nodeId } from './ids'
import { mention, text } from './inline'
import { makeScreenplayNode } from './node'
import type { ScreenplayNode } from './node'
import { typed } from './provenance'

/**
 * The bible's pure half: the status gate, which recorded conflicts count,
 * and the glossary's derived use count. Nothing here is authored by these
 * tests except the words a writer would have typed.
 */

let counter = 0
const node = (type: ScreenplayNode['type'], value: string, id?: string): ScreenplayNode =>
  makeScreenplayNode(type, {
    id: nodeId(id ?? `n${String((counter += 1))}`),
    provenance: typed(),
    content: [text(value)],
    modifiers: [],
  })

const S1 = nodeId('scene-1')
const S2 = nodeId('scene-2')
const S3 = nodeId('scene-3')

const SCRIPT: readonly ScreenplayNode[] = [
  node('action', 'A tanker before any heading.'),
  node('scene', 'INT. KAMATHI CHAWL - CORRIDOR - NIGHT', S1),
  node('action', 'The tap coughs twice. Paani ka time is over.'),
  node('character', 'MEERA'),
  node('dialogue', 'Two buckets. The tanker never waits.'),
  node('comment', 'the tanker, the tanker, the tanker - a note, not a line'),
  node('scene', 'EXT. STREET - DAY', S2),
  node('action', 'The tanker idles. A TANKER-MAN counts notes. The tankers behind it wait.'),
  node('scene', 'INT. WARD OFFICE - DAY', S3),
  node('dialogue', 'BMC says the tank was sealed. The tank. Always the tank.'),
]

describe('the vocabulary', () => {
  it('lists the four sections in the brief’s order and draft first among the statuses', () => {
    expect(BIBLE_SECTIONS).toEqual(['premise', 'how_things_work', 'history', 'themes'])
    expect(BIBLE_ENTRY_STATUSES[0]).toBe('draft')
    expect(PITCH_FIELD_KEYS).toHaveLength(7)
  })
})

describe('entry status is a permission', () => {
  it('canon is readable by lenses and checked against the draft; draft and retired are neither', () => {
    expect(isReadableByLenses('canon')).toBe(true)
    expect(isCheckedAgainstDraft('canon')).toBe(true)
    for (const status of ['draft', 'retired'] as const) {
      expect(isReadableByLenses(status)).toBe(false)
      expect(isCheckedAgainstDraft(status)).toBe(false)
    }
  })

  it('only one status is ever readable, whatever the list holds', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BIBLE_ENTRY_STATUSES), (status: BibleEntryStatus) => {
        expect(isReadableByLenses(status)).toBe(status === 'canon')
      }),
    )
  })
})

describe('openConflicts', () => {
  const present = new Set([S1, S2])
  const fact = (entryStatus: BibleEntryStatus, conflictSceneId: typeof S1 | null, id: string) => ({
    id,
    entryStatus,
    conflictSceneId,
  })

  it('keeps a conflict only on a canon entry whose scene is still in the draft', () => {
    const facts = [
      fact('canon', S1, 'counts'),
      fact('draft', S1, 'draft entry - not checked'),
      fact('retired', S2, 'retired entry - ignored'),
      fact('canon', S3, 'scene cut from the draft'),
      fact('canon', null, 'no conflict recorded'),
    ]
    expect(openConflicts(facts, present).map((entry) => entry.id)).toEqual(['counts'])
  })

  it('keeps the caller’s order', () => {
    const facts = [fact('canon', S2, 'b'), fact('canon', S1, 'a')]
    expect(openConflicts(facts, present).map((entry) => entry.id)).toEqual(['b', 'a'])
  })
})

describe('liveCites', () => {
  it('drops a cite whose scene has left the draft, and keeps the order', () => {
    expect(liveCites([S3, S1, S2], new Set([S1, S2]))).toEqual([S1, S2])
    expect(liveCites([S3], new Set([S1]))).toEqual([])
  })
})

describe('sceneOpenings', () => {
  it('quotes the first action or dialogue line under each asked-for heading', () => {
    const openings = sceneOpenings(SCRIPT, new Set([S1, S3]))
    expect(openings.get(S1)).toBe('The tap coughs twice. Paani ka time is over.')
    expect(openings.get(S3)).toBe('BMC says the tank was sealed. The tank. Always the tank.')
    expect(openings.has(S2)).toBe(false)
  })

  it('maps a heading with nothing under it to the empty string', () => {
    const bare = [node('scene', 'INT. NOWHERE - DAY', S1), node('scene', 'INT. ELSEWHERE - DAY', S2), node('action', 'Later.')]
    expect(sceneOpenings(bare, new Set([S1]))).toEqual(new Map([[S1, '']]))
  })
})

describe('termUsage', () => {
  it('counts whole words, case-insensitively, and never inside a longer word', () => {
    const [tanker, tank, bmc] = termUsage(SCRIPT, ['tanker', 'The tank', 'BMC'])
    // "tanker": once before any heading, once in dialogue, twice in the street
    // action - "TANKER-MAN" counts, the hyphen ends the word; "tankers" does
    // not, the s is a letter. The comment’s three never count.
    expect(tanker?.uses).toBe(4)
    expect(tank?.uses).toBe(3)
    expect(bmc?.uses).toBe(1)
  })

  it('reports the heading the first use sits under, or null above the first heading', () => {
    const [tanker, tank, never] = termUsage(SCRIPT, ['tanker', 'the tank', 'monsoon'])
    expect(tanker?.firstScene).toBeNull()
    expect(tank?.firstScene).toBe(S3)
    expect(never).toEqual({ term: 'monsoon', uses: 0, firstScene: null })
  })

  it('matches a multi-word term across any run of whitespace', () => {
    const [usage] = termUsage(SCRIPT, ['paani   ka time'])
    expect(usage?.uses).toBe(1)
    expect(usage?.firstScene).toBe(S1)
  })

  it('never counts a comment', () => {
    const [usage] = termUsage([node('comment', 'tanker tanker tanker')], ['tanker'])
    expect(usage?.uses).toBe(0)
  })

  it('bounds a word by any script’s letters, so a Devanagari term is a whole word too', () => {
    const hindi = [node('scene', 'INT. CHAWL - DAY', S1), node('dialogue', 'पानी का टाइम। पानी नहीं।')]
    const [paani, paaniKaTime] = termUsage(hindi, ['पानी', 'पानी का टाइम'])
    expect(paani?.uses).toBe(2)
    expect(paaniKaTime?.uses).toBe(1)
    // The inner word of a longer Devanagari word is not a use.
    const [inner] = termUsage([node('action', 'पानीवाला')], ['पानी'])
    expect(inner?.uses).toBe(0)
  })

  it('reads only text runs; a mention has no text to match', () => {
    const withMention = [
      makeScreenplayNode('action', {
        id: nodeId('m'),
        provenance: typed(),
        content: [mention({ entity: 'character', id: characterId('x') }), text(' waits by the tanker.')],
        modifiers: [],
      }),
    ]
    const [usage] = termUsage(withMention, ['tanker'])
    expect(usage?.uses).toBe(1)
  })

  it('treats a term of only whitespace as never said, and regex characters as letters', () => {
    const [blank, dotted] = termUsage([node('action', 'a.b a.b')], ['   ', 'a.b'])
    expect(blank?.uses).toBe(0)
    expect(dotted?.uses).toBe(2)
  })

  it('returns one row per term, in the order given', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 6 }), (terms) => {
        const rows = termUsage(SCRIPT, terms)
        expect(rows.map((row) => row.term)).toEqual(terms)
        for (const row of rows) expect(row.uses).toBeGreaterThanOrEqual(0)
      }),
    )
  })
})
