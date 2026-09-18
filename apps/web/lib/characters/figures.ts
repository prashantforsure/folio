import type { CharacterMap, MapColumn, ProjectId, SceneFacts, SceneRef } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'
import type { CharacterId, LocationId, NodeId } from '@folio/script'

import type { ScenePath, WorkspaceShape } from '../workspace/hrefs'
import { sceneHref } from '../workspace/hrefs'

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

/**
 * The scene index as the route reads it: the ref plus the heading's
 * reading, the set (through the location records), who speaks and who is
 * only mentioned (derivation writes the two lists disjoint - `derive.ts`,
 * `buildScene` - so `mentioned` is taken as stored, not recomputed), the
 * measured eighths and the dialogue words.
 */
export const sceneFactsOf = (
  row: SceneIndexRow,
  eighths: ReadonlyMap<NodeId, number>,
  sets: ReadonlyMap<LocationId, string>,
): SceneFacts => {
  const setName = row.locationId === null ? undefined : sets.get(row.locationId)
  return {
    ...sceneRefOf(row),
    ie: row.ie,
    light: row.light,
    timeOfDay: row.timeOfDay,
    set: row.locationId === null || setName === undefined ? null : { id: row.locationId, name: setName },
    speaking: row.speaking,
    mentioned: row.mentioned.filter((id) => !row.speaking.includes(id)),
    eighths: eighths.get(row.sceneNodeId) ?? null,
    words: row.words,
  }
}

/** `E1 Sc 4`, as every scene reference on the route reads. */
export const formatSceneRef = (ref: SceneRef): string =>
  `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/** A citation chip's two halves: the label the route prints and the script href it opens. */
export type Citation = { readonly label: string; readonly href: ScenePath }

/**
 * A scene ref as a link into the script - the chip's label and the episode
 * script's `#n-<node id>` fragment (`sceneHref`). Every citation chip on the
 * route goes through here, so a claim that comes from the script opens the
 * scene that proves it.
 */
export const citeOf = (projectId: ProjectId, shape: WorkspaceShape, ref: SceneRef): Citation => ({
  label: formatSceneRef(ref),
  href: sceneHref({ projectId, shape, episode: ref.episode }, ref.sceneNodeId),
})

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
 * both are in; the diagonal is the character's own count. The Presence
 * view's pairs list and the drawer's `Shares scenes with` are readings of
 * this one matrix.
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

/**
 * The map narrowed to the records the toolbar's filter kept - columns
 * subset, cells re-indexed, order kept - so the filter applies to every
 * view the same way (one `shown` everywhere).
 */
export const subMap = (map: CharacterMap, keep: ReadonlySet<CharacterId>): CharacterMap => {
  const indexes = map.columns.flatMap((column, index) => (keep.has(column.id) ? [index] : []))
  return {
    columns: indexes.flatMap((index) => {
      const column = map.columns[index]
      return column === undefined ? [] : [column]
    }),
    cells: indexes.map((row) => indexes.map((column) => map.cells[row]?.[column] ?? 0)),
  }
}
