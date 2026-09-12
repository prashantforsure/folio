import { IdentityChip } from '@folio/ui'

import { initialOf } from '../../../../../../lib/characters/figures'

/**
 * The round initial chip every character carries. The drawing is
 * `@folio/ui`'s `IdentityChip` - the Locations route draws the same chip on
 * "Who is here most" - and this is the one place a name becomes an initial
 * (`figures.ts`, `initialOf`) for a character. The hue is the record's
 * (`hueOf`), picked once and carried on every row.
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
  <IdentityChip initial={initialOf(name)} hue={hue} size={size} {...(className === undefined ? {} : { className })} />
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
