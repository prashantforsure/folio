import type { CSSProperties } from 'react'

/**
 * A character's identity mark: the two-stop gradient chip with white
 * initials - 22px at 7px in the Locations drawer's `Who's here`, a 17px
 * disc in its cast stacks. The gradient is `.folio-cast-mark`
 * (`globals.css`), off the record's hue: `--cast-h` is set here from the
 * record's authored colour (`--chip-N-h`, `palette.css`), so the flat chip
 * the other routes draw and the gradient this one does are one colour.
 *
 * Locations' until that route's pass: the Characters route draws the
 * square `IdentityChip` since the rebuild (2026-09-18), and the drawer's
 * 78×98 face left with it.
 */
export const castHue = (hue: number): CSSProperties =>
  ({ '--cast-h': `var(--chip-${String(hue)}-h)` }) as CSSProperties

export const CastMark = ({
  initial,
  hue,
  size,
  radius,
  fontSize,
  className,
}: {
  readonly initial: string
  /** 1..10 - `--chip-1-h` to `--chip-10-h`. */
  readonly hue: number
  readonly size: number | { readonly width: number; readonly height: number }
  /** In px; `'full'` for a disc. */
  readonly radius: number | 'full'
  readonly fontSize: number
  readonly className?: string
}) => {
  const box = typeof size === 'number' ? { width: size, height: size } : size
  return (
    <span
      aria-hidden="true"
      data-cast-mark
      className={`folio-cast-mark ${className ?? ''}`}
      style={{
        ...castHue(hue),
        ...box,
        borderRadius: radius === 'full' ? '50%' : radius,
        fontSize,
      }}
    >
      {initial}
    </span>
  )
}
