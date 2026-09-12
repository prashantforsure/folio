import { describe, expect, it } from 'vitest'

import { derive, matchCharacters } from './derive'
import { NO_ENTITIES } from './entities'
import { mention, text } from './inline'
import { cueSpelling, renameCharacterCues, renameLocationHeadings, setSpelling } from './rename'
import { characterAuthored, characterRecord, idAt, nodesOf } from './testing/derive-corpus'

/**
 * The record-level rename, and the candidate list "Walk-on" rejects.
 *
 * AGENTS.md, Entity identity: "A **record-level** rename rewrites every cue in
 * every episode and keeps bio, portrait, relationships and casting." The
 * rewrite is the pure half of that; the keeping is the database's, because
 * the authored tables are never touched by it. And the exception table: the
 * rename is "an explicit rewrite operation, returns a diff" - `rewritten` is
 * the diff.
 */

const SCRIPT = [
  'scene:INT. KAMATHI CHAWL - CORRIDOR - NIGHT',
  'cue:MEERA',
  'dialogue:Two buckets. I counted.',
  'cue:Meera (V.O.)',
  'dialogue:And you said the fifteenth.',
  'rawCue:MEERA (O.S.)',
  'dialogue:Show me the meter.',
  'cue:YOUNG MEERA',
  'dialogue:Amma?',
  'cue:KADAM',
  'dialogue:Madam, the paper is the paper.',
] as const

const cueText = (
  node: { readonly content: readonly { readonly kind: string; readonly text?: string }[] } | undefined,
): string => (node === undefined ? '' : node.content.map((run) => (run.kind === 'text' ? (run.text ?? '') : '@')).join(''))

const modifiersAt = (nodes: readonly { readonly type: string; readonly modifiers?: readonly string[] }[], at: number) => {
  const node = nodes[at]
  return node?.type === 'character' ? (node.modifiers ?? []) : []
}

describe('cueSpelling', () => {
  it('uppercases with the invariant mapping and collapses whitespace', () => {
    expect(cueSpelling('  Meera   Pawar ')).toBe('MEERA PAWAR')
  })

  it('leaves a script with no case alone', () => {
    expect(cueSpelling('मीरा')).toBe('मीरा')
  })
})

