/**
 * The glyph set. Eighteen Unicode characters, rendered as text.
 *
 * AGENTS.md, UI fidelity: "**Every glyph is a Unicode character rendered as
 * text.**" and AGENTS.md, Deliberately not using: "**Any icon library.**"
 * eslint.config.mjs enforces the second by refusing the imports; this file is
 * the first.
 *
 * ## Two findings about this set, both verified rather than assumed
 *
 * **1. None of the eighteen exist in the three self-hosted families.** Every
 * character here is U+21C4 or above; the `latin` and `latin-ext` subsets we
 * serve for Instrument Sans, Newsreader and Courier Prime stop at U+2000-206F
 * with a handful of strays above it. So every one of these falls through to a
 * system symbol font. That is not fixable without adding a fourth family, which
 * is a dependency and a decision - so it is named here and in `type.css`
 * instead, where `--font-glyph` picks the fallback deliberately rather than
 * leaving each OS to guess.
 *
 * **2. Three of them have colour-emoji forms.** `▶` U+25B6, `☀` U+2600 and `⚙`
 * U+2699 appear in Unicode's emoji-variation-sequences, so a font with an emoji
 * table may render them as pictures - a green triangle in a rounded box where
 * the design wants a 14px mark in `--ink2`. `TEXT_PRESENTATION` below is that
 * list, and `glyph.tsx` appends U+FE0E, the text variation selector, to exactly
 * those three. The other fifteen have no emoji form and must not be given a
 * selector: an unnecessary VS15 can itself become a visible box in a font that
 * does not carry the sequence.
 *
 * Substituting a lookalike for any of these is refused. AGENTS.md treats the
 * set as specified, and `▸` for `▶` is precisely the quiet improvement the
 * spec's own preamble warns about.
 */

/**
 * Keyed by what the glyph *is for*, not by what it looks like. A rename of the
 * Bible route should not leave a `diamond` behind.
 */
export const GLYPHS = {
  /** Rail: Writing. */
  writing: '✎',
  /** Rail: Characters. */
  characters: '◍',
  /** Rail: Locations. */
  locations: '⌖',
  /** Rail: Timeline. */
  timeline: '◷',
  /** Rail: Bible. */
  bible: '◈',
  /** Rail: Research. */
  research: '▧',
  /** Rail: Insights. */
  insights: '◎',
  /** Rail: Production. Has an emoji form - see TEXT_PRESENTATION. */
  production: '▶',
  /** Theme toggle, shown when the next theme is dark. */
  themeDark: '☾',
  /** Theme toggle, shown when the next theme is light. Has an emoji form. */
  themeLight: '☀',
  /** Settings. Has an emoji form. */
  settings: '⚙',
  /** Episode nav: Script. */
  script: '▤',
  /** Episode nav: Outline. */
  outline: '⋮',
  /** Episode nav: Beats. */
  beats: '⧗',
  /** Episode nav: Storyboard. */
  storyboard: '▥',
  /** Episode nav: Scenes. */
  scenes: '▢',
  /** Episode nav: Revisions. */
  revisions: '⇄',
  /** Episode nav: Notes. */
  notes: '❝',
} as const

export type GlyphName = keyof typeof GLYPHS

/**
 * The nineteenth character, and it is flagged rather than folded into the set
 * above.
 *
 * AGENTS.md lists eighteen and the app-level sidebar needs a "New" mark that is
 * not among them. `＋` is U+FF0B FULLWIDTH PLUS SIGN, taken from
 * `Route - Script.dc.html`, which uses it for the panel's "New episode" button -
 * so it is transcribed from a bundle rather than invented, but it is outside
 * the set AGENTS.md writes down and a human should confirm it.
 *
 * It is exported separately so `GLYPHS` stays exactly the specified eighteen and
 * the verification test can count them.
 */
export const UNSPECIFIED_GLYPHS = {
  /** Sidebar: New. From the bundle's "New episode" button, not from AGENTS.md. */
  create: '＋',
} as const

export type UnspecifiedGlyphName = keyof typeof UNSPECIFIED_GLYPHS

/**
 * The characters that need U+FE0E to stay text.
 *
 * Checked against Unicode's emoji-variation-sequences: of the eighteen, exactly
 * U+25B6, U+2600 and U+2699 have a defined emoji presentation. `☾` U+263E does
 * not - U+263A is the smiling face that does, and the two are easy to confuse,
 * which is why this list is written out rather than derived from a range.
 */
export const TEXT_PRESENTATION: readonly string[] = [
  GLYPHS.production,
  GLYPHS.themeLight,
  GLYPHS.settings,
]

/** U+FE0E VARIATION SELECTOR-15. Asks for the text form of the preceding character. */
export const TEXT_VARIATION_SELECTOR = '\uFE0E'

/**
 * The character as it should actually be put in the DOM.
 *
 * Kept as a function rather than baked into `GLYPHS` so the raw characters stay
 * comparable to the ones written in AGENTS.md - a set whose members carry
 * invisible selectors is a set nobody can grep for.
 */
export const asText = (glyph: string): string =>
  TEXT_PRESENTATION.includes(glyph) ? `${glyph}${TEXT_VARIATION_SELECTOR}` : glyph
