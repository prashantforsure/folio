import { describe, expect, it } from 'vitest'

import { lineCount, wrapText } from './measure'
import { EIGHTHS_PER_PAGE, eighthsOf, formatEighths } from './paginate'
import type { ScriptFormat } from './sheet'
import {
  ASIAN_SHEET_WIDTH_EVIDENCE,
  CHAR_WIDTH_PX,
  DPI,
  LINES_PER_INCH,
  SCRIPT_FORMATS,
  isScriptFormat,
  resolveSheet,
} from './sheet'

/**
 * The sheet.
 *
 * Every number asserted here is quoted from somewhere. The horizontal ones come
 * out of `docs/ui design/Route - Script.dc.html`; the vertical ones out of
 * AGENTS.md. Where the two disagree - lines per inch - the test asserts what is
 * implemented and names the disagreement, rather than picking a side quietly.
 */

const hollywood = () => {
  const sheet = resolveSheet('hollywood')
  if (!sheet.ok) throw new Error('US Letter must resolve')
  return sheet.value
}

describe('the format is an engine input', () => {
  it('is a closed set of two, named as the design bundle names them', () => {
    expect(SCRIPT_FORMATS).toEqual(['hollywood', 'asian'])
    expect(isScriptFormat('hollywood')).toBe(true)
    expect(isScriptFormat('asian')).toBe(true)
    expect(isScriptFormat('a4')).toBe(false)
  })

  it('resolves to geometry once, at the door, not to a flag read later', () => {
    const sheet = hollywood()
    expect(sheet.format).toBe('hollywood')
    expect(sheet.paper).toBe('US Letter')
  })
})

describe('US Letter', () => {
  it('is 816px at 96dpi, as AGENTS.md writes it', () => {
    const sheet = hollywood()
    expect(sheet.widthPx).toBe(816)
    expect(sheet.dpi).toBe(DPI)
    expect(sheet.widthPx / sheet.dpi).toBe(8.5)
    expect(sheet.heightPx / sheet.dpi).toBe(11)
  })

  it('measures Courier Prime 12pt at ten characters to the inch', () => {
    expect(CHAR_WIDTH_PX).toBe(9.6)
    expect(CHAR_WIDTH_PX * 10).toBe(DPI)
  })

  /**
   * The confirmation that 9.6 is the right pitch: the bundle's insets divide by
   * it into whole characters. On any other pitch they would not.
   *
   * The cue is the one exception and it is the exception that proves it. The
   * bundle writes `padding-left:355px`, and 3.7in - the cue indent every
   * screenplay uses - is 355.2px at 96dpi. The design rounded to a whole pixel;
   * the measure is 38 characters either way.
   */
  it('gives every element the measure its inset in the bundle implies', () => {
    const sheet = hollywood()
    const chars = Object.fromEntries(
      Object.entries(sheet.element).map(([type, metric]) => [type, metric.charsPerLine]),
    )
    expect(chars).toEqual({
      scene: 60,
      action: 60,
      character: 38,
      paren: 25,
      dialogue: 35,
      subtitle: 35,
      transition: 15,
    })
    for (const [type, metric] of Object.entries(sheet.element)) {
      if (type === 'character') continue
      const width = sheet.widthPx - metric.leftPx - metric.rightPx
      expect(width % CHAR_WIDTH_PX).toBeCloseTo(0, 6)
    }
    expect(sheet.element.character.leftPx).toBe(355)
    expect(3.7 * DPI).toBeCloseTo(355.2, 6)
  })

  it('spaces elements in blank lines, as the bundle spaces them in 16px steps', () => {
    const sheet = hollywood()
    expect(sheet.element.scene.blankLinesBefore).toBe(2)
    expect(sheet.element.action.blankLinesBefore).toBe(1)
    expect(sheet.element.character.blankLinesBefore).toBe(1)
    expect(sheet.element.paren.blankLinesBefore).toBe(0)
    expect(sheet.element.dialogue.blankLinesBefore).toBe(0)
    expect(sheet.element.transition.blankLinesBefore).toBe(1)
  })

  /**
   * AGENTS.md wrote twelve. The design bundle draws six (`line-height:16px` at
   * 96dpi), and the client ruled six on 2026-09-11 (`docs/build-decisions.md`,
   * Script route phase). This asserts the ruling so that a change back is a
   * visible test change and a golden regeneration, not a silent drift.
   */
  it('is on six lines to the inch, as ruled for the Script route', () => {
    const sheet = hollywood()
    expect(LINES_PER_INCH).toBe(6)
    expect(sheet.linesPerInch).toBe(6)
    expect(sheet.lineHeightPx).toBe(16)
    expect(sheet.marginTopPx).toBe(96)
    expect(sheet.marginBottomPx).toBe(96)
    expect(sheet.linesPerPage).toBe(54)
  })
})

