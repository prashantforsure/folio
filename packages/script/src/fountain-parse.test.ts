import { describe, expect, it } from 'vitest'

import { mentionToken } from './fountain-syntax'
import type { FountainParse } from './fountain-parse'
import { countFountainNodes, parseFountain } from './fountain-parse'
import type { NodeId } from './ids'
import { characterId, locationId, nodeId, runId } from './ids'
import type { ScreenplayNode } from './node'
import { byAgent } from './provenance'

/**
 * Fountain text to the eight types.
 *
 * The mapping is the product here, so it is asserted element by element rather
 * than only through the round-trip properties. What the properties cannot see
 * is a mapping that is *consistently* wrong in both directions.
 */

const ids = (count: number): readonly NodeId[] =>
  Array.from({ length: count }, (_, index) => nodeId(`n${index}`))

const parse = (text: string): FountainParse => {
  const parsed = parseFountain(text, { freshIds: ids(countFountainNodes(text)) })
  if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`)
  return parsed.value
}

const shape = (node: ScreenplayNode): unknown => ({
  type: node.type,
  text: node.content.map((run) => (run.kind === 'text' ? run.text : '<mention>')).join(''),
  ...(node.type === 'character' ? { modifiers: node.modifiers } : {}),
})

const shapes = (text: string): readonly unknown[] => parse(text).nodes.map(shape)

// ---------------------------------------------------------------------------
// The eight types
// ---------------------------------------------------------------------------

describe('the mapping onto the eight types', () => {
  it('scene, action, character, paren, dialogue, transition', () => {
    expect(
      shapes(
        [
          'INT. THE CHAWL - NIGHT',
          '',
          'Rain. A door closes below.',
          '',
          'MEERA',
          '(quietly)',
          'You said the fifteenth.',
          '',
          'CUT TO:',
        ].join('\n'),
      ),
    ).toEqual([
      { type: 'scene', text: 'INT. THE CHAWL - NIGHT' },
      { type: 'action', text: 'Rain. A door closes below.' },
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'paren', text: '(quietly)' },
      { type: 'dialogue', text: 'You said the fifteenth.' },
      { type: 'transition', text: 'CUT TO:' },
    ])
  })

  it('comment is the [[ ]] note element', () => {
    expect(shapes('[[check this against the bible]]')).toEqual([
      { type: 'comment', text: 'check this against the bible' },
    ])
  })

  it('subtitle is centred text', () => {
    // A mapping decision, not a settled one - Fountain has no subtitle element
    // and the eight types do not widen. Flagged in the report.
    expect(shapes('> MUMBAI, 1997 <')).toEqual([{ type: 'subtitle', text: 'MUMBAI, 1997' }])
  })

  it('a note inside a speech stays a Comment and does not end the speech', () => {
    expect(
      shapes(['MEERA', 'Sit down.', '[[is this too blunt]]', 'Please.'].join('\n')),
    ).toEqual([
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'Sit down.' },
      { type: 'comment', text: 'is this too blunt' },
      { type: 'dialogue', text: 'Please.' },
    ])
  })

  it('consecutive dialogue lines are one node, and a paren splits them', () => {
    expect(
      shapes(['MEERA', 'One.', 'Two.', '(beat)', 'Three.'].join('\n')),
    ).toEqual([
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'One.\nTwo.' },
      { type: 'paren', text: '(beat)' },
      { type: 'dialogue', text: 'Three.' },
    ])
  })
})

describe('a parenthetical is one balanced group, not merely two brackets', () => {
  it.each([
    ['(a) and (b)', 'two groups, so it is dialogue'],
    [')a(', 'unbalanced, so it is dialogue'],
    ['(a', 'unclosed, so it is dialogue'],
  ])('%s - %s', (line) => {
    expect(shapes(['MEERA', line].join('\n'))).toEqual([
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: line },
    ])
  })
})

describe('forcing', () => {
  it.each([
    ['.INTERCUT - PHONE CALL', 'scene', 'INTERCUT - PHONE CALL'],
    ['!INT. THE CHAWL - NIGHT', 'action', 'INT. THE CHAWL - NIGHT'],
    ['>SMASH CUT', 'transition', 'SMASH CUT'],
  ])('%s is a %s', (line, type, text) => {
    expect(shapes(line)).toEqual([{ type, text }])
  })

  it('@ forces a cue that inference would miss', () => {
    // Devanagari has no case, so `मीरा` cannot be inferred - see deviation 1 in
    // `fountain-syntax.ts`. Without the force, every Hindi action line followed
    // by another would mint a character.
    expect(shapes('मीरा\nवह पीछे मुड़कर नहीं देखती।')).toEqual([
      { type: 'action', text: 'मीरा\nवह पीछे मुड़कर नहीं देखती।' },
    ])
    expect(shapes('@मीरा\nवह पीछे मुड़कर नहीं देखती।')).toEqual([
      { type: 'character', text: 'मीरा', modifiers: [] },
      { type: 'dialogue', text: 'वह पीछे मुड़कर नहीं देखती।' },
    ])
  })

  it('.. is an authored ellipsis, not a forced heading', () => {
    expect(shapes('..and then nothing')).toEqual([{ type: 'action', text: '..and then nothing' }])
  })

  it('a forced cue does not need a line after it', () => {
    expect(shapes('@MEERA')).toEqual([{ type: 'character', text: 'MEERA', modifiers: [] }])
  })
})

describe('a heading that runs straight into action', () => {
  it('is split, rather than swallowed into one Action node', () => {
    expect(shapes('INT. THE CHAWL - NIGHT\nRain on the window.')).toEqual([
      { type: 'scene', text: 'INT. THE CHAWL - NIGHT' },
      { type: 'action', text: 'Rain on the window.' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

describe('@mentions parse into structural references, not text', () => {
  it('a character mention in action', () => {
    const parsed = parse(`${mentionToken('character', 'chr_1')} waits at the gate.`)
    const node = parsed.nodes[0]
    expect(node?.content).toEqual([
      { kind: 'mention', target: { entity: 'character', id: characterId('chr_1') } },
      { kind: 'text', text: ' waits at the gate.' },
    ])
  })

  it('a location mention mid-line', () => {
    const parsed = parse(`Back at ${mentionToken('location', 'loc_9')} again.`)
    expect(parsed.nodes[0]?.content).toEqual([
      { kind: 'text', text: 'Back at ' },
      { kind: 'mention', target: { entity: 'location', id: locationId('loc_9') } },
      { kind: 'text', text: ' again.' },
    ])
  })

  it('an unknown entity or an empty id is text, not a broken mention', () => {
    expect(shapes('@{person:x} waits.')).toEqual([{ type: 'action', text: '@{person:x} waits.' }])
    expect(shapes('@{character:} waits.')).toEqual([
      { type: 'action', text: '@{character:} waits.' },
    ])
  })
})

// ---------------------------------------------------------------------------
// What has no home in the eight types
// ---------------------------------------------------------------------------

describe('elements outside the closed union are reported and dropped', () => {
  it.each([
    ['# Act One', 'section'],
    ['= She asks him for the money.', 'synopsis'],
    ['~ a song nobody sings', 'lyric'],
    ['===', 'page-break'],
    ['/* cut this whole beat */', 'boneyard'],
  ])('%s is %s', (line, kind) => {
    const parsed = parse(line)
    expect(parsed.nodes).toEqual([])
    expect(parsed.unsupported.map((element) => element.kind)).toEqual([kind])
  })

  it('the title page is dropped, and only at the top of the file', () => {
    const parsed = parse('Title: The Chawl\nCredit: written by\n\nFADE IN:')
    expect(parsed.unsupported.map((element) => element.kind)).toEqual(['title-page'])
    expect(parsed.nodes.map(shape)).toEqual([{ type: 'action', text: 'FADE IN:' }])
  })

  it('a first block with no key at all is script, not a title page', () => {
    const parsed = parse('FADE IN')
    expect(parsed.unsupported).toEqual([])
    expect(parsed.nodes.map(shape)).toEqual([{ type: 'action', text: 'FADE IN' }])
  })

  it('a line that merely looks like a title-page key further down is not one', () => {
    const parsed = parse('INT. A ROOM - DAY\n\nTitle: The Chawl')
    expect(parsed.unsupported).toEqual([])
    expect(parsed.nodes.map(shape)).toEqual([
      { type: 'scene', text: 'INT. A ROOM - DAY' },
      { type: 'action', text: 'Title: The Chawl' },
    ])
  })

  it('dual dialogue loses its caret and says so', () => {
    const parsed = parse('MEERA ^\nAt the same time.')
    expect(parsed.unsupported.map((element) => element.kind)).toEqual(['dual-dialogue'])
    expect(parsed.nodes.map(shape)).toEqual([
      { type: 'character', text: 'MEERA', modifiers: [] },
      { type: 'dialogue', text: 'At the same time.' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Ids and provenance
// ---------------------------------------------------------------------------

describe('the parser cannot mint an id', () => {
  it('refuses rather than inventing one, and says how many it wanted', () => {
    const text = 'INT. A ROOM - DAY\n\nShe waits.'
    const parsed = parseFountain(text, { freshIds: ids(1) })
    expect(parsed).toEqual({ ok: false, error: { kind: 'not-enough-ids', needed: 2, supplied: 1 } })
  })

  it('countFountainNodes answers the question before any id is spent', () => {
    const text = 'INT. A ROOM - DAY\n\nShe waits.\n\nMEERA\nHello.'
    expect(countFountainNodes(text)).toBe(4)
    const parsed = parseFountain(text, { freshIds: ids(4) })
    expect(parsed.ok).toBe(true)
  })

  it('refuses a duplicate id, which would break the comment join', () => {
    const parsed = parseFountain('INT. A ROOM - DAY\n\nShe waits.', {
      freshIds: [nodeId('same'), nodeId('same')],
    })
    expect(parsed).toEqual({ ok: false, error: { kind: 'duplicate-id', id: 'same' } })
  })

  it('refuses an empty id', () => {
    const parsed = parseFountain('She waits.', { freshIds: [nodeId('')] })
    expect(parsed).toEqual({ ok: false, error: { kind: 'empty-id', index: 0 } })
  })

  it('hands back the ids it did not need', () => {
    const parsed = parseFountain('She waits.', { freshIds: ids(3) })
    expect(parsed.ok && parsed.value.unusedIds).toEqual([nodeId('n1'), nodeId('n2')])
  })

  it('assigns ids in document order', () => {
    const parsed = parse('INT. A ROOM - DAY\n\nShe waits.')
    expect(parsed.nodes.map((node) => node.id)).toEqual([nodeId('n0'), nodeId('n1')])
  })
})

describe('provenance', () => {
  it('defaults to typed and carries an agent run when given one', () => {
    expect(parse('She waits.').nodes[0]?.provenance).toEqual({ source: 'typed' })
    const parsed = parseFountain('She waits.', {
      freshIds: ids(1),
      provenance: byAgent(runId('run_1')),
    })
    expect(parsed.ok && parsed.value.nodes[0]?.provenance).toEqual({
      source: 'agent',
      runId: 'run_1',
    })
  })
})

describe('nothing throws', () => {
  it.each(['', '\n\n\n', '   ', '((((', ']]]]', '@', '.', '>', '<', '~~~', '\r\n\r\n'])(
    'on %s',
    (text) => {
      expect(() => parse(text)).not.toThrow()
    },
  )
})
