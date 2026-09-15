import type { CharacterMap, MapColumn, SceneRef } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'

/**
 * The figures the Characters route prints, each a pure function over the
 * derived rows. Tested in `tests/characters-figures.test.ts`.
 *
 * AGENTS.md, UI fidelity: every number on the route is "computed from the
 * script"; nothing here estimates, and nothing here calls a model - a
 * co-occurrence cell is arithmetic over `scene_derivations`.
 */

/** The chip's letter: the first character of the name. `Meera Pawar` is `M`. */
export const initialOf = (name: string): string => {
  const first = name.trim()[0]
  return first === undefined ? '·' : first.toUpperCase()
}

/** `Female · 17 y/o · student` - the facts line under a name, skipping what is unset. */
export const factsLine = (facts: {
  readonly gender: string | null
  readonly age: string | null
  readonly role: string | null
}): string =>
  [facts.gender, facts.age === null ? null : /^\d+$/.test(facts.age) ? `${facts.age} y/o` : facts.age, facts.role]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')

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

/** `E1 Sc 4`, as every scene reference on the route reads. */
export const formatSceneRef = (ref: SceneRef): string =>
  `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/** Scenes two characters are both in. Order-free; the arrays are node ids. */
export const sharedScenes = (a: readonly NodeId[], b: readonly NodeId[]): number => {
  const set = new Set<NodeId>(a)
  let shared = 0
  for (const id of b) if (set.has(id)) shared += 1
  return shared
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/**
 * Who shares scenes with whom. `cells[row][column]` is the count of scenes
 * both are in; the diagonal is the character's own count. The three
 * relationship graphs are drawings of this one matrix.
 */
export const buildMap = (
  columns: readonly MapColumn[],
  scenesOf: ReadonlyMap<CharacterId, readonly NodeId[]>,
): CharacterMap => ({
  columns,
  cells: columns.map((row) =>
    columns.map((column) => sharedScenes(scenesOf.get(row.id) ?? [], scenesOf.get(column.id) ?? [])),
  ),
})
