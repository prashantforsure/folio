import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { GLYPHS, UNSPECIFIED_GLYPHS } from '@folio/ui'
import { describe, expect, it } from 'vitest'

/**
 * The self-hosted fonts, checked against the stylesheet that declares them.
 *
 * Two claims are made repeatedly in this codebase and neither should be taken
 * on trust:
 *
 * **1. Nothing is fetched from a CDN.** AGENTS.md, Tech stack: "Self-hosted
 * Instrument Sans, Newsreader, Courier Prime." The design bundles link
 * `fonts.googleapis.com` in their `<helmet>` and it would be easy for that to
 * survive a copy-paste. Every `src` here must be a path on this origin.
 *
 * **2. None of AGENTS.md's eighteen glyphs is in any of the three families.**
 * That claim is why `--font-glyph` exists, why `glyph.tsx` forces text
 * presentation, and why the phase report says all eighteen render from a system
 * font. It is checked here from the `unicode-range` descriptors, which is a
 * stronger check than it looks: a browser will not even *consider* a face for a
 * codepoint outside its declared range, so the ranges are not a description of
 * the files - they are the rule the browser applies.
 *
 * If a future change swaps in full (unsubset) files, this test starts failing,
 * and the right response is to look at whether the glyphs now resolve from the
 * self-hosted stack and update `type.css` and the report - not to delete it.
 */

const FONTS_CSS = resolve(process.cwd(), 'app/fonts.css')
const fontsCss = readFileSync(FONTS_CSS, 'utf8')

// Strip comments: the header discusses `fonts.googleapis.com` by name.
const rules = fontsCss.replace(/\/\*[\s\S]*?\*\//g, '')

type Face = {
  readonly family: string
  readonly src: string
  readonly ranges: readonly (readonly [number, number])[]
}

const parseRanges = (raw: string): (readonly [number, number])[] =>
  raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [low, high] = part.replace(/^U\+/i, '').split('-')
      const start = Number.parseInt(low ?? '0', 16)
      const end = high === undefined ? start : Number.parseInt(high, 16)
      return [start, end] as const
    })

const faces: Face[] = [...rules.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => {
  const body = match[1] ?? ''
  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? ''
  const src = /url\('([^']+)'\)/.exec(body)?.[1] ?? ''
  const ranges = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? ''
  return { family, src, ranges: parseRanges(ranges) }
})

describe('the font declarations', () => {
  it('declares the three families AGENTS.md names, and no others', () => {
    expect([...new Set(faces.map((face) => face.family))].sort()).toEqual([
      'Courier Prime',
      'Instrument Sans',
      'Newsreader',
    ])
  })

  it('serves every face from this origin', () => {
    expect(faces.length).toBeGreaterThan(0)
    // Reported as one list rather than a loop of assertions, so a failure names
    // every offending face instead of stopping at the first.
    const remote = faces
      .filter((face) => !/^\/fonts\/[a-z0-9-]+\.woff2$/.test(face.src))
      .map((face) => `${face.family}: ${face.src}`)
    expect(remote).toEqual([])
  })

  it('references no remote host at all', () => {
    expect(rules).not.toContain('fonts.googleapis.com')
    expect(rules).not.toContain('fonts.gstatic.com')
    expect(rules).not.toContain('https://')
    expect(rules).not.toContain('http://')
  })

  it('gives every face a unicode-range, which is what makes the next test meaningful', () => {
    for (const face of faces) {
      expect({ src: face.src, ranges: face.ranges.length > 0 }).toEqual({
        src: face.src,
        ranges: true,
      })
    }
  })
})

describe('glyph coverage', () => {
  const covers = (face: Face, codePoint: number): boolean =>
    face.ranges.some(([start, end]) => codePoint >= start && codePoint <= end)

  it('has none of the eighteen glyphs in any self-hosted face', () => {
    // The finding this test exists to protect. All eighteen therefore render
    // from a system symbol font - see `--font-glyph` in packages/ui/src/tokens.
    for (const [name, glyph] of Object.entries(GLYPHS)) {
      const codePoint = glyph.codePointAt(0) ?? 0
      const carriers = faces.filter((face) => covers(face, codePoint)).map((face) => face.family)
      expect({ name, glyph, carriers }).toEqual({ name, glyph, carriers: [] })
    }
  })

  it('does not carry the unspecified extras either', () => {
    for (const [name, glyph] of Object.entries(UNSPECIFIED_GLYPHS)) {
      const codePoint = glyph.codePointAt(0) ?? 0
      const carriers = faces.filter((face) => covers(face, codePoint)).map((face) => face.family)
      expect({ name, glyph, carriers }).toEqual({ name, glyph, carriers: [] })
    }
  })

  it('does carry ordinary Latin text, so the fonts are doing their actual job', () => {
    for (const character of ['A', 'z', '0', '—', '’']) {
      const codePoint = character.codePointAt(0) ?? 0
      const carriers = faces.filter((face) => covers(face, codePoint))
      expect({ character, carried: carriers.length > 0 }).toEqual({ character, carried: true })
    }
  })

  it('carries no Devanagari, which the script sheet will eventually need', () => {
    // AGENTS.md's worked example is `मीरा`. Courier Prime has no Devanagari, so
    // a Hindi cue on the sheet will fall back to a system face whose metrics are
    // not the ones pagination assumes. Flagged, not solved: a fourth family is a
    // dependency and therefore a decision.
    const meera = 'म'.codePointAt(0) ?? 0
    expect(faces.filter((face) => covers(face, meera))).toEqual([])
  })
})
