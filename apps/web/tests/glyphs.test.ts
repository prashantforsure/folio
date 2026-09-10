import {
  GLYPHS,
  TEXT_PRESENTATION,
  TEXT_VARIATION_SELECTOR,
  UNSPECIFIED_GLYPHS,
  asText,
} from '@folio/ui'
import { describe, expect, it } from 'vitest'

/**
 * The glyph set, checked against AGENTS.md rather than against itself.
 *
 * AGENTS.md, UI fidelity writes the set out:
 *
 *     ✎ ◍ ⌖ ◷ ◈ ▧ ◎ ▶ ☾ ☀ ⚙ ▤ ⋮ ⧗ ▥ ▢ ⇄ ❝
 *
 * That line is transcribed below, in order, and compared. A test that iterated
 * `GLYPHS` and asserted things about whatever it found would keep passing after
 * somebody quietly swapped `▶` for `▸`; this one does not.
 *
 * What it cannot check is whether a glyph *renders*. That needs a browser and a
 * real font stack, and it is `e2e/glyphs.spec.ts`.
 */

// Transcribed from AGENTS.md, UI fidelity. Do not sort. Do not tidy.
const SPECIFIED = [
  '✎',
  '◍',
  '⌖',
  '◷',
  '◈',
  '▧',
  '◎',
  '▶',
  '☾',
  '☀',
  '⚙',
  '▤',
  '⋮',
  '⧗',
  '▥',
  '▢',
  '⇄',
  '❝',
]

describe('the glyph set', () => {
  it('is exactly the eighteen characters AGENTS.md lists, in that order', () => {
    expect(Object.values(GLYPHS)).toEqual(SPECIFIED)
  })

  it('holds no duplicates - two names for one mark would be two meanings for one mark', () => {
    expect(new Set(Object.values(GLYPHS)).size).toBe(SPECIFIED.length)
  })

  it('keeps the unspecified extras out of the specified set', () => {
    for (const extra of Object.values(UNSPECIFIED_GLYPHS)) {
      expect(SPECIFIED).not.toContain(extra)
    }
  })

  it('stores them without variation selectors, so the raw characters stay greppable', () => {
    for (const glyph of Object.values(GLYPHS)) {
      expect([...glyph]).toHaveLength(1)
    }
  })

  it('leaves every codepoint above U+2000, which is why --font-glyph has to exist', () => {
    // Not decoration. The `latin` and `latin-ext` subsets we self-host stop at
    // U+2000-206F plus strays, so none of these is in Instrument Sans,
    // Newsreader or Courier Prime. If a glyph ever falls inside that range the
    // note in `type.css` becomes wrong and should be corrected, not deleted.
    for (const glyph of SPECIFIED) {
      expect(glyph.codePointAt(0) ?? 0).toBeGreaterThan(0x2000)
    }
  })
})

describe('text presentation', () => {
  /*
   * From Unicode's emoji-variation-sequences: of the eighteen, exactly U+25B6,
   * U+2600 and U+2699 have an emoji presentation. `☾` U+263E does NOT - the
   * confusable is U+263A, which is not in our set.
   */
  it('names exactly the three characters that have an emoji form', () => {
    expect([...TEXT_PRESENTATION].sort()).toEqual(['▶', '☀', '⚙'].sort())
  })

  it('appends U+FE0E to those three and to nothing else', () => {
    for (const glyph of Object.values(GLYPHS)) {
      const rendered = asText(glyph)
      if (TEXT_PRESENTATION.includes(glyph)) {
        expect(rendered).toBe(`${glyph}${TEXT_VARIATION_SELECTOR}`)
      } else {
        expect(rendered).toBe(glyph)
      }
    }
  })
})
