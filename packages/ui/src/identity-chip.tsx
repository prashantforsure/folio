/**
 * The round initial chip a character carries: 18px on a location's "Who is
 * here most", 16px on a ghost card's proposal, 20px elsewhere. A circle in
 * one of the ten `--chip-N` hues with white on top; the index is the
 * record's authored colour (`characters.color`, since the Characters
 * route's second pass) - `apps/web` reads it, because which person is
 * which colour is a product rule and this package is presentational.
 *
 * Handed the initial rather than the name for the same reason `Avatar` is
 * handed initials: which character of a name is its initial is decided in
 * the app. The font size follows the bundle: 8.5px/600 up to 40px, 15px/600
 * from 40px.
 */
export const IdentityChip = ({
  initial,
  hue,
  size = 20,
  className,
}: {
  readonly initial: string
  /** 1..10 - `--chip-1` to `--chip-10`. */
  readonly hue: number
  readonly size?: number
  readonly className?: string
}) => (
  <span
    aria-hidden="true"
    className={`grid flex-none place-items-center rounded-full font-semibold ${className ?? ''}`}
    style={{
      width: size,
      height: size,
      background: `var(--chip-${String(hue)})`,
      color: 'var(--chip-ink)',
      fontSize: size >= 40 ? 15 : 8.5,
    }}
  >
    {initial}
  </span>
)