describe('renameCharacterCues', () => {
  it('rewrites every cue that is the name, keeps modifiers, and leaves aliases alone', () => {
    const nodes = nodesOf(SCRIPT)
    const result = renameCharacterCues(nodes, 'Meera', 'Meera Pawar')

    // n2 `MEERA`, n4 `Meera` (modifier on the node), n6 `MEERA (O.S.)` (modifier in the text).
    expect(result.rewritten).toEqual([idAt(1), idAt(3), idAt(5)])
    expect(cueText(result.nodes[1])).toBe('MEERA PAWAR')
    expect(cueText(result.nodes[3])).toBe('MEERA PAWAR')
    expect(modifiersAt(result.nodes, 3)).toEqual(['V.O.'])
    expect(cueText(result.nodes[5])).toBe('MEERA PAWAR (O.S.)')
    // `YOUNG MEERA` is an alias, not the name. `KADAM` is someone else.
    expect(cueText(result.nodes[7])).toBe('YOUNG MEERA')
    expect(cueText(result.nodes[9])).toBe('KADAM')
  })

  it('keeps every id and touches no other node', () => {
    const nodes = nodesOf(SCRIPT)
    const result = renameCharacterCues(nodes, 'Meera', 'Meera Pawar')
    expect(result.nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id))
    result.nodes.forEach((node, index) => {
      if (!result.rewritten.includes(node.id)) expect(node).toBe(nodes[index])
    })
  })

  it('returns the same list when nothing matches, and rewrites nothing for an empty name', () => {
    const nodes = nodesOf(SCRIPT)
    expect(renameCharacterCues(nodes, 'Farida', 'Farida Sheikh').nodes).toBe(nodes)
    expect(renameCharacterCues(nodes, 'Meera', '   ').rewritten).toEqual([])
  })

  it('normalises a differently-cased cue to the spelling and leaves identical ones alone', () => {
    const nodes = nodesOf(SCRIPT)
    // Same name, same key: only `Meera (V.O.)`, whose text is not the cue
    // spelling, is touched - and it comes back as `MEERA` with its modifier.
    const result = renameCharacterCues(nodes, 'MEERA', 'meera')
    expect(result.rewritten).toEqual([idAt(3)])
    expect(cueText(result.nodes[3])).toBe('MEERA')
    const upper = nodesOf(SCRIPT.filter((line) => line !== 'cue:Meera (V.O.)'))
    expect(renameCharacterCues(upper, 'MEERA', 'meera').nodes).toBe(upper)
  })

  it('leaves a cue that carries a mention run alone', () => {
    const nodes = nodesOf([
      { type: 'character', runs: [text('MEERA '), mention({ entity: 'character', id: 'c1' as never })] },
    ])
    const result = renameCharacterCues(nodes, 'Meera', 'Meera Pawar')
    expect(result.rewritten).toEqual([])
  })

  it('a renamed script derives to the same record under the new bound cue', () => {
    const nodes = nodesOf(SCRIPT)
    const first = derive(nodes, NO_ENTITIES, { freshIds: ['a', 'b', 'c', 'd'] })
    if (!first.ok) throw new Error('derive failed')
    const meera = first.value.entities.characters.find((record) => record.authored.name === 'MEERA')
    if (meera === undefined) throw new Error('no Meera')

    // The rename, as the route runs it: cues rewritten, name and bound cue
    // rewritten on the authored side, then a pass over the result.
    const renamed = renameCharacterCues(nodes, 'MEERA', 'Meera Pawar')
    const previous = {
      ...first.value.entities,
      characters: first.value.entities.characters.map((record) =>
        record.id === meera.id
          ? {
              ...record,
              // The rename swaps the name's bound cue; the alias the writer
              // bound stays. `YOUNG MEERA` was an open proposal on the first
              // pass and is bound here as the writer would have bound it.
              authored: { ...record.authored, name: 'Meera Pawar', boundCues: ['MEERA PAWAR', 'YOUNG MEERA'] },
            }
          : record,
      ),
    }
    const second = derive(renamed.nodes, previous, { freshIds: ['e', 'f', 'g', 'h'] })
    if (!second.ok) throw new Error('derive failed')
    expect(second.value.minted).toEqual([])
    const after = second.value.entities.characters.find((record) => record.id === meera.id)
    expect(after?.cues.map((cue) => cue.cue)).toEqual([
      'MEERA PAWAR',
      'MEERA PAWAR (V.O.)',
      'MEERA PAWAR (O.S.)',
      'YOUNG MEERA',
    ])
    expect(after?.lines).toBe(4)
  })
})

