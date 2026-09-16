import type { LocationCounts, LocationPersonRow } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, InteriorExterior, LocationId, NodeId } from '@folio/script'

/**
 * The figures the Locations route prints, each a pure function over the
 * derived rows. Tested in `tests/locations-figures.test.ts`. The labels the
 * v2 route prints are `view.ts`.
 *
 * Nothing here estimates and nothing here calls a model: an interior /
 * exterior label is read off the headings, a day-against-night split is a
 * division, a page count is a sum over the measurement record. The tree
 * walk - which records hang under which - is the one piece of structure,
 * and it reads `parentId`, which is authored (AGENTS.md, Entity identity:
 * the tree is drawn on top by a human; derivation only proposes an edge).
 */

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/** What the tree walk reads of a row: its edge and its weight. */
type TreeRow = { readonly id: LocationId; readonly parentId: LocationId | null; readonly name: string; readonly rollup: { readonly scenes: number } }

/** Most scenes first, then by name - how the sidebar, the grid and the sheet order records. */
const byWeight = (a: TreeRow, b: TreeRow): number =>
  b.rollup.scenes - a.rollup.scenes || a.name.localeCompare(b.name)

/**
 * Every record in tree order: each primary set followed by its sub-sets,
 * depth-first, siblings by weight. A record whose parent is not in the
 * list - merged away, or a cycle `derive` broke - is listed as a root, which
 * is where the pure core rolls it up too.
 */
export const treeOrder = <Row extends TreeRow>(rows: readonly Row[]): readonly Row[] => {
  const ids = new Set(rows.map((row) => row.id))
  const childrenOf = new Map<LocationId | null, Row[]>()
  for (const row of rows) {
    const parent = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(row)
    childrenOf.set(parent, list)
  }
  const out: Row[] = []
  const seen = new Set<LocationId>()
  const walk = (parent: LocationId | null): void => {
    for (const row of [...(childrenOf.get(parent) ?? [])].sort(byWeight)) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
      walk(row.id)
    }
  }
  walk(null)
  // A cycle leaves its members unreached; list them rather than lose them.
  for (const row of [...rows].sort(byWeight)) if (!seen.has(row.id)) out.push(row)
  return out
}

/** A record's place in the tree - all `subtreeOf` and `wouldCycle` read. Rows and records both are one. */
type Edge = { readonly id: LocationId; readonly parentId: LocationId | null }

/** The ids of every record under `id`, `id` included. */
export const subtreeOf = (id: LocationId, rows: readonly Edge[]): ReadonlySet<LocationId> => {
  const out = new Set<LocationId>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (row.parentId !== null && out.has(row.parentId) && !out.has(row.id)) {
        out.add(row.id)
        grew = true
      }
    }
  }
  return out
}

/** Whether making `parent` the parent of `id` would close a loop. */
export const wouldCycle = (id: LocationId, parent: LocationId | null, rows: readonly Edge[]): boolean =>
  parent !== null && subtreeOf(id, rows).has(parent)

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * `INT`, `EXT`, or `INT/EXT` when a set is both across its headings - the
 * sheet's Type column and the card's mono line. `EST` stays `EST` only
 * when every heading is one. `null` with no heading at all.
 */
export const ieOf = (readings: readonly InteriorExterior[]): InteriorExterior | null => {
  if (readings.length === 0) return null
  const kinds = new Set(readings)
  if (kinds.size === 1) return readings[0] ?? null
  if (kinds.has('INT') && !kinds.has('EXT') && !kinds.has('INT/EXT')) return 'INT'
  if (kinds.has('EXT') && !kinds.has('INT') && !kinds.has('INT/EXT')) return 'EXT'
  return 'INT/EXT'
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export const NO_LOCATION_COUNTS: LocationCounts = {
  scenes: 0,
  sluglines: 0,
  dayScenes: 0,
  nightScenes: 0,
  shootingDays: 0,
}

/** Eighths summed over the scenes the measurement knows; `null` when it knows none of them. */
export const sumEighths = (scenes: Iterable<NodeId>, eighths: ReadonlyMap<NodeId, number>): number | null => {
  let total = 0
  let any = false
  for (const id of scenes) {
    const value = eighths.get(id)
    if (value === undefined) continue
    any = true
    total += value
  }
  return any ? total : null
}

/**
 * How many of a set's scenes fall in each episode, in running order - the
 * README's episode bars. Every episode gets a slot, zero included: an
 * episode a place is not in is a fact about the story and draws `--line2`.
 */
export const perEpisodeCounts = (
  episodes: readonly { readonly ordinal: number }[],
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
): readonly number[] =>
  episodes.map(
    (episode) => index.filter((row) => row.episodeOrdinal === episode.ordinal && scenes.has(row.sceneNodeId)).length,
  )

/** Who is here most: characters by scenes at this set, most first, top three. */
export const peopleAt = (
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
  people: ReadonlyMap<CharacterId, { readonly name: string; readonly hue: number }>,
  limit = 3,
): readonly LocationPersonRow[] => {
  const counts = new Map<CharacterId, number>()
  for (const row of index) {
    if (!scenes.has(row.sceneNodeId)) continue
    for (const id of row.cast) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .flatMap(([id, count]) => {
      const person = people.get(id)
      return person === undefined ? [] : [{ id, name: person.name, hue: person.hue, scenes: count }]
    })
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name))
    .slice(0, limit)
}
