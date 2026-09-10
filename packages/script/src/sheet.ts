import type { Result } from './result'
import { err, ok } from './result'
import type { RenderableNode } from './stream'

/**
 * Sheet geometry.
 *
 * AGENTS.md, Pagination and the sheet: "US Letter is 816px at 96dpi. Courier
 * Prime 12pt, 12 lines per inch. `format` is an **input to the engine**, not a
 * print preference - it changes line width, page count, page numbers and
 * eighths."
 *
 * That last sentence is why this file exists as a *value* rather than a set of
 * constants read at the point of use. A format is resolved once, at the door,
 * into a `SheetSpec`; everything downstream measures against the spec it was
 * handed and cannot consult a flag. A second surface deciding how wide a line
 * is would be a second authority on the page count, and export would stop
 * agreeing with the screen - which AGENTS.md, Export says is the whole reason
 * the layout engine is ours.
 *
 * ## Where the numbers come from
 *
 * Every horizontal figure below is read out of
 * `docs/ui design/Route - Script.dc.html`, the bundle that AGENTS.md says wins
 * on chrome, at the sheet element and its children. They are quoted per field.
 * Two figures are *derived* rather than read, and both are named as such:
 *
 *   - `charWidthPx` = 9.6. Courier Prime is metric-compatible with Courier: a
 *     600/1000em advance, so 12pt = 16px at 96dpi gives 16 x 0.6 = 9.6px, the
 *     ten-characters-to-the-inch pitch every screenplay measure assumes. It is
 *     not written down in this repo. It is confirmed by the bundle rather than
 *     merely assumed: the element insets there divide by 9.6 into whole
 *     numbers of characters (60 action, 35 dialogue, 25 parenthetical,
 *     15 transition), which would not happen on any other pitch. The cue is the
 *     one inset that does not divide exactly, and it is the exception that
 *     proves the point: the bundle writes 355px where the 3.7in cue indent is
 *     355.2px, so the design rounded to a whole pixel.
 *   - `marginBottomPx` = 96. The bundle sets `padding:96px 0 0` - a top margin
 *     and no bottom - plus a `min-height`, because a web sheet grows. A
 *     paginator cannot grow. One inch, matching the top, is the assumption; it
 *     is what sets `linesPerPage`, so it is the assumption that moves the page
 *     count most, and it is flagged in the report.
 *
 * ## LINES_PER_INCH is disputed and is not resolved here
 *
 * AGENTS.md says 12 lines per inch and this file implements 12. The design
 * bundle sets `font-size:16px;line-height:16px` on the sheet, which is 6 lines
 * per inch at 96dpi, and lays its blank gaps out in 16px and 32px steps. Both
 * cannot be true: 12pt type is 16px tall and cannot sit on an 8px grid.
 * `docs/ui design/README.md` lists "12 vs 6 lines per inch" as one of the two
 * rows it leaves open, and CLAUDE.md says to ask rather than infer.
 *
 * So: the figure is implemented exactly as AGENTS.md writes it, it is one
 * constant, and the golden page maps are regenerable in one deliberate step
 * (see `golden-page-map.test.ts`). Nothing else in the engine hard-codes a
 * line count. Re-ruling this to 6 is a one-line change plus a golden
 * regeneration with a visible diff - which is the whole reason the maps are
 * held the way they are.
 *
 * Vertical *gaps* are held in lines, not pixels, for the same reason: the
 * bundle's 16px and 32px gaps read as one and two blank lines on its own grid,
 * and a blank line is what the rule actually is.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** AGENTS.md: "US Letter is 816px at 96dpi." 816 over 8.5in fixes the dpi. */
export const DPI = 96

const POINTS_PER_INCH = 72

/** AGENTS.md: "Courier Prime 12pt". Version-pinned; the metric below is not. */
export const TYPE_SIZE_PT = 12

/** Courier and Courier Prime: 600/1000 em advance. Derived, not read. See header. */
export const COURIER_ADVANCE_EM = 0.6

/**
 * AGENTS.md, Pagination and the sheet: "12 lines per inch."
 *
 * Disputed by the design bundle, which is on 6. See the header. One constant,
 * one place, so the ruling is one edit.
 */
export const LINES_PER_INCH = 12

/** 12pt at 96dpi is 16px; 16 x 0.6 = 9.6. Ten characters to the inch. */
export const CHAR_WIDTH_PX = (TYPE_SIZE_PT / POINTS_PER_INCH) * DPI * COURIER_ADVANCE_EM

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/**
 * The two formats, named as the design bundle names them.
 *
 * `docs/ui design/Route - Script.dc.html` exposes `format` as
 * `hollywood | asian` and renders "US Letter - Courier 12pt" against the first
 * and "A4 - Courier 12pt" against the second.
 */
export const SCRIPT_FORMATS = ['hollywood', 'asian'] as const

export type ScriptFormat = (typeof SCRIPT_FORMATS)[number]

export const isScriptFormat = (value: string): value is ScriptFormat =>
  (SCRIPT_FORMATS as readonly string[]).includes(value)

// ---------------------------------------------------------------------------
// Element geometry
// ---------------------------------------------------------------------------

/**
 * Where one element type sits on the sheet, and what it costs above itself.
 *
 * `blankLinesBefore` is suppressed at the top of a page - a page never opens on
 * a blank line - which is the engine's business, not this record's.
 */
export type ElementMetric = {
  /** Inset from the left sheet edge, in px, as the bundle writes it. */
  readonly leftPx: number
  /** Inset from the right sheet edge, in px, as the bundle writes it. */
  readonly rightPx: number
  /** Whole characters that fit between the two insets. */
  readonly charsPerLine: number
  /** Blank lines above this element, mid-page. */
  readonly blankLinesBefore: number
}

