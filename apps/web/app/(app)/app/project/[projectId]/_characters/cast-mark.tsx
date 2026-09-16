import type { CSSProperties } from 'react'

/**
 * A character's identity mark - `Route - Characters v2.dc.html`'s
 * `linear-gradient(150deg, a, b)` chip with white initials: 24px at an 8px
 * radius in the sidebar, a 26px disc on a graph node, 22px at 7px in the
 * drawer's `Shares scenes with`. The gradient is `.folio-cast-mark`
 * (`globals.css`), off the record's hue: `--cast-h` is set here from the
 * record's authored colour (`--chip-N-h`, `palette.css`), so the flat chip
 * the other routes draw and the gradient this one does are one colour.
 *
 * `face` is the three-stop face (`.folio-cast-face`) the drawer's 78×98
 * tile draws, 26px/300 initials.
 */
export const castHue = (hue: number): CSSProperties =>
  ({ '--cast-h': `var(--chip-${String(hue)}-h)` }) as CSSProperties

export const CastMark = ({
  initial,
  hue,
  size,
  radius,
  fontSize,
  face = false,
  className,
}: {
  readonly initial: string
  /** 1..10 - `--chip-1-h` to `--chip-10-h`. */
  readonly hue: number
  readonly size: number | { readonly width: number; readonly height: number }
  /** In px; `'full'` for the graph's disc. */
  readonly radius: number | 'full'
  readonly fontSize: number
  readonly face?: boolean
  readonly className?: string
}) => {
  const box = typeof size === 'number' ? { width: size, height: size } : size
  return (
    <span
      aria-hidden="true"
      data-cast-mark
      className={`${face ? 'folio-cast-face' : 'folio-cast-mark'} ${className ?? ''}`}
      style={{
        ...castHue(hue),
        ...box,
        borderRadius: radius === 'full' ? '50%' : radius,
        fontSize,
        fontWeight: face ? 300 : 600,
      }}
    >
      {initial}
    </span>
  )
}
