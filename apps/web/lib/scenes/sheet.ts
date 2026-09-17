import type { ElementMetric, ScriptFormat, SheetSpec, UnresolvedSheet } from '@folio/script'
import { resolveSheet } from '@folio/script'

import type { ExcerptLine } from './excerpt'

/**
 * How the reading modal lays a scene out (`_scenes/script-modal.tsx`),
 * pure and tested (`tests/scenes-sheet.test.ts`).
 *
 * ## The insets are the sheet's, the wrap is the browser's
 *
 * The modal draws the scene in Courier at the sheet's own geometry - a cue
 * at 3.7in, a speech between 2.5in margins, a transition against the right
 * - but as *proportions* of the sheet's width rather than its pixels, so
 * the page reads the same in a 720px panel as it would at 816. What it
 * does not do is wrap where the engine wraps: the panel is narrower than a
 * page, and the ruling for the Script route holds here (2026-09-16 -
 * "the screen no longer wraps where it wraps; counts, eighths and export
 * are the engine's"). A line count is never read off this render.
 *
 * ## `asian` refuses, here as everywhere
 *
 * `resolveSheet('asian')` is open decision 8 and refuses; the modal's
 * `Hollywood | Asian` toggle passes the format straight through, so the
 * Asian tab shows the engine's refusal - its detail and its evidence - in
 * the sheet's place, and a way back to Hollywood. The toggle is real: it
 * asks the engine the same question the Script route's Format menu asks.
 */

export type ReadingInset = {
  /** `padding-left`, as a percentage of the sheet width. */
  readonly left: string
  /** `padding-right`, as a percentage of the sheet width. */
  readonly right: string
  /** Blank lines above the element, mid-page. Zero on the first line. */
  readonly blankLinesBefore: number
}

export type ReadingLayout =
  | { readonly ok: true; readonly spec: SheetSpec; readonly inset: (type: ExcerptLine['type'], first: boolean) => ReadingInset }
  | { readonly ok: false; readonly refusal: UnresolvedSheet }

const percent = (px: number, of: number): string => `${String(Math.round((px / of) * 10_000) / 100)}%`

const insetOf = (metric: ElementMetric, widthPx: number, first: boolean): ReadingInset => ({
  left: percent(metric.leftPx, widthPx),
  right: percent(metric.rightPx, widthPx),
  // A page never opens on a blank line; neither does the sheet in the modal.
  blankLinesBefore: first ? 0 : metric.blankLinesBefore,
})

/** The layout for a format: the sheet's insets as proportions, or the engine's refusal. */
export const readingLayout = (format: ScriptFormat): ReadingLayout => {
  const sheet = resolveSheet(format)
  if (!sheet.ok) return { ok: false, refusal: sheet.error }
  const spec = sheet.value
  return {
    ok: true,
    spec,
    inset: (type, first) => insetOf(spec.element[type], spec.widthPx, first),
  }
}

/** The formats the toggle offers, in the Script route's order, with the mockup's page names. */
export const READING_FORMATS: readonly { readonly id: ScriptFormat; readonly label: string; readonly page: string }[] = [
  { id: 'hollywood', label: 'Hollywood', page: 'US Letter · Courier 12pt' },
  { id: 'asian', label: 'Asian', page: 'A4 · Courier 12pt' },
]
