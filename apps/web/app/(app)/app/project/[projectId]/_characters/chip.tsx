import { initialOf } from '../../../../../../lib/characters/figures'

/**
 * The round initial chip every character carries: 20px in the nav and on a
 * relationship row, 22px in the map's header, 44px on the profile's
 * portrait. `Route - Characters.dc.html` draws it as a circle in one of six
 * hues with white on top; the hue is `--chip-N` from `packages/ui` and the
 * index is the record's (`figures.ts`, `hueOf`).
 *
 * The font size follows the bundle: 8.5px/600 at 20px, 15px/600 at 44px.
 */
export const CharacterChip = ({
  name,
  hue,
  size = 20,
  className,
}: {
  readonly name: string
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
    {initialOf(name)}
  </span>
)

/** The walk-ons' chip: a `·` on `--line`, the bundle's "5 unnamed" row. */
export const WalkOnChip = () => (
  <span
    aria-hidden="true"
    className="grid h-[20px] w-[20px] flex-none place-items-center rounded-full bg-line text-8 font-semibold text-ink2"
  >
    ·
  </span>
)
