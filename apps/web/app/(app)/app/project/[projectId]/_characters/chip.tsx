import { IdentityChip } from '@folio/ui'

import { initialOf } from '../../../../../../lib/characters/figures'

/**
 * The round initial chip a character carries in the casting table, on a
 * ghost card's proposal and on the Locations route's "Who is here most".
 * The drawing is `@folio/ui`'s `IdentityChip`; this is the one place a name
 * becomes an initial (`figures.ts`, `initialOf`) for a character. The hue
 * is the record's authored colour (`characters.color`), read as its
 * `--chip-N` index.
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
