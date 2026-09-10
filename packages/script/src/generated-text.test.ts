import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  carriesGeneratedText,
  isContinuedLine,
  isMoreLine,
  readCue,
  stripGeneratedFromLine,
  writeCue,
} from './generated-text'
import { DELIVERY_MODIFIERS } from './node'

/**
 * The one place `(V.O.)` is told from `(CONT'D)`.
 *
 * AGENTS.md, exception table "Generated text is never in the node stream -
 * except": the first is authored and stored as a node attribute, the second is
 * a layout artefact and stripped on import. "Conflate the two and every `.fdx`
 * round-trip doubles the continueds."
 */

describe('authored modifiers are kept', () => {
  it.each([
    ['MEERA (V.O.)', 'MEERA', ['V.O.']],
    ['MEERA (O.S.)', 'MEERA', ['O.S.']],
    ['MEERA (O.C.)', 'MEERA', ['O.C.']],
    // Dots and spaces are noise; the canonical form is what is stored.
    ['MEERA (VO)', 'MEERA', ['V.O.']],
    ['MEERA (V.O)', 'MEERA', ['V.O.']],
    ['MEERA (V. O.)', 'MEERA', ['V.O.']],
    ['MEERA (v.o.)', 'MEERA', ['V.O.']],
    ['MEERA (V.O.) (O.S.)', 'MEERA', ['V.O.', 'O.S.']],
    // Duplicates collapse: two of the same modifier is not a state to hold.
    ['MEERA (V.O.) (V.O.)', 'MEERA', ['V.O.']],
  ])('%s', (raw, name, modifiers) => {
    const cue = readCue(raw)
    expect(cue.name).toBe(name)
    expect(cue.modifiers).toEqual(modifiers)
    expect(cue.artefacts).toEqual([])
  })
})

describe('generated text is stripped, in every spelling seen in the wild', () => {
  it.each([
    "MEERA (CONT'D)",
    'MEERA (CONT’D)',
    'MEERA (CONTD)',
    'MEERA (CONT D)',
    "MEERA (cont'd)",
    "MEERA (CONT'D.)",
    'MEERA (CONT`D)',
    'MEERA (CONT´D)',
  ])('%s keeps the name and loses the continued', (raw) => {
    const cue = readCue(raw)
    expect(cue.name).toBe('MEERA')
    expect(cue.modifiers).toEqual([])
    expect(cue.artefacts.map((artefact) => artefact.kind)).toEqual(['cont-d'])
  })

  it('keeps the authored modifier and drops the generated one from the same cue', () => {
    const cue = readCue('MEERA (V.O.) (CONT’D)')
    expect(cue.name).toBe('MEERA')
    expect(cue.modifiers).toEqual(['V.O.'])
    expect(cue.artefacts.map((artefact) => artefact.text)).toEqual(['(CONT’D)'])
  })

  it('does not care what order they were written in', () => {
    const cue = readCue("MEERA (CONT'D) (V.O.)")
    expect(cue.name).toBe('MEERA')
    expect(cue.modifiers).toEqual(['V.O.'])
    expect(cue.artefacts).toHaveLength(1)
  })

  it.each(['(MORE)', '(more)', '( MORE )', '(MORE...)', '(MORE…)'])(
    '%s is a whole line of generated text',
    (line) => {
      expect(isMoreLine(line)).toBe(true)
    },
  )

  it.each(["(CONT'D)", '(CONT’D)', '(contd)'])('%s is a continued on its own line', (line) => {
    expect(isContinuedLine(line)).toBe(true)
  })

  it('(CONTINUED) is not one of the two spellings AGENTS.md names', () => {
    // Final Draft's scene-level `(CONTINUED)` is a different artefact and is
    // deliberately out of scope here. Flagged in the report as a gap.
    expect(isContinuedLine('(CONTINUED)')).toBe(false)
    expect(readCue('MEERA (CONTINUED)').artefacts).toEqual([])
  })
})

describe('what is not a modifier and not an artefact stays part of the name', () => {
  it.each(['MEERA (17)', 'MEERA (on the phone)', 'MEERA (in Hindi)', 'THE VOICE (2)'])(
    '%s',
    (raw) => {
      const cue = readCue(raw)
      expect(cue.name).toBe(raw)
      expect(cue.modifiers).toEqual([])
      expect(cue.artefacts).toEqual([])
    },
  )

  it('stops at the first group it does not recognise', () => {
    const cue = readCue("MEERA (17) (CONT'D)")
    expect(cue.name).toBe('MEERA (17)')
    expect(cue.artefacts).toHaveLength(1)
  })
})

describe('the dual-dialogue caret', () => {
  it('is taken off and reported, because the node model has nowhere to put it', () => {
    expect(readCue('MEERA ^')).toMatchObject({ name: 'MEERA', dual: true })
    expect(readCue('MEERA (V.O.) ^')).toMatchObject({
      name: 'MEERA',
      modifiers: ['V.O.'],
      dual: true,
    })
  })

  it('is found on whichever side of the modifiers it was written', () => {
    expect(readCue('MEERA ^ (V.O.)')).toMatchObject({
      name: 'MEERA',
      modifiers: ['V.O.'],
      dual: true,
    })
  })
})

describe('stripping a line that is not a cue', () => {
  it('removes the continued from a line that became Action', () => {
    // Fountain only infers a cue when a line follows, so this one is Action -
    // and AGENTS.md does not qualify the ban by element type.
    expect(stripGeneratedFromLine('MEERA (V.O.) (CONT’D)')).toEqual({
      text: 'MEERA (V.O.)',
      artefacts: [{ kind: 'cont-d', text: '(CONT’D)' }],
    })
  })

  it('leaves a line with nothing generated on it completely alone', () => {
    for (const line of ['INT. HOUSE (KITCHEN)', 'She waits (beat)', 'MEERA (17)', '']) {
      expect(stripGeneratedFromLine(line)).toEqual({ text: line, artefacts: [] })
    }
  })

  it('leaves nothing behind when the line was only generated text', () => {
    expect(stripGeneratedFromLine('(MORE)').text).toBe('')
  })
})

describe('properties', () => {
  it('writeCue then readCue is an identity on authored cues', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('MEERA', 'ARJUN', 'THE LANDLORD', 'मीरा', 'meera'),
        fc.uniqueArray(fc.constantFrom(...DELIVERY_MODIFIERS), { maxLength: 3 }),
        (name, modifiers) => {
          const cue = readCue(writeCue(name, modifiers))
          expect(cue.name).toBe(name)
          expect(cue.modifiers).toEqual(modifiers)
          expect(cue.artefacts).toEqual([])
          expect(cue.dual).toBe(false)
        },
      ),
    )
  })

  it('there is no way to write a cue that reads back carrying generated text', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('MEERA', 'ARJUN', 'मीरा'),
        fc.uniqueArray(fc.constantFrom(...DELIVERY_MODIFIERS), { maxLength: 3 }),
        (name, modifiers) => {
          expect(carriesGeneratedText(writeCue(name, modifiers))).toBe(false)
        },
      ),
    )
  })

  it('stripping is idempotent - a second pass finds nothing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "MEERA (CONT'D)",
          'MEERA (V.O.) (CONT’D)',
          '(MORE)',
          'She waits.',
          "MEERA (CONT'D) (CONT'D)",
        ),
        (line) => {
          const once = stripGeneratedFromLine(line)
          const twice = stripGeneratedFromLine(once.text)
          expect(twice.artefacts).toEqual([])
          expect(twice.text).toBe(once.text)
        },
      ),
    )
  })
})