/** Every type except `comment`; a comment has no geometry, by rule. */
export type ElementMetrics = Readonly<Record<RenderableNode['type'], ElementMetric>>

export type SheetSpec = {
  readonly format: ScriptFormat
  /** For display, and for the provenance line on a golden map. */
  readonly paper: string
  readonly widthPx: number
  readonly heightPx: number
  readonly marginTopPx: number
  readonly marginBottomPx: number
  readonly dpi: number
  readonly linesPerInch: number
  readonly lineHeightPx: number
  readonly charWidthPx: number
  /** The only vertical number the engine uses. Everything else is lines. */
  readonly linesPerPage: number
  readonly element: ElementMetrics
}

const charsBetween = (widthPx: number, leftPx: number, rightPx: number): number =>
  Math.floor((widthPx - leftPx - rightPx) / CHAR_WIDTH_PX)

/**
 * US Letter, read out of the Script route bundle.
 *
 * The insets, quoted from the sheet's children:
 *
 *   scene       `padding:0 96px 0 144px`                   144 / 96  -> 60 ch
 *   action      `padding:0 96px 0 144px`                   144 / 96  -> 60 ch
 *   character   `padding-left:355px;padding-right:96px`    355 / 96  -> 38 ch
 *   paren       `padding-left:298px;padding-right:278px`   298 / 278 -> 25 ch
 *   dialogue    `padding-left:240px;padding-right:240px`   240 / 240 -> 35 ch
 *   subtitle    the italic line under a speech, same box   240 / 240 -> 35 ch
 *   transition  `padding-left:576px;padding-right:96px`    576 / 96  -> 15 ch
 *
 * The gaps, on the bundle's own 16px grid: two blank lines above a scene
 * heading (`height:32px`), one above action, a cue, a subtitle and a transition
 * (`height:16px`), and none at all between a cue, its parenthetical and its
 * speech, which are consecutive with no spacer between them.
 */
const usLetter = (): SheetSpec => {
  const widthPx = 816
  const heightPx = 1056
  const marginTopPx = 96
  const marginBottomPx = 96
  const lineHeightPx = DPI / LINES_PER_INCH
  const metric = (leftPx: number, rightPx: number, blankLinesBefore: number): ElementMetric => ({
    leftPx,
    rightPx,
    charsPerLine: charsBetween(widthPx, leftPx, rightPx),
    blankLinesBefore,
  })
  return {
    format: 'hollywood',
    paper: 'US Letter',
    widthPx,
    heightPx,
    marginTopPx,
    marginBottomPx,
    dpi: DPI,
    linesPerInch: LINES_PER_INCH,
    lineHeightPx,
    charWidthPx: CHAR_WIDTH_PX,
    linesPerPage: Math.floor((heightPx - marginTopPx - marginBottomPx) / lineHeightPx),
    element: {
      scene: metric(144, 96, 2),
      action: metric(144, 96, 1),
      character: metric(355, 96, 1),
      paren: metric(298, 278, 0),
      dialogue: metric(240, 240, 0),
      subtitle: metric(240, 240, 1),
      transition: metric(576, 96, 1),
    },
  }
}

// ---------------------------------------------------------------------------
// The unresolved format
// ---------------------------------------------------------------------------

/**
 * What the two sources say, so an escalation can quote them without re-reading.
 *
 * This is evidence, not a shortlist to average. AGENTS.md open decision 8 is
 * one number and it has to be ruled, not interpolated.
 */
export type SheetWidthEvidence = {
  readonly source: string
  readonly widthPx: number
  readonly note: string
}

export const ASIAN_SHEET_WIDTH_EVIDENCE: readonly SheetWidthEvidence[] = [
  {
    source: 'AGENTS.md, open decisions, row 8',
    widthPx: 794,
    note: 'A4 is 210mm, 8.268in, 793.7px at 96dpi. The row exists because that is not 816.',
  },
  {
    source: 'docs/ui design/Route - Script.dc.html',
    widthPx: 816,
    note: 'The bundle draws one 816px sheet for both formats and changes only the label to "A4 - Courier 12pt". AGENTS.md warns the bundle figure may be the wrong one.',
  },
]

export type UnresolvedSheet = {
  readonly kind: 'sheet-width-unresolved'
  readonly format: ScriptFormat
  /** The row in the AGENTS.md open-decisions table. */
  readonly openDecision: 8
  readonly evidence: readonly SheetWidthEvidence[]
  readonly detail: string
}

/**
 * Resolve a format to a sheet, or refuse.
 *
 * `asian` refuses. Not a `TODO`, not 816 with a comment beside it, and not the
 * average of the two candidates: AGENTS.md, Development philosophy 10 says
 * never invent a product decision, and a silent default here would be
 * invisible. It would produce a plausible page count, a plausible eighths total
 * and a PDF that disagreed with every other A4 tool by 22px of line width.
 * Refusing is the only failure mode a caller can see.
 *
 * Everything else about `asian` is wired: the format reaches the engine as an
 * input, the measurement record carries it, the golden maps are per format. One
 * number is missing, and it is the number that has to be ruled.
 */
export const resolveSheet = (format: ScriptFormat): Result<SheetSpec, UnresolvedSheet> => {
  switch (format) {
    case 'hollywood':
      return ok(usLetter())
    case 'asian':
      return err({
        kind: 'sheet-width-unresolved',
        format,
        openDecision: 8,
        evidence: ASIAN_SHEET_WIDTH_EVIDENCE,
        detail:
          'Sheet width for format: asian is AGENTS.md open decision 8 and is unruled. ' +
          'The engine will not guess it: line width, page count, page numbers and eighths all move with it.',
      })
  }
}
