import type { CSSProperties } from 'react'

import { GLYPHS, UNSPECIFIED_GLYPHS, asText } from './glyphs'
import type { GlyphName, UnspecifiedGlyphName } from './glyphs'

/**
 * A glyph, as text.
 *
 * The whole of AGENTS.md's "no icon library" rule reduces to this component
 * existing and there being nothing else. It renders one character in
 * `--font-glyph` and does not accept arbitrary content, so the set stays the
 * set: a name that is not in `GLYPHS` or `UNSPECIFIED_GLYPHS` is a type error,
 * not a box on the screen.
 *
 * ## Why it is a component rather than a string in the markup
 *
 * Three reasons, and each is a bug it prevents.
 *
 * **Presentation.** `▶`, `☀` and `⚙` have colour-emoji forms. Written straight
 * into JSX they render as pictures on any machine whose font stack reaches an
 * emoji face first - which on Windows and macOS is most of them. `asText()`
 * appends U+FE0E to exactly those three. `font-variant-emoji: text` says the
 * same thing to browsers that support it; both are cheap and neither is
 * reliable alone.
 *
 * **The font stack.** These characters are in none of the three self-hosted
 * families (see `glyphs.ts`), so they always resolve out of a system font. This
 * is where that fallback is named once instead of inherited by accident from
 * whatever the parent happened to be.
 *
 * **Accessibility.** A glyph is decoration beside a label almost everywhere in
 * this design - the rail is labelled, not icon-only. So it is `aria-hidden` by
 * default and a screen reader gets the adjacent text. Where a glyph really is
 * the only content, `label` supplies an accessible name and the character is
 * still hidden from the accessibility tree, which is the standard pairing.
 */

type GlyphProps = {
  /** One of AGENTS.md's eighteen, or one of the flagged extras. */
  readonly name: GlyphName | UnspecifiedGlyphName
  /**
   * An accessible name. Supply it only when the glyph is the sole content of
   * its control; beside a visible label it would be a duplicate announcement.
   */
  readonly label?: string
  readonly className?: string
  readonly style?: CSSProperties
}

const characterFor = (name: GlyphName | UnspecifiedGlyphName): string =>
  name in GLYPHS
    ? GLYPHS[name as GlyphName]
    : UNSPECIFIED_GLYPHS[name as UnspecifiedGlyphName]

export const Glyph = ({ name, label, className, style }: GlyphProps) => {
  const character = asText(characterFor(name))
  const composed: CSSProperties = {
    fontFamily: 'var(--font-glyph)',
    fontVariantEmoji: 'text',
    lineHeight: 1,
    ...style,
  }

  if (label === undefined) {
    return (
      <span aria-hidden="true" className={className} style={composed}>
        {character}
      </span>
    )
  }

  return (
    <span role="img" aria-label={label} className={className} style={composed}>
      <span aria-hidden="true">{character}</span>
    </span>
  )
}
