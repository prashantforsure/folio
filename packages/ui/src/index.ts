/**
 * @folio/ui - primitives, tokens, theme. Presentational only.
 *
 * AGENTS.md, Architecture: "Primitives, tokens, theme. Presentational only - no
 * data fetching, no domain knowledge." Read literally that also rules out
 * importing `@folio/db` or `@folio/script`, and this package imports neither.
 * The one place that bites is the revision colour list, which exists in
 * `@folio/script` as the authority - see `revision-swatch.tsx` for the
 * transcription and the test that keeps it honest.
 *
 * ## The token layer is CSS, not TypeScript
 *
 * `src/tokens/index.css` is the artefact. Nothing here exports a hex string,
 * and no component reads a colour into JavaScript, because a colour that has
 * been read into JavaScript has left the cascade - and the cascade is the only
 * thing that can express `[data-theme='light']` nested inside a dark page,
 * which is the reason AGENTS.md bans Tailwind's `dark:` variant.
 *
 * An app imports the stylesheet by path:
 *
 * ```css
 * @import '@folio/ui/tokens.css';
 * ```
 *
 * and the TypeScript surface here is vocabulary and components only.
 */
export const PACKAGE_NAME = '@folio/ui'

export { GLYPHS, TEXT_PRESENTATION, TEXT_VARIATION_SELECTOR, UNSPECIFIED_GLYPHS, asText } from './glyphs'
export type { GlyphName, UnspecifiedGlyphName } from './glyphs'
export { Glyph } from './glyph'

export { DEFAULT_THEME, THEME_ATTRIBUTE, THEMES, isTheme, otherTheme } from './theme'
export type { Theme } from './theme'

export {
  REVISION_COLOUR_NAMES,
  RevisionSwatch,
  isRevisionColourName,
  revisionColourVar,
} from './revision-swatch'
export type { RevisionColourName } from './revision-swatch'

export { Avatar } from './avatar'

export { Editable } from './editable'
export { IdentityChip } from './identity-chip'
