import { describe, expect, it } from 'vitest'

import { countFountainNodes, parseFountain } from './fountain-parse'
import { serialiseFountain } from './fountain-serialise'
import { mentionToken } from './fountain-syntax'
import type { NodeId } from './ids'
import { characterId, nodeId } from './ids'
import type { DeliveryModifier, ScreenplayNode, ScreenplayNodeType } from './node'
import { makeScreenplayNode } from './node'
import { typed } from './provenance'

/**
 * Writing a node list back out.
 *
 * Two things are asserted here that the round-trip properties cannot see:
 *
 *   1. **Which forcing character was used**, and therefore whether the output
 *      is Fountain a person would want to read rather than merely Fountain that
 *      parses back.
 *   2. **Every reason a node list can be unwritable**, one example each. The
 *      generators in `testing/fountain-arbitraries.ts` deliberately avoid these
 *      so the properties spend their budget on the identity; the point of the
 *      report is that these cases are named rather than silently repaired, and
 *      an unnamed one would be a silent repair nobody notices.
 */

let counter = 0
const node = (
  type: ScreenplayNodeType,
  text: string,
  modifiers: readonly DeliveryModifier[] = [],
): ScreenplayNode => {
  counter += 1
  return makeScreenplayNode(type, {
    id: nodeId(`${type}-${counter}`),
    provenance: typed(),
    content: [{ kind: 'text', text }],
    modifiers,
  })
}

const write = (nodes: readonly ScreenplayNode[]): string => serialiseFountain(nodes).text

const reasons = (nodes: readonly ScreenplayNode[]): readonly string[] =>
  serialiseFountain(nodes).unrepresentable.map((entry) => entry.reason.kind)

const ids = (count: number): readonly NodeId[] =>
  Array.from({ length: count }, (_, index) => nodeId(`r${index}`))

const typesOf = (text: string): readonly string[] => {
  const parsed = parseFountain(text, { freshIds: ids(countFountainNodes(text)) })
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
  return parsed.value.nodes.map((parsedNode) => parsedNode.type)
}

// ---------------------------------------------------------------------------
// Forcing
// ---------------------------------------------------------------------------

describe('it forces only when inference would get the type wrong', () => {
  it('leaves a real heading, cue and transition alone', () => {
    expect(
      write([
        node('scene', 'INT. THE CHAWL - NIGHT'),
        node('action', 'Rain on the window.'),
        node('character', 'MEERA'),
        node('dialogue', 'You said the fifteenth.'),
        node('transition', 'CUT TO:'),
      ]),
    ).toBe(
      [
        'INT. THE CHAWL - NIGHT',
        '',
        'Rain on the window.',
        '',
        'MEERA',
        'You said the fifteenth.',
        '',
        'CUT TO:',
      ].join('\n'),
    )
  })

  it('forces a Scene whose text is not heading-shaped', () => {
    expect(write([node('scene', 'INTERCUT - PHONE CALL')])).toBe('.INTERCUT - PHONE CALL')
    expect(typesOf(write([node('scene', 'INTERCUT - PHONE CALL')]))).toEqual(['scene'])
  })

  it('forces an Action that would read as a heading', () => {
    expect(write([node('action', 'INT. THE CHAWL - NIGHT')])).toBe('!INT. THE CHAWL - NIGHT')
    expect(typesOf(write([node('action', 'INT. THE CHAWL - NIGHT')]))).toEqual(['action'])
  })

  it('forces a multi-line Action whose first line would read as a cue', () => {
    // Without the `!` this mints a character called MEERA and a line of
    // dialogue that was never spoken.
    const nodes = [node('action', 'MEERA\nsmiles and says nothing.')]
    expect(write(nodes)).toBe('!MEERA\nsmiles and says nothing.')
    expect(typesOf(write(nodes))).toEqual(['action'])
  })

  it('forces a cue with nothing to say, because inference needs a line after it', () => {
    expect(write([node('character', 'MEERA'), node('action', 'She leaves.')])).toBe(
      '@MEERA\n\nShe leaves.',
    )
  })

  it('forces a cue a caseless script would hide', () => {
    const nodes = [node('character', 'मीरा'), node('dialogue', 'वह पीछे मुड़कर नहीं देखती।')]
    expect(write(nodes)).toBe('@मीरा\nवह पीछे मुड़कर नहीं देखती।')
    expect(typesOf(write(nodes))).toEqual(['character', 'dialogue'])
  })

  it('forces a transition that does not end in TO:', () => {
    expect(write([node('transition', 'SMASH CUT')])).toBe('>SMASH CUT')
  })

  it('writes a Subtitle as centred text and a Comment as a note', () => {
    expect(write([node('subtitle', 'MUMBAI, 1997')])).toBe('> MUMBAI, 1997 <')
    expect(write([node('comment', 'check the bible')])).toBe('[[check the bible]]')
  })

  it('writes authored modifiers and has no way to write a generated one', () => {
    expect(
      write([node('character', 'MEERA', ['V.O.']), node('dialogue', 'He had twelve rooms.')]),
    ).toBe('MEERA (V.O.)\nHe had twelve rooms.')
  })

  it('keeps a speech in one block and a note inside it', () => {
    expect(
      write([
        node('character', 'MEERA'),
        node('paren', '(quietly)'),
        node('dialogue', 'Sit down.'),
        node('comment', 'too blunt?'),
        node('dialogue', 'Please.'),
      ]),
    ).toBe('MEERA\n(quietly)\nSit down.\n[[too blunt?]]\nPlease.')
  })

  it('writes a mention as a token carrying the record id, never a label', () => {
    const mention: ScreenplayNode = makeScreenplayNode('action', {
      id: nodeId('m1'),
      provenance: typed(),
      content: [
        { kind: 'mention', target: { entity: 'character', id: characterId('chr_1') } },
        { kind: 'text', text: ' waits.' },
      ],
      modifiers: [],
    })
    // `@{` is not the cue forcing character, so the `!` is still needed here.
    expect(write([mention])).toBe(`!${mentionToken('character', 'chr_1')} waits.`)
  })
})

