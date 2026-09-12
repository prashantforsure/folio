/**
 * The round initial chip a character carries everywhere: 20px in a nav row,
 * 18px on a location's "Who is here most", 22px in the map's header, 44px on
 * the profile's portrait. `Route - Characters.dc.html` draws it as a circle
 * in one of six hues with white on top; the hue is `--chip-N` from the
 * tokens and the index is the record's - `apps/web` picks it, by a stable
 * hash of the id, because which person is which colour is a product rule
 * and this package is presentational.
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
  /** 1..6 - `--chip-1` to `--chip-6`. */
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
