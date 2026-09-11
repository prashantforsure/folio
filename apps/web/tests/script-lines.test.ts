// @vitest-environment node
import { lineCount, resolveSheet, wrapText } from '@folio/script'
import { describe, expect, it } from 'vitest'

import { lineCountOf, lineEndsOf } from '../lib/script/lines'
import type { ScriptInline } from '../lib/script/slate-model'

/**
 * The sheet draws the engine's lines, not the browser's.
 *
 * `lineEndsOf` is `wrapText` walked with editor offsets kept. If the two ever
 * disagree on where a line ends, the block on screen is a line taller or
 * shorter than the measurement record says and every page frame below it is
 * out by that line. So the property under test is exact agreement: for any
 * text and any measure, the number of line ends plus one is `lineCount`, and
 * cutting the text at the ends reproduces `wrapText` line for line.
 */

const NO_LABELS = (): undefined => undefined

const textChildren = (text: string): readonly ScriptInline[] => [{ text }]

/** Cut a single text child at the ends `lineEndsOf` returned, trimming as the engine does. */
const cut = (text: string, measure: number): readonly string[] => {
  const ends = lineEndsOf(textChildren(text), NO_LABELS, measure)
  const lines: string[] = []
  let from = 0
  for (const end of ends) {
    lines.push(text.slice(from, end.offset))
    from = end.offset
  }
  lines.push(text.slice(from))
  return lines.map((line) => line.replace(/\s+/gu, ' ').trim())
}

const SAMPLES: readonly string[] = [
  '',
  'x',
  'Wet washing hangs the length of the corridor. MEERA, 34, moves through it sideways, a steel tiffin held flat above her head.',
  'A tap coughs somewhere below. She stops. Listens.',
  'Teen baje tak paani nahi aayega. Bucket bhar lo, warna raat kaategi.',
  'supercalifragilisticexpialidocious-and-then-some-more-hyphenated-words',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'two  spaces   between    words here',
  '  leading and trailing spaces  ',
  'a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k',
  'exactly-sixty-characters-long-token-that-fills-the-measure-x',
]

describe('lineEndsOf agrees with wrapText', () => {
  const sheet = resolveSheet('hollywood')
  if (!sheet.ok) throw new Error('US Letter must resolve')
  const measures = [
    sheet.value.element.action.charsPerLine,
    sheet.value.element.dialogue.charsPerLine,
    sheet.value.element.paren.charsPerLine,
    sheet.value.element.transition.charsPerLine,
    4,
    1,
  ]

  for (const text of SAMPLES) {
    for (const measure of measures) {
      it(`"${text.slice(0, 24)}…" at ${String(measure)}: same count, same lines`, () => {
        const ends = lineEndsOf(textChildren(text), NO_LABELS, measure)
        expect(lineCountOf(ends)).toBe(lineCount(text, measure))
        const expected = wrapText(text, measure)
        // Hard-cut lines of a long word cannot be trimmed back into words; compare lengths there.
        const actual = cut(text, measure)
        expect(actual.length).toBe(expected.length)
        actual.forEach((line, index) => {
          expect(line.replace(/\s/gu, '')).toBe((expected[index] ?? '').replace(/\s/gu, ''))
        })
      })
    }
  }

  it('renders a mention by its label and counts it into the measure', () => {
    const children: readonly ScriptInline[] = [
      { text: 'Wet washing hangs the length of the corridor. ' },
      { type: 'mention', entity: 'character', id: 'c1', children: [{ text: '' }] },
      { text: ', 34, moves through it sideways, a steel tiffin held flat above her head.' },
    ]
    const labelFor = (): string => 'MEERA'
    const ends = lineEndsOf(children, labelFor, 60)
    const rendered =
      'Wet washing hangs the length of the corridor. MEERA, 34, moves through it sideways, a steel tiffin held flat above her head.'
    expect(lineCountOf(ends)).toBe(lineCount(rendered, 60))
    // Every end lands in a text child, never inside the mention.
    for (const end of ends) expect([0, 2]).toContain(end.child)
  })

  it('measures an unresolved mention as the engine does: one character', () => {
    const children: readonly ScriptInline[] = [
      { text: 'aaaa ' },
      { type: 'mention', entity: 'location', id: 'l1', children: [{ text: '' }] },
      { text: ' bbbb' },
    ]
    expect(lineCountOf(lineEndsOf(children, NO_LABELS, 6))).toBe(lineCount('aaaa x bbbb', 6))
  })
})
