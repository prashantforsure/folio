import type {
  BreakdownCell,
  LocationCounts,
  LocationEpisodeBar,
  LocationPersonRow,
  LocationRow,
} from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, InteriorExterior, LocationId, NodeId } from '@folio/script'

/**
 * The figures the Locations route prints, each a pure function over the
 * derived rows. Tested in `tests/locations-figures.test.ts`.
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

/** Most scenes first, then by name - how the nav, the breakdown and the sub-set strip order records. */
const byWeight = (a: LocationRow, b: LocationRow): number =>
  b.rollup.scenes - a.rollup.scenes || a.name.localeCompare(b.name)

/**
 * Every record in tree order: each primary set followed by its sub-sets,
 * depth-first, siblings by weight. A record whose parent is not in the
 * list - merged away, or a cycle `derive` broke - is listed as a root, which
 * is where the pure core rolls it up too.
 */
export const treeOrder = (rows: readonly LocationRow[]): readonly LocationRow[] => {
  const ids = new Set(rows.map((row) => row.id))
  const childrenOf = new Map<LocationId | null, LocationRow[]>()
  for (const row of rows) {
    const parent = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(row)
    childrenOf.set(parent, list)
  }
  const out: LocationRow[] = []
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
 * breakdown's I/E column and the record head's chip. `EST` stays `EST` only
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

const IE_WORD: Record<InteriorExterior, string> = {
  INT: 'interior',
  EXT: 'exterior',
  'INT/EXT': 'set',
  EST: 'establishing set',
}

/**
 * The kind line under a record's head: `Primary set · 5 sub-locations`,
 * `Sub-location`, `Recurring interior`. Read from the tree and the count,
 * as the bundle's fixture writes each.
 */
export const kindOf = (row: LocationRow): string => {
  if (row.presence === 'absent' && row.rollup.scenes === 0) return '0 scenes · record kept'
  if (row.parentId !== null) return 'Sub-location'
  if (row.children > 0) {
    return `Primary set · ${String(row.children)} ${row.children === 1 ? 'sub-location' : 'sub-locations'}`
  }
  const word = row.ie === null ? 'set' : IE_WORD[row.ie]
  if (row.rollup.scenes > 1) return `Recurring ${word}`
  return `Single ${word}`
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

/**
 * The day-against-night bar: three widths as fractions of the scene count.
 * A scene whose heading says `CONTINUOUS` is neither, and its share is the
 * bar's track - not folded into day, which is what a two-way split would
 * quietly do.
 */
export const dayNightSplit = (counts: {
  readonly scenes: number
  readonly dayScenes: number
  readonly nightScenes: number
}): { readonly day: number; readonly night: number; readonly unspecified: number } => {
  if (counts.scenes <= 0) return { day: 0, night: 0, unspecified: 0 }
  const day = counts.dayScenes / counts.scenes
  const night = counts.nightScenes / counts.scenes
  return { day, night, unspecified: Math.max(0, 1 - day - night) }
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

const cellOf = (rows: readonly SceneIndexRow[], eighths: ReadonlyMap<NodeId, number>): BreakdownCell => ({
  scenes: rows.length,
  dayScenes: rows.filter((row) => row.light === 'day').length,
  nightScenes: rows.filter((row) => row.light === 'night').length,
  eighths: sumEighths(
    rows.map((row) => row.sceneNodeId),
    eighths,
  ),
})

/**
 * One cell per episode in running order for a set of scenes - the record
 * panel's "Screen time by episode" and a breakdown row. Every episode gets
 * a cell, zero included: an episode a place is not in is a fact about the
 * story, and the bundle draws the bar at 2%.
 */
export const perEpisodeCells = (
  episodes: readonly { readonly slug: LocationEpisodeBar['episode']; readonly ordinal: number }[],
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
  eighths: ReadonlyMap<NodeId, number>,
): readonly LocationEpisodeBar[] =>
  episodes.map((episode) => {
    const here = index.filter((row) => row.episodeOrdinal === episode.ordinal && scenes.has(row.sceneNodeId))
    return { episode: episode.slug, ordinal: episode.ordinal, ...cellOf(here, eighths) }
  })

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
