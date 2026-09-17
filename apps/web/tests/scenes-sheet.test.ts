// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { READING_FORMATS, readingLayout } from '../lib/scenes/sheet'

/**
 * The reading modal's layout: the sheet's insets as proportions, and the
 * engine's refusal carried through untouched.
 */

describe('readingLayout', () => {
  it('hollywood lays out at the US Letter insets, as proportions of 816px', () => {
    const layout = readingLayout('hollywood')
    expect(layout.ok).toBe(true)
    if (!layout.ok) return
    expect(layout.spec.paper).toBe('US Letter')
    // scene / action: 144 / 96 of 816.
    expect(layout.inset('action', false)).toEqual({ left: '17.65%', right: '11.76%', blankLinesBefore: 1 })
    // character: 355 / 96; paren 298 / 278; dialogue 240 / 240; transition 576 / 96.
    expect(layout.inset('character', false).left).toBe('43.5%')
    expect(layout.inset('paren', false)).toEqual({ left: '36.52%', right: '34.07%', blankLinesBefore: 0 })
    expect(layout.inset('dialogue', false).right).toBe('29.41%')
    expect(layout.inset('transition', false).left).toBe('70.59%')
  })

  it('the first line never opens on a blank line', () => {
    const layout = readingLayout('hollywood')
    if (!layout.ok) throw new Error('hollywood resolves')
    expect(layout.inset('scene', true).blankLinesBefore).toBe(0)
    expect(layout.inset('scene', false).blankLinesBefore).toBe(2)
  })

  it("asian is the engine's refusal - open decision 8 - not a guessed sheet", () => {
    const layout = readingLayout('asian')
    expect(layout.ok).toBe(false)
    if (layout.ok) return
    expect(layout.refusal.kind).toBe('sheet-width-unresolved')
    expect(layout.refusal.openDecision).toBe(8)
    expect(layout.refusal.evidence.length).toBeGreaterThan(0)
  })

  it('the toggle offers the two formats in the Script route order, hollywood first', () => {
    expect(READING_FORMATS.map((format) => format.id)).toEqual(['hollywood', 'asian'])
  })
})
