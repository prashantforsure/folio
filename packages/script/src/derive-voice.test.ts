import { describe, expect, it } from 'vitest'

import type { Derivation, DeriveError } from './derive'
import { derive, dialogueWords, similarRecords } from './derive'
import type { CharacterRecord, DerivedEntities } from './entities'
import { NO_ENTITIES } from './entities'
import { characterId } from './ids'
import { mention, text } from './inline'
import type { Result } from './result'
import { characterAuthored, characterRecord, idAt, nodesOf } from './testing/derive-corpus'

/**
 * The voice: what the pass counts about a character beyond scenes and
 * lines, since the Characters rebuild's third phase (2026-09-18). Every
 * figure here is arithmetic over the node list - words, speeches,
 * parentheticals, the first, last and longest line, what is said per scene,
 * who talks to whom - and none of it binds anything.
 */

const must = (result: Result<Derivation, DeriveError>): Derivation => {
  if (!result.ok) throw new Error(`derive failed: ${JSON.stringify(result.error)}`)
  return result.value
}

const ids = (count: number, prefix = 'x'): readonly string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)

const run = (lines: Parameters<typeof nodesOf>[0], previous: DerivedEntities = NO_ENTITIES): Derivation =>
  must(derive(nodesOf(lines), previous, { freshIds: ids(32) }))

const byName = (derivation: Derivation, name: string): CharacterRecord => {
  const record = derivation.entities.characters.find((entry) => entry.authored.name === name)
  if (record === undefined) throw new Error(`no record named ${name}`)
  return record
}

const CHAWL = [
  'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
  'action:MEERA PAWAR (38), rain-soaked, counts the buckets again.',
  'cue:MEERA',
  'dialogue:Two buckets. I counted.',
  'cue:KADAM',
  'dialogue:Madam, the paper is the paper.',
  'cue:MEERA',
  'paren:(quietly)',
  'dialogue:Show me the meter, then.',
  'scene:EXT. STANDPIPE - DAY',
  'cue:MEERA (V.O.)',
  'dialogue:And you said the fifteenth. You said it twice, in front of everyone.',
  'action:Anil arrives with the ledger.',
  'cue:ANIL',
  'dialogue:Fifteenth.',
  'cue:MEERA',
  'dialogue:Yes.',
] as const

describe('words, speeches and parentheticals', () => {
  it('counts dialogue words per record, speeches as cue nodes, parens inside a speech', () => {
    const meera = byName(run(CHAWL), 'MEERA')
    expect(meera.lines).toBe(4)
    expect(meera.words).toBe(4 + 5 + 13 + 1)
    expect(meera.speeches).toBe(4)
    expect(meera.parens).toBe(1)
    expect(byName(run(CHAWL), 'KADAM').words).toBe(6)
    expect(byName(run(CHAWL), 'ANIL').words).toBe(1)
  })

  it("a paren inside a speech does not end it: the dialogue after it is still the speaker's", () => {
    const meera = byName(run(CHAWL), 'MEERA')
    expect(meera.sceneCounts[0]).toEqual({ scene: idAt(0), lines: 2, words: 9 })
  })

  it('a monologue and a one-word answer weigh differently', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:A', 'dialogue:Yes.', 'cue:B', 'dialogue:No, and I will tell you why, at length, because nobody asked.'])
    expect(byName(derivation, 'A').words).toBe(1)
    expect(byName(derivation, 'B').words).toBe(12)
  })

  it('dialogueWords splits on whitespace and counts a mention as one word', () => {
    expect(dialogueWords([text('  Two buckets.   I counted. ')])).toBe(4)
    expect(dialogueWords([text('Ask '), mention({ entity: 'character', id: characterId('c1') }), text(' about it.')])).toBe(4)
    expect(dialogueWords([text('   ')])).toBe(0)
  })

  it('Devanagari words are words, and an alias folds into the record', () => {
    const derivation = run(
      ['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:Two buckets.', 'cue:मीरा', 'dialogue:दो बाल्टी।'],
      {
        ...NO_ENTITIES,
        characters: [characterRecord('m', characterAuthored({ name: 'MEERA', boundCues: ['MEERA', 'मीरा'] }))],
      },
    )
    const meera = byName(derivation, 'MEERA')
    expect(meera.words).toBe(4)
    expect(meera.cues.map((cue) => cue.words)).toEqual([2, 2])
  })

  it('a lower-case cue folds into the same record and its words count once', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:One two.', 'cue:Meera', 'dialogue:Three.'])
    expect(byName(derivation, 'MEERA').words).toBe(3)
  })

  it('an unresolved cue contributes nothing to any record', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:One.', 'cue:MEERA PAWAR', 'dialogue:Two three.'])
    // MEERA PAWAR resembles the MEERA minted before it (a leading run) so it proposes rather than mints.
    expect(derivation.entities.characters.map((record) => record.authored.name)).toEqual(['MEERA'])
    expect(byName(derivation, 'MEERA').words).toBe(1)
  })
})

