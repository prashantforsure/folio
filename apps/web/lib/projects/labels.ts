import type { ProjectKind, ProjectType } from '@folio/contracts'
import type { ScriptFormat } from '@folio/script'
import type { GlyphName } from '@folio/ui'

/**
 * How the three creation axes read on screen.
 *
 * Typed as `Record<Union, …>` so a fourth kind, a `short` project type or a
 * third format is a compile error here before it is a blank label anywhere.
 *
 * ## The format labels say what the format *does*
 *
 * AGENTS.md, Pagination and the sheet: "`format` is an **input to the
 * engine**, not a print preference - it changes line width, page count, page
 * numbers and eighths." The competitor observation in `Route - New.dc.html`
 * captions it "It only sets page geometry, not how you write", and that is the
 * sentence the brief says not to write. So the label names the sheet, the
 * `meta` line names the geometry the engine reads, and the explanation of the
 * consequence lives once, in `FORMAT_CONSEQUENCE`, beside the control.
 */

export const KIND_LABEL: Record<ProjectKind, string> = {
  screenwriting: 'Screenwriting',
  filmmaking: 'Filmmaking',
}

/** The same glyphs the sidebar uses for the two sections, so a card and its list agree. */
export const KIND_GLYPH: Record<ProjectKind, GlyphName> = {
  screenwriting: 'writing',
  filmmaking: 'production',
}

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  film: 'Film',
  series: 'Series',
}

export const FORMAT_LABEL: Record<ScriptFormat, string> = {
  hollywood: 'Hollywood',
  asian: 'Asian',
}

/** The sheet each format resolves to. What the card shows, because it is what the engine reads. */
export const FORMAT_SHEET: Record<ScriptFormat, string> = {
  hollywood: 'US Letter',
  asian: 'A4',
}

/** Courier 12pt on both; only the sheet differs. Shown under each format option. */
export const FORMAT_META: Record<ScriptFormat, string> = {
  hollywood: 'US Letter · Courier 12pt',
  asian: 'A4 · Courier 12pt',
}

export const FORMAT_CONSEQUENCE =
  'Format is an input to the pagination engine, not a print preference. It sets the line ' +
  'width, and with it the page count, the page numbers and every scene’s eighths.'

/**
 * AGENTS.md open decision 8, disclosed where the choice is made.
 *
 * `resolveSheet('asian')` refuses until the A4 sheet width is ruled, so an A4
 * project cannot be paginated today. The server enforces that by refusing; the
 * client discloses it here rather than letting the writer find out from a page
 * count that never appears.
 */
export const ASIAN_FORMAT_NOTICE =
  'A4 pagination is not switched on yet: the sheet width for this format is still being ' +
  'decided. An A4 project can be written now and will show no page count until it is.'
