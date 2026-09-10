/**
 * What a theme is. Two values, and the default is `dark`.
 *
 * AGENTS.md, UI fidelity: "Theme is `dark` by default, via `data-theme`."
 *
 * This package owns the *vocabulary* and nothing else. Where the choice is
 * stored, when it is read, and how the first paint avoids a flash are all
 * behaviour, and `packages/ui` is presentational - AGENTS.md, Architecture:
 * "Primitives, tokens, theme. Presentational only - no data fetching, no domain
 * knowledge." The persistence lives in `apps/web/lib/state/theme.tsx`.
 */

export const THEMES = ['dark', 'light'] as const

export type Theme = (typeof THEMES)[number]

/** AGENTS.md, UI fidelity. An element with no `data-theme` ancestor is dark. */
export const DEFAULT_THEME: Theme = 'dark'

export const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value)

/** The other one. The toggle has exactly two states, so this is total. */
export const otherTheme = (theme: Theme): Theme => (theme === 'dark' ? 'light' : 'dark')

/**
 * The attribute the cascade reads. One name, one place, so a typo is a
 * compile-time reference rather than a theme that silently never switches.
 */
export const THEME_ATTRIBUTE = 'data-theme'