describe('matchCharacters', () => {
  const records = [
    characterRecord('c1', characterAuthored({ name: 'Meera Pawar', boundCues: ['MEERA PAWAR', 'MEERA'] })),
    characterRecord('c2', characterAuthored({ name: 'Suresh Kadam', boundCues: ['KADAM'] })),
    characterRecord('c3', characterAuthored({ name: 'Farida Sheikh', boundCues: ['FARIDA'] })),
  ]

  it('lists every record the cue resembles, best first, with the modifiers off', () => {
    expect(matchCharacters('SURESH (V.O.)', records)).toEqual([{ id: 'c2', confidence: 'likely' }])
    expect(matchCharacters('MEERA PAWAR', records)).toEqual([{ id: 'c1', confidence: 'certain' }])
  })

  it('lists nothing for a cue nobody resembles, or an empty one', () => {
    expect(matchCharacters('WOMAN IN QUEUE', records)).toEqual([])
    expect(matchCharacters('(V.O.)', records)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const HEADINGS = [
  'scene:INT. CHAWL CORRIDOR - NIGHT',
  'action:The tap coughs.',
  'scene:EXT CHAWL CORRIDOR -- DAWN',
  'scene:INT./EXT. Chawl Corridor',
  'scene:INT. CHAWL CORRIDOR - ROOF - DAY',
  'scene:INT. THE CHAWL - DAY',
  'scene:INT. WARD OFFICE - DAY',
] as const

describe('setSpelling', () => {
  it('is the cue rule under the location name', () => {
    expect(setSpelling(' kamathi   chawl ')).toBe('KAMATHI CHAWL')
    expect(setSpelling).toBe(cueSpelling)
  })
})

describe('renameLocationHeadings', () => {
  it('rewrites every heading whose set is the name, keeping the prefix and the time of day', () => {
    const nodes = nodesOf(HEADINGS)
    const result = renameLocationHeadings(nodes, 'CHAWL CORRIDOR', 'Kamathi Chawl')

    expect(result.rewritten).toEqual([idAt(0), idAt(2), idAt(3)])
    expect(cueText(result.nodes[0])).toBe('INT. KAMATHI CHAWL - NIGHT')
    // The prefix is kept as typed - no dot - and the double hyphen becomes the ` - ` this product writes.
    expect(cueText(result.nodes[2])).toBe('EXT KAMATHI CHAWL - DAWN')
    expect(cueText(result.nodes[3])).toBe('INT./EXT. KAMATHI CHAWL')
    // A sub-set's heading is the sub-set's name. An alias-shaped set is another record's row.
    expect(cueText(result.nodes[4])).toBe('INT. CHAWL CORRIDOR - ROOF - DAY')
    expect(cueText(result.nodes[5])).toBe('INT. THE CHAWL - DAY')
    expect(cueText(result.nodes[6])).toBe('INT. WARD OFFICE - DAY')
  })

  it('keeps every id and touches no other node', () => {
    const nodes = nodesOf(HEADINGS)
    const result = renameLocationHeadings(nodes, 'chawl corridor', 'Kamathi Chawl')
    expect(result.nodes.map((node) => node.id)).toEqual(nodes.map((node) => node.id))
    result.nodes.forEach((node, index) => {
      if (!result.rewritten.includes(node.id)) expect(node).toBe(nodes[index])
    })
  })

  it('returns the same list when nothing matches, and rewrites nothing for an empty name', () => {
    const nodes = nodesOf(HEADINGS)
    expect(renameLocationHeadings(nodes, 'TANKER STAND', 'Water tanker').nodes).toBe(nodes)
    expect(renameLocationHeadings(nodes, 'CHAWL CORRIDOR', '   ').rewritten).toEqual([])
    expect(renameLocationHeadings(nodes, '', 'Kamathi Chawl').rewritten).toEqual([])
  })

  it('leaves a heading that is already the spelling alone, and one that does not read', () => {
    const nodes = nodesOf(['scene:INT. KAMATHI CHAWL - DAY', 'scene:INTERCUT - PHONE CALL'])
    expect(renameLocationHeadings(nodes, 'Kamathi Chawl', 'kamathi chawl').nodes).toBe(nodes)
    expect(renameLocationHeadings(nodes, 'PHONE CALL', 'Call').rewritten).toEqual([])
  })

  it('leaves a heading that carries a mention run alone', () => {
    const nodes = nodesOf([
      { type: 'scene', runs: [text('INT. '), mention({ entity: 'location', id: 'l1' as never })] },
    ])
    expect(renameLocationHeadings(nodes, 'INT', 'Somewhere').rewritten).toEqual([])
  })

  it('a renamed script derives to the same record under the new bound slugline', () => {
    const nodes = nodesOf(['scene:INT. CHAWL CORRIDOR - NIGHT', 'action:Rain.', 'scene:EXT. CHAWL CORRIDOR - DAY'])
    const first = derive(nodes, NO_ENTITIES, { freshIds: ['a', 'b'] })
    if (!first.ok) throw new Error('derive failed')
    const corridor = first.value.entities.locations.find((record) => record.authored.name === 'CHAWL CORRIDOR')
    if (corridor === undefined) throw new Error('no corridor')

    const renamed = renameLocationHeadings(nodes, 'CHAWL CORRIDOR', 'Kamathi Chawl')
    const previous = {
      ...first.value.entities,
      locations: first.value.entities.locations.map((record) =>
        record.id === corridor.id
          ? { ...record, authored: { ...record.authored, name: 'Kamathi Chawl', boundSluglines: ['KAMATHI CHAWL'] } }
          : record,
      ),
    }
    const second = derive(renamed.nodes, previous, { freshIds: ['c', 'd'] })
    if (!second.ok) throw new Error('derive failed')
    expect(second.value.minted).toEqual([])
    const after = second.value.entities.locations.find((record) => record.id === corridor.id)
    expect(after?.presence).toBe('present')
    expect(after?.own.scenes).toBe(2)
    expect(after?.sluglines.map((tally) => tally.slugline)).toEqual([
      'INT. KAMATHI CHAWL - NIGHT',
      'EXT. KAMATHI CHAWL - DAY',
    ])
    expect(second.value.entities.queue.filter((row) => row.state === 'open')).toEqual([])
  })
})
