// @vitest-environment node
import { between, firstOrderKey, spread } from '@folio/db'
import { describe, expect, it } from 'vitest'

/**
 * A document's order survives the collation change - roadmap task 1.4,
 * migration `0032`, ADR 0003 **D9**.
 *
 * ## What can be proved without a database, and what cannot
 *
 * The collation is a property of a Postgres column, so no test here can run
 * `ORDER BY`. What a test *can* prove is the thing the migration is asserting:
 * that the keys the pure core produces are already in the order byte
 * comparison puts them in, so moving the column to `COLLATE "C"` re-sorts
 * nothing. `COLLATE "C"` is `memcmp`, and the alphabet these keys are drawn
 * from is ASCII, where JavaScript's `<` on strings is the same comparison.
 *
 * The second half of the file is the failure that made this necessary: the
 * same fixture under a locale collation, which is what the column had. A
 * locale-aware comparison folds case and ignores separators, so `AB` and `ab`
 * and `Ab` interleave with each other rather than sorting by byte - and the
 * 2,937-node feature in `packages/db/src/order.ts` came back starting at its
 * 3,000th key.
 */

/** A document's keys, minted the way the repositories mint them. */
const fixtureDocument = (): readonly string[] => {
  const keys: string[] = [firstOrderKey() as string]
  // Ten appends, the shape of typing down a page.
  for (let index = 0; index < 10; index += 1) {
    keys.push(between(keys[keys.length - 1] as never, null) as string)
  }
  // Five inserts between the first two, the shape of splitting a block.
  for (let index = 0; index < 5; index += 1) {
    keys.splice(1, 0, between(keys[0] as never, keys[1] as never) as string)
  }
  // A paste of eight, spread between two neighbours.
  const room = spread(keys[3] as never, keys[4] as never, 8)
  keys.splice(4, 0, ...(room as readonly string[]))
  return keys
}

const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

describe('a fixture document under byte order', () => {
  const keys = fixtureDocument()

  it('is already in the order the column will sort it in', () => {
    // "Identical before and after": the list as the editor holds it, and the
    // list as `COLLATE "C"` returns it, are the same list.
    expect([...keys].sort(byBytes)).toEqual([...keys])
  })

  it('has no duplicate keys, which the unique index the migration rebuilds requires', () => {
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps every key inside the alphabet the comparison assumes', () => {
    // Outside ASCII, `COLLATE "C"` is byte order over UTF-8 and JavaScript's
    // `<` is code-unit order over UTF-16, and they part company above U+FFFF.
    // The keys never go there; this is the check that says so.
    for (const key of keys) expect(key).toMatch(/^[0-9A-Za-z]+$/)
  })
})

describe('the same keys under a locale collation, which is what the column had', () => {
  it('disagrees with byte order, which is the incident', () => {
    // Not the fixture - a locale collation only reorders where case and digits
    // meet, so this is the smallest set that shows it. `en_US.UTF-8` folds
    // case: `a` sorts next to `A`, not after `Z`.
    const keys = ['A0', 'Z0', 'a0', 'z0']
    const bytes = [...keys].sort(byBytes)
    const locale = [...keys].sort(new Intl.Collator('en-US').compare)
    expect(bytes).toEqual(['A0', 'Z0', 'a0', 'z0'])
    expect(locale).toEqual(['a0', 'A0', 'z0', 'Z0'])
    expect(locale).not.toEqual(bytes)
  })
})
