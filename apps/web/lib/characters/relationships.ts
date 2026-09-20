import type { Relationship, RelationshipInput } from '@folio/contracts'
import type { CharacterId } from '@folio/script'

/**
 * Relationships, read either way round. Pure; tested in
 * `tests/characters-relationships.test.ts`.
 *
 * A row is one unordered pair with two directional labels (`0024`): `aIs`
 * reads "<a> is <b>'s aIs". The modal and the drawer speak from one side
 * - "you are their X · they are your Y" - so the same row reads
 * differently from each end, and a pair typed from either end must land
 * on the one row. `orderInput` is the write's half of that (sort the ids,
 * swap the labels with them); `relationshipOf` the read's.
 */

/** The pair with the lower id first, as the row stores it. */
export const orderPair = (a: CharacterId, b: CharacterId): readonly [CharacterId, CharacterId] => (a < b ? [a, b] : [b, a])

/** `a:b`, sorted - the key a thread, an edge and a pill share. */
export const pairKey = (a: CharacterId, b: CharacterId): string => {
  const [x, y] = orderPair(a, b)
  return `${x}:${y}`
}

/** The input with the pair sorted and the labels swapped with it, so `aIs` is still what the lower id is. */
export const orderInput = (input: RelationshipInput): RelationshipInput =>
  input.aId < input.bId
    ? input
    : { aId: input.bId, bId: input.aId, aIs: input.bIs, bIs: input.aIs, description: input.description }

/** How one row reads from `viewer`'s side; null when the viewer is not in it. */
export const relationshipOf = (
  row: Relationship,
  viewer: CharacterId,
): { readonly other: CharacterId; readonly youAre: string; readonly theyAre: string } | null => {
  if (row.aId === viewer) return { other: row.bId, youAre: row.aIs, theyAre: row.bIs }
  if (row.bId === viewer) return { other: row.aId, youAre: row.bIs, theyAre: row.aIs }
  return null
}

/** `Meera is Anil's sister · Anil is Meera's brother`, skipping a blank side. */
export const describeRelationship = (row: Relationship, names: ReadonlyMap<CharacterId, string>): string => {
  const a = names.get(row.aId) ?? 'someone'
  const b = names.get(row.bId) ?? 'someone'
  const parts: string[] = []
  if (row.aIs !== '') parts.push(`${a} is ${b}'s ${row.aIs}`)
  if (row.bIs !== '') parts.push(`${b} is ${a}'s ${row.bIs}`)
  return parts.join(' · ')
}

/** The pill's two halves, `—` for a side nobody named. */
export const pillLabels = (row: Pick<Relationship, 'aIs' | 'bIs'>): readonly [string, string] => [
  row.aIs === '' ? '—' : row.aIs,
  row.bIs === '' ? '—' : row.bIs,
]
