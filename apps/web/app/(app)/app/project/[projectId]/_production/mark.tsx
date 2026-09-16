import { asText } from '@folio/ui'

import type { Tone } from '../../../../../../lib/production/view'

/**
 * A character the mockup writes as text - `✦` on an AI action, `◐` on the
 * credits chip and a queued tile, `▶` on Render, `⚠` on a refusal, `◍` and
 * `⌖` on an empty tile. Kept as text in `--font-glyph`, as `@folio/ui`'s
 * `Glyph` keeps the rail's set: `asText` appends U+FE0E to the characters
 * that have an emoji form (`▶`), and `⚠` (U+26A0, also one) gets it here,
 * since it is outside that set. Decoration beside a label, so hidden from
 * the accessibility tree.
 */
const EMOJI_PRONE = new Set(['⚠'])

export const Mark = ({ glyph, tone, className }: { readonly glyph: string; readonly tone?: Tone; readonly className?: string }) => (
  <span aria-hidden="true" className={`folio-mark ${tone === undefined ? '' : 'folio-tone-ink'} ${className ?? ''}`} data-tone={tone}>
    {EMOJI_PRONE.has(glyph) ? `${glyph}︎` : asText(glyph)}
  </span>
)
