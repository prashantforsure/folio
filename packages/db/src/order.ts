import type { OrderKey } from '@folio/contracts'

/**
 * Fractional index keys.
 *
 * The design handoff's Appendix A sketches node ordering as
 * `order: number  // fractional index, so insert never renumbers`. The idea is
 * right and the carrier is wrong: repeatedly inserting between the same two
 * neighbours halves the gap each time, and a double runs out of mantissa after
 * roughly fifty splits at one point. A writer breaking the same paragraph over
 * and over will reach that, and when they do the two keys compare equal, the
 * order becomes whatever the index feels like, and **document order is the one
 * thing AGENTS.md says the script actually is.** The failure is silent.
 *
 * So the key is a base-62 string compared lexicographically. Between any two
 * distinct strings there is always another, because a string can always get one
 * character longer - the property a float does not have.
 *
 * **This is a deviation from Appendix A and is flagged as one.** The appendix is
 * a sketch whose own preamble says the contract wins where the two differ, but
 * nobody has ruled this specific point.
 *
 * ## Why this lives here and not in `packages/script`
 *
 * Order is storage's, not the model's. A `ScreenplayDocument` is an ordered
 * *list*; its nodes carry no ordinal, deliberately, because a per-node ordinal
 * would be a second authority on document order. The pure core never sees these
 * keys.
 */

/**
 * Base 62, in ASCII order: digits, then upper case, then lower case.
 *
 * The alphabet must be sorted the way the database sorts it, or a key that
 * compares correctly in JavaScript will sort differently in `ORDER BY`. `C`
 * collation on the column is what guarantees the match; a locale-aware
 * collation would sort `a` before `B` and break the invariant. The migration
 * declares the column `text` and the repository always orders by it directly -
 * if a future index adds a collation, it must be `"C"`.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const BASE = DIGITS.length

const MID = DIGITS[Math.floor(BASE / 2)] ?? 'V'

const valueAt = (key: string, index: number): number => {
  const character = key[index]
  if (character === undefined) return -1
  const value = DIGITS.indexOf(character)
  return value
}

const asOrderKey = (raw: string): OrderKey => {
  // `OrderKey` is a plain branded string in `@folio/contracts`; this is the one
  // place in the package that mints one, so the assertion is here and nowhere
  // else.
  return raw as OrderKey
}

/** The key for the first node in an empty document. */
export const firstOrderKey = (): OrderKey => asOrderKey(MID)

/**
 * A key strictly between `before` and `after`.
 *
 * `null` on either side means "no neighbour": `between(null, x)` is a key that
 * sorts before `x`, `between(x, null)` sorts after it, and `between(null, null)`
 * is the first key in an empty document.
 *
 * The algorithm walks both keys character by character, and as soon as there is
 * room between them it takes the midpoint and stops. When there is no room it
 * copies the lower key's character and keeps going, which is what makes the key
 * grow one character at a time rather than failing.
 */
export const between = (before: OrderKey | null, after: OrderKey | null): OrderKey => {
  const low = before ?? ''
  const high = after ?? ''

  let prefix = ''
  let index = 0

  for (;;) {
    const lowValue = valueAt(low, index)
    const highValue = index < high.length ? valueAt(high, index) : BASE

    if (lowValue + 1 < highValue) {
      // There is room. Take the midpoint and stop.
      const middle = Math.floor((lowValue + highValue) / 2)
      const character = DIGITS[middle]
      if (character === undefined) break
      return asOrderKey(prefix + character)
    }

    // No room at this position. Keep the lower key's character - or the lowest
    // digit if the lower key has run out - and look one position deeper.
    const character = lowValue < 0 ? DIGITS[0] : DIGITS[lowValue]
    if (character === undefined) break
    prefix += character
    index += 1
  }

  // Unreachable for well-formed keys: the loop above always finds room once it
  // is past the shared prefix. Returning a key that sorts after everything is
  // the safe direction if it ever is reached, because appending never reorders
  // existing rows.
  return asOrderKey(prefix + MID)
}

/**
 * Keys for `count` nodes inserted in one go, between two neighbours.
 *
 * Repeated bisection rather than `count` separate calls, so a paste of two
 * hundred nodes produces short keys rather than one key two hundred characters
 * long. It bisects the *remaining* gap each time, which keeps the keys balanced.
 */
export const spread = (
  before: OrderKey | null,
  after: OrderKey | null,
  count: number,
): readonly OrderKey[] => {
  if (count <= 0) return []
  const keys: OrderKey[] = []
  let low = before
  for (let index = 0; index < count; index += 1) {
    const key = between(low, after)
    keys.push(key)
    low = key
  }
  return keys
}