describe('format: asian', () => {
  it('refuses rather than paginating at Letter width', () => {
    const sheet = resolveSheet('asian')
    expect(sheet.ok).toBe(false)
    if (sheet.ok) return
    expect(sheet.error.kind).toBe('sheet-width-unresolved')
    expect(sheet.error.openDecision).toBe(8)
    expect(sheet.error.format).toBe('asian')
  })

  it('reports both candidate widths as evidence and neither as a choice', () => {
    const widths = ASIAN_SHEET_WIDTH_EVIDENCE.map((entry) => entry.widthPx)
    expect(widths).toEqual([794, 816])
    // Not a default and not an average. Both would be a product decision.
    const sheet = resolveSheet('asian')
    expect(sheet.ok).toBe(false)
    if (sheet.ok) return
    expect(sheet.error.evidence).toHaveLength(2)
  })

  it('returns the refusal rather than throwing it', () => {
    const formats: readonly ScriptFormat[] = SCRIPT_FORMATS
    for (const format of formats) {
      expect(() => resolveSheet(format)).not.toThrow()
    }
  })
})

describe('measuring text', () => {
  it('wraps greedily on whitespace', () => {
    expect(wrapText('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc'])
    expect(wrapText('aaaa bbbb cccc', 14)).toEqual(['aaaa bbbb cccc'])
  })

  it('breaks a word wider than the measure rather than overhanging it', () => {
    expect(wrapText('aaaaaaaaaa', 4)).toEqual(['aaaa', 'aaaa', 'aa'])
    expect(wrapText('ab cdefghij', 4)).toEqual(['ab', 'cdef', 'ghij'])
  })

  it('gives an empty node its line: the caret sits on it', () => {
    expect(lineCount('', 60)).toBe(1)
    expect(lineCount('   ', 60)).toBe(1)
  })

  it('never returns fewer than one line, at any measure', () => {
    expect(lineCount('x', 0)).toBe(1)
    expect(lineCount('x', -5)).toBe(1)
  })

  it('handles a word that is an exact multiple of the measure', () => {
    expect(wrapText('aaaaaaaa', 4)).toEqual(['aaaa', 'aaaa'])
    expect(wrapText('ab aaaaaaaa', 4)).toEqual(['ab', 'aaaa', 'aaaa'])
  })
})

describe('eighths', () => {
  it('is eight to the page, rounded, never below one for a scene that exists', () => {
    expect(EIGHTHS_PER_PAGE).toBe(8)
    expect(eighthsOf(54, 54)).toBe(8)
    expect(eighthsOf(27, 54)).toBe(4)
    expect(eighthsOf(1, 54)).toBe(1)
    expect(eighthsOf(0, 54)).toBe(0)
  })

  it('prints the way the breakdown column in the Script bundle prints', () => {
    expect(formatEighths(2)).toBe('2/8')
    expect(formatEighths(7)).toBe('7/8')
    expect(formatEighths(8)).toBe('1')
    expect(formatEighths(17)).toBe('2 1/8')
    expect(formatEighths(12)).toBe('1 4/8')
  })
})