describe('first, last and longest line', () => {
  it('points at the dialogue nodes, with the scene each sits in', () => {
    const meera = byName(run(CHAWL), 'MEERA')
    expect(meera.firstLine).toEqual({ nodeId: idAt(3), scene: idAt(0) })
    expect(meera.lastLine).toEqual({ nodeId: idAt(16), scene: idAt(9) })
    expect(meera.longest).toEqual({ nodeId: idAt(11), scene: idAt(9), words: 13 })
  })

  it('a line before the first heading has no scene', () => {
    const derivation = run(['cue:MEERA', 'dialogue:Before anything.', 'scene:INT. A - DAY', 'cue:MEERA', 'dialogue:After.'])
    const meera = byName(derivation, 'MEERA')
    expect(meera.firstLine).toEqual({ nodeId: idAt(1), scene: null })
    expect(meera.lastLine?.scene).toBe(idAt(2))
  })

  it('the longest goes to the earlier line on a tie', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:A', 'dialogue:One two three.', 'cue:B', 'dialogue:x', 'cue:A', 'dialogue:Four five six.'])
    expect(byName(derivation, 'A').longest).toEqual({ nodeId: idAt(2), scene: idAt(0), words: 3 })
  })

  it('an absent record has nothing', () => {
    const derivation = run(['scene:INT. A - DAY', 'action:Nobody speaks.'], {
      ...NO_ENTITIES,
      characters: [characterRecord('m', characterAuthored({ name: 'MEERA' }))],
    })
    const meera = byName(derivation, 'MEERA')
    expect(meera.firstLine).toBeNull()
    expect(meera.lastLine).toBeNull()
    expect(meera.longest).toBeNull()
    expect(meera.words).toBe(0)
    expect(meera.sceneCounts).toEqual([])
    expect(meera.exchanges).toEqual([])
  })
})

describe('what is said per scene', () => {
  it('lists speaking scenes in document order and omits a scene the character is only mentioned in', () => {
    const meera = byName(run(CHAWL), 'MEERA')
    expect(meera.sceneCounts.map((count) => count.scene)).toEqual([idAt(0), idAt(9)])
    expect(meera.sceneCounts.map((count) => count.lines)).toEqual([2, 2])
  })

  it('a V.O.-only scene still counts', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA (V.O.)', 'dialogue:Over the picture.'])
    expect(byName(derivation, 'MEERA').sceneCounts).toEqual([{ scene: idAt(0), lines: 1, words: 3 }])
  })

  it("the scene carries every cue's words, resolved or not", () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:One two.', 'cue:MEERA PAWAR', 'dialogue:Three four five.'])
    expect(derivation.entities.scenes[0]?.words).toBe(5)
  })
})

describe('exchanges', () => {
  it('A, B, A, B under one heading is three exchanges between them', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:A', 'dialogue:1', 'cue:B', 'dialogue:2', 'cue:A', 'dialogue:3', 'cue:B', 'dialogue:4'])
    const a = byName(derivation, 'A')
    const b = byName(derivation, 'B')
    expect(a.exchanges).toEqual([{ other: b.id, count: 3, scenes: [idAt(0)] }])
    expect(b.exchanges).toEqual([{ other: a.id, count: 3, scenes: [idAt(0)] }])
  })

  it('action between two cues keeps the exchange; a heading breaks it', () => {
    const derivation = run([
      'scene:INT. A - DAY',
      'cue:A',
      'dialogue:1',
      'action:A beat.',
      'cue:B',
      'dialogue:2',
      'scene:INT. B - DAY',
      'cue:A',
      'dialogue:3',
    ])
    expect(byName(derivation, 'A').exchanges).toEqual([{ other: byName(derivation, 'B').id, count: 1, scenes: [idAt(0)] }])
  })

  it('A, A is no exchange, and two spellings of one record are not a conversation', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:1', 'cue:Meera', 'dialogue:2', 'cue:MEERA', 'dialogue:3'])
    expect(byName(derivation, 'MEERA').exchanges).toEqual([])
    const aliased = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:1', 'cue:मीरा', 'dialogue:2'], {
      ...NO_ENTITIES,
      characters: [characterRecord('m', characterAuthored({ name: 'MEERA', boundCues: ['MEERA', 'मीरा'] }))],
    })
    expect(byName(aliased, 'MEERA').exchanges).toEqual([])
  })

  it('an unresolved cue exchanges with nobody', () => {
    const derivation = run(['scene:INT. A - DAY', 'cue:MEERA', 'dialogue:1', 'cue:MEERA PAWAR', 'dialogue:2', 'cue:MEERA', 'dialogue:3'])
    expect(byName(derivation, 'MEERA').exchanges).toEqual([])
  })

  it('exchanges are sorted by count and carry every scene', () => {
    const derivation = run([
      'scene:INT. A - DAY',
      'cue:A',
      'dialogue:1',
      'cue:C',
      'dialogue:2',
      'scene:INT. B - DAY',
      'cue:A',
      'dialogue:3',
      'cue:B',
      'dialogue:4',
      'cue:A',
      'dialogue:5',
      'cue:B',
      'dialogue:6',
    ])
    const a = byName(derivation, 'A')
    expect(a.exchanges.map((exchange) => exchange.count)).toEqual([3, 1])
    expect(a.exchanges[0]?.scenes).toEqual([idAt(5)])
  })
})

describe('similarRecords', () => {
  const record = (id: string, name: string, boundCues: readonly string[] = [name]) => ({ id: characterId(id), name, boundCues })

  it('finds the full name beside the first name, and the exact spelling under two records', () => {
    expect(similarRecords([record('a', 'Meera'), record('b', 'MEERA PAWAR'), record('c', 'Kadam')])).toEqual([
      { a: characterId('a'), b: characterId('b'), confidence: 'likely' },
    ])
    expect(similarRecords([record('a', 'Meera', ['MEERA']), record('b', 'Meera Pawar', ['MEERA PAWAR', 'MEERA (V.O.)'])])).toEqual([
      { a: characterId('a'), b: characterId('b'), confidence: 'certain' },
    ])
  })

  it('leaves out a two-edit resemblance and an empty record', () => {
    expect(similarRecords([record('a', 'MEERA'), record('b', 'MEERI')])).toEqual([])
    expect(similarRecords([record('a', 'MEERA'), record('b', '', [])])).toEqual([])
    expect(similarRecords([])).toEqual([])
  })
})
