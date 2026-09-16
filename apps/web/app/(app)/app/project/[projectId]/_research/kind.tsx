import type { ResearchCollectionColour, ResearchSourceKind } from '@folio/contracts'
import { RESEARCH_SOURCE_KIND_GLYPHS, RESEARCH_SOURCE_KIND_LABELS } from '@folio/contracts'
import type { CSSProperties } from 'react'

/**
 * The two hue families of `Route - Research v2.dc.html`, as styles.
 *
 * A source kind's colour is `oklch(L C H)` with `L`/`C` the theme's
 * (`--src-l` / `--src-c`, `palette.css`) and `H` the kind's
 * (`--src-<kind>-h`); a collection's dot the same at `--coll-*`. The
 * element sets `--src-h` / `--coll-h` here and a class in `globals.css`
 * (`.folio-src-hue`, `.folio-src-bar`, `.folio-coll-dot`) reads it - so the
 * one place a colour is composed is the stylesheet, and this file only
 * says which hue.
 */
export const kindHue = (kind: ResearchSourceKind): CSSProperties => ({ '--src-h': `var(--src-${kind}-h)` }) as CSSProperties

export const collectionHue = (colour: ResearchCollectionColour): CSSProperties =>
  ({ '--coll-h': `var(--coll-${colour}-h)` }) as CSSProperties

/** The card's and the drawer's kind badge: the glyph in the kind's hue, then the label. */
export const KindBadge = ({ kind, className }: { readonly kind: ResearchSourceKind; readonly className?: string }) => (
  <span
    data-source-kind={kind}
    className={`flex flex-none items-center gap-[7px] rounded-[7px] bg-s2 px-[9px] py-[3px] text-10-5 text-ink2 ${className ?? ''}`}
  >
    <span aria-hidden="true" className="folio-src-hue folio-mark text-11" style={kindHue(kind)}>
      {RESEARCH_SOURCE_KIND_GLYPHS[kind]}
    </span>
    {RESEARCH_SOURCE_KIND_LABELS[kind]}
  </span>
)

/** The glyph alone, in the kind's hue - the drawer's `Type` field and the type menu. */
export const KindGlyph = ({ kind }: { readonly kind: ResearchSourceKind }) => (
  <span aria-hidden="true" className="folio-src-hue folio-mark" style={kindHue(kind)}>
    {RESEARCH_SOURCE_KIND_GLYPHS[kind]}
  </span>
)
