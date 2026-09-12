import type { BibleEntryLinks } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'

/**
 * The figures the Bible route prints, each a pure function over rows.
 * Tested in `tests/bible-figures.test.ts`.
 *
 * Nothing here calls a model and nothing here reads a node: what an entry
 * is "linked" to is read off the scenes its facts cite - the cast and the
 * location of each cited scene, from `scene_derivations` - which is what
 * "authored entries whose facts cite derived scenes" buys. The bundle's
 * Linked chips are fixture data; these are the chips a cite implies.
 */

/** `Prashant Patel` is `PP`; `Meera` is `M`; an empty name is `·`. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter((word) => word !== '')
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '')
  const joined = letters.join('')
  return joined === '' ? '·' : joined
}

/** How many linked chips of each kind the aside draws. */
export const LINKED_CHARACTERS = 6
export const LINKED_LOCATIONS = 4

/**
 * Who and where an entry touches: the cast of its cited scenes, most
 * scenes first, then the locations of those scenes, most first. `related`
 * is the caller's - it is entries, not scenes.
 */
export const linkedFromCites = (
  index: readonly SceneIndexRow[],
  cites: ReadonlySet<NodeId>,
  characterNames: ReadonlyMap<CharacterId, string>,
  locationNames: ReadonlyMap<LocationId, string>,
): Omit<BibleEntryLinks, 'related'> => {
  const people = new Map<CharacterId, number>()
  const places = new Map<LocationId, number>()
  for (const row of index) {
    if (!cites.has(row.sceneNodeId)) continue
    for (const id of row.cast) people.set(id, (people.get(id) ?? 0) + 1)
    if (row.locationId !== null) places.set(row.locationId, (places.get(row.locationId) ?? 0) + 1)
  }
  const byCount = <K>(names: ReadonlyMap<K, string>) => (a: [K, number], b: [K, number]) =>
    b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? '')
  return {
    characters: [...people.entries()]
      .filter(([id]) => characterNames.has(id))
      .sort(byCount(characterNames))
      .slice(0, LINKED_CHARACTERS)
      .map(([id]) => ({ id, name: characterNames.get(id) ?? '' })),
    locations: [...places.entries()]
      .filter(([id]) => locationNames.has(id))
      .sort(byCount(locationNames))
      .slice(0, LINKED_LOCATIONS)
      .map(([id]) => ({ id, name: locationNames.get(id) ?? '' })),
  }
}

const DAY = 24 * 60 * 60 * 1000

/**
 * `edited today` · `yesterday` · `3 days ago` · `1 week ago` · `3 weeks
 * ago`, then the date. The bundle's own scale; `now` is passed in so the
 * function is pure and the test can pin it.
 */
export const editedLabel = (updatedAt: string, now: number): string => {
  const then = Date.parse(updatedAt)
  if (Number.isNaN(then)) return '—'
  const days = Math.max(0, Math.floor((now - then) / DAY))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${String(days)} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${String(weeks)} weeks ago`
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The glossary's amber threshold: fewer uses than this and the term "may need a second landing". */
export const FEW_USES = 4
