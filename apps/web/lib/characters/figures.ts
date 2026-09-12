import type {
  CharacterMap,
  EpisodeBar,
  MapColumn,
  PlaceRow,
  PresenceGap,
  SceneRef,
} from '@folio/contracts'
import { CHARACTER_HUES } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'

/**
 * The figures the Characters route prints, each a pure function over the
 * derived rows. Tested in `tests/characters-figures.test.ts`.
 *
 * AGENTS.md, UI fidelity: every number on the route is "computed from the
 * script"; nothing here estimates, and nothing here calls a model - a
 * presence gap and a co-occurrence cell are arithmetic over
 * `scene_derivations`, which is what the Insights bundle means by "a
 * report never calls a model".
 */

// ---------------------------------------------------------------------------
// Identity marks
// ---------------------------------------------------------------------------

/**
 * Which of the six chip hues a record gets: a stable function of its id, so
 * the same person is the same colour in the nav, the profile, the map and
 * every relationship row - across reloads and across records being added.
 * The hues themselves are `--chip-1` .. `--chip-6` in `packages/ui`,
 * transcribed from the bundle; this only picks an index.
 */
export const hueOf = (id: string): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return (hash % CHARACTER_HUES) + 1
}

/** The chip's letter: the first character of the name. `Meera Pawar` is `M`. */
export const initialOf = (name: string): string => {
  const first = name.trim()[0]
  return first === undefined ? '·' : first.toUpperCase()
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export const sceneRefOf = (row: SceneIndexRow): SceneRef => ({
  sceneNodeId: row.sceneNodeId,
  episode: row.episode,
  episodeOrdinal: row.episodeOrdinal,
  number: row.ordinalInEpisode,
  heading: row.heading,
})

/** `E1 Sc 4`, as the bundle writes every scene reference. */
export const formatSceneRef = (ref: SceneRef): string =>
  `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/** Scenes two characters are both in. Order-free; the arrays are node ids. */
export const sharedScenes = (a: readonly NodeId[], b: readonly NodeId[]): number => {
  const set = new Set<NodeId>(a)
  let shared = 0
  for (const id of b) if (set.has(id)) shared += 1
  return shared
}

/**
 * Scenes per episode, in running order, for the "Scenes by episode" bars.
 * Every episode gets a bar, zero included: an episode the character is not
 * in is a fact about the arc, and the bundle draws it at 2%.
 */
export const perEpisodeBars = (
  episodes: readonly { readonly slug: SceneRef['episode']; readonly ordinal: number }[],
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
): readonly EpisodeBar[] =>
  episodes.map((episode) => ({
    episode: episode.slug,
    ordinal: episode.ordinal,
    scenes: index.filter((row) => row.episodeOrdinal === episode.ordinal && scenes.has(row.sceneNodeId)).length,
  }))

/**
 * The longest run of scenes a character is absent for, inside one episode,
 * between their first and last appearance there - the Insights bundle's
 * "gap Sc 6–19". Reported only from `GAP_SCENES` scenes up: a character
 * missing one scene is not a gap, it is a scene. The threshold is a
 * judgement, named here and flagged in the phase report.
 */
export const GAP_SCENES = 5

export const presenceGap = (
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
): PresenceGap | null => {
  let best: PresenceGap | null = null
  const byEpisode = new Map<number, SceneIndexRow[]>()
  for (const row of index) {
    const list = byEpisode.get(row.episodeOrdinal) ?? []
    list.push(row)
    byEpisode.set(row.episodeOrdinal, list)
  }
  for (const [episodeOrdinal, rows] of byEpisode) {
    let last: number | null = null
    for (const row of rows) {
      if (!scenes.has(row.sceneNodeId)) continue
      if (last !== null) {
        const absent = row.ordinalInEpisode - last - 1
        if (absent >= GAP_SCENES && (best === null || absent > best.to - best.from + 1)) {
          best = { episodeOrdinal, from: last + 1, to: row.ordinalInEpisode - 1 }
        }
      }
      last = row.ordinalInEpisode
    }
  }
  return best
}

/** `gap · E1 Sc 6–19`, or `no gaps`. */
export const formatGap = (gap: PresenceGap | null): string =>
  gap === null ? 'no gaps' : `gap · E${String(gap.episodeOrdinal)} Sc ${String(gap.from)}–${String(gap.to)}`

/** Where a character is most: their scenes' locations, most first, top three. */
export const placesOf = (
  index: readonly SceneIndexRow[],
  scenes: ReadonlySet<NodeId>,
  names: ReadonlyMap<LocationId, string>,
  limit = 3,
): readonly PlaceRow[] => {
  const counts = new Map<LocationId, number>()
  for (const row of index) {
    if (row.locationId === null || !scenes.has(row.sceneNodeId)) continue
    counts.set(row.locationId, (counts.get(row.locationId) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''))
    .slice(0, limit)
    .map(([locationId, count]) => ({ locationId, name: names.get(locationId) ?? '(record missing)', scenes: count }))
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * Who shares scenes with whom. `cells[row][column]` is the count of scenes
 * both are in; the diagonal is the character's own count. `standouts` are
 * the pairs of principals with nothing shared - "Empty cells between
 * principals are worth a look", so the route lists them rather than leaving
 * the reader to scan.
 */
export const buildMap = (
  columns: readonly MapColumn[],
  scenesOf: ReadonlyMap<CharacterId, readonly NodeId[]>,
): CharacterMap => {
  const cells = columns.map((row) =>
    columns.map((column) => sharedScenes(scenesOf.get(row.id) ?? [], scenesOf.get(column.id) ?? [])),
  )
  const standouts: { readonly a: MapColumn; readonly b: MapColumn }[] = []
  columns.forEach((a, i) => {
    if (a.group !== 'principal') return
    columns.forEach((b, j) => {
      if (j <= i || b.group !== 'principal') return
      if ((cells[i]?.[j] ?? 0) === 0) standouts.push({ a, b })
    })
  })
  return { columns, cells, standouts }
}