// ---------------------------------------------------------------------------
// Every reason, one example
// ---------------------------------------------------------------------------

describe('it reports what it cannot write, and never repairs it', () => {
  it('empty-content', () => {
    expect(reasons([node('scene', '')])).toEqual(['empty-content'])
    expect(reasons([node('character', 'MEERA'), node('dialogue', '')])).toEqual(['empty-content'])
  })

  it('blank-line-in-content', () => {
    expect(reasons([node('action', 'One.\n\nTwo.')])).toEqual(['blank-line-in-content'])
  })

  it('control-character', () => {
    expect(reasons([node('action', `One.${String.fromCharCode(9)}Two.`)])).toContain(
      'control-character',
    )
  })

  it('untrimmed-line', () => {
    expect(reasons([node('action', '  indented')])).toEqual(['untrimmed-line'])
  })

  it('multi-line, on an element that occupies one line', () => {
    expect(reasons([node('scene', 'INT. A - DAY\nINT. B - DAY')])).toEqual(['multi-line'])
  })

  it('leading-dot-in-heading', () => {
    expect(reasons([node('scene', '.INTERCUT')])).toEqual(['leading-dot-in-heading'])
  })

  it('trailing-centre-marker', () => {
    expect(reasons([node('transition', 'SMASH CUT <')])).toEqual(['trailing-centre-marker'])
  })

  it('cue-not-recoverable, when the name contains what looks like a modifier', () => {
    // Writing `MEERA (V.O.)` for a cue named `MEERA (V.O.)` with no modifiers
    // would read back as `MEERA` with one. That is a lost character name.
    expect(reasons([node('character', 'MEERA (V.O.)'), node('dialogue', 'Hello.')])).toEqual([
      'cue-not-recoverable',
    ])
  })

  it('generated-text-in-content - the doubling bug seen from the other side', () => {
    expect(
      reasons([node('character', "MEERA (CONT'D)"), node('dialogue', 'Hello.')]),
    ).toEqual(['cue-not-recoverable', 'generated-text-in-content'])
    expect(
      reasons([node('character', 'MEERA'), node('paren', "(CONT'D)"), node('dialogue', 'X.')]),
    ).toEqual(['generated-text-in-content'])
    // A `(MORE)` on a dialogue line is both things at once, and both are said.
    expect(
      reasons([node('character', 'MEERA'), node('dialogue', 'One.\n(MORE)')]),
    ).toEqual(['parenthetical-line-in-dialogue', 'generated-text-in-content'])
  })

  it('mention-token-in-text', () => {
    expect(reasons([node('action', `${mentionToken('character', 'c1')} waits.`)])).toEqual([
      'mention-token-in-text',
    ])
  })

  it('unwritable-mention-id', () => {
    const bad: ScreenplayNode = makeScreenplayNode('action', {
      id: nodeId('m2'),
      provenance: typed(),
      content: [{ kind: 'mention', target: { entity: 'character', id: characterId('a}b') } }],
      modifiers: [],
    })
    expect(reasons([bad])).toEqual(['unwritable-mention-id'])
  })

  it('note-delimiter-in-content', () => {
    expect(reasons([node('comment', 'a ]] b')])).toEqual(['note-delimiter-in-content'])
  })

  it('paren-not-parenthesised', () => {
    expect(
      reasons([node('character', 'MEERA'), node('paren', 'beat'), node('dialogue', 'X.')]),
    ).toEqual(['paren-not-parenthesised'])
  })

  it('parenthetical-line-in-dialogue', () => {
    expect(reasons([node('character', 'MEERA'), node('dialogue', 'One.\n(beat)')])).toEqual([
      'parenthetical-line-in-dialogue',
    ])
  })

  it('orphan-in-dialogue-block', () => {
    expect(reasons([node('dialogue', 'Nobody said this.')])).toEqual(['orphan-in-dialogue-block'])
    expect(reasons([node('paren', '(beat)')])).toEqual(['orphan-in-dialogue-block'])
  })

  it('cue-not-recoverable, when forcing the cue would open a mention token', () => {
    // `@` + `{` is `@{`, which is how a mention starts, so it cannot also be
    // the cue forcing character. A lowercase cue named `{x}` has nowhere to go.
    expect(reasons([node('character', '{x}'), node('dialogue', 'Hello.')])).toEqual([
      'cue-not-recoverable',
    ])
  })

  it('adjacent-dialogue', () => {
    expect(
      reasons([node('character', 'MEERA'), node('dialogue', 'One.'), node('dialogue', 'Two.')]),
    ).toEqual(['adjacent-dialogue'])
  })

  it('still produces text, on a best-effort basis, for every one of them', () => {
    const broken = [node('dialogue', 'orphaned'), node('scene', ''), node('paren', 'beat')]
    expect(() => serialiseFountain(broken)).not.toThrow()
    expect(serialiseFountain(broken).text.length).toBeGreaterThan(0)
  })
})
