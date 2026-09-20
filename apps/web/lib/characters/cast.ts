import type { CastRow, CharacterColor, Relationship, SceneRef } from '@folio/contracts'
import { CHARACTER_COLORS } from '@folio/contracts'
import type { CharacterId, MatchReason, NodeId } from '@folio/script'

import { shareOf } from './list'

/**
 * The derived fields the Characters route prints, each a pure function
 * over the rows the loader joins, computed from the real tables rather
 * than authored. Tested in `tests/characters-cast.test.ts`.
 *
 * The fourth pass (2026-09-20) cut this to what the canvas, the graph,
 * the List, the queue and the drawer read: a per-episode count is
 * arithmetic over `character_derivations.scenes` joined to the scene
 * index; a share is words over words; a relationship count is rows
 * naming the record. The groups, the strips, the sets, the breakdown, the
 * balance and the map went with the views that drew them. Nothing here
 * estimates and nothing calls a model.
 */

// ---------------------------------------------------------------------------
// Scenes per episode
// ---------------------------------------------------------------------------

/** The scene refs a character is in, in script order, from its heading ids. */
export const refsOf = <R extends SceneRef>(scenes: readonly NodeId[], refs: ReadonlyMap<NodeId, R>): readonly R[] =>
  scenes
    .flatMap((id) => {
      const ref = refs.get(id)
      return ref === undefined ? [] : [ref]
    })
    .sort((a, b) => a.episodeOrdinal - b.episodeOrdinal || a.number - b.number)

/**
 * How many of the character's scenes fall in each episode, in episode
 * order - the List's episode bars. Every episode gets a slot, so an
 * episode the character is absent from is a `0` and draws `--line2`.
 */
export const perEpisode = (scenes: readonly NodeId[], refs: ReadonlyMap<NodeId, SceneRef>, episodeOrdinals: readonly number[]): readonly number[] => {
  const counts = new Map<number, number>(episodeOrdinals.map((ordinal) => [ordinal, 0]))
  for (const ref of refsOf(scenes, refs)) {
    const seen = counts.get(ref.episodeOrdinal)
    if (seen !== undefined) counts.set(ref.episodeOrdinal, seen + 1)
  }
  return episodeOrdinals.map((ordinal) => counts.get(ordinal) ?? 0)
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Why the queue is asking - the branch `compare` took, in the writer's words.
 * `same name` for an exact key under an unbound spelling; `first name` when
 * the shorter key is one token, else `starts the same`; `contains MEERA` for
 * a contained key; `2 letters off` for an edit distance. Locations' queue
 * prints it too.
 */
export const reasonLabel = (reason: MatchReason): string => {
  switch (reason.kind) {
    case 'exact':
      return 'same name'
    case 'leading':
      return reason.shorter.includes(' ') ? 'starts the same' : 'first name'
    case 'contains':
      return `contains ${reason.inner}`
    case 'edits':
      return `${String(reason.distance)} ${reason.distance === 1 ? 'letter' : 'letters'} off`
  }
}

/** `3 names in the script don't match a character` - the queue's line. */
export const unmatchedLabel = (count: number): string =>
  count === 1 ? "1 name in the script doesn't match a character" : `${String(count)} names in the script don't match a character`

/** Past this many open rows the queue folds to the first five with `Show all N`. */
export const QUEUE_FOLD = 5

/**
 * The status bar's route id: `characters`, or `characters/3f2a9c1e` with a
 * drawer open - the record's id cut to its first eight characters so a
 * 36-character UUID does not fill the bar.
 */
export const routeIdOf = (selected: { readonly id: string } | null): string =>
  selected === null ? 'characters' : `characters/${selected.id.slice(0, 8)}`

/**
 * The colour a new record takes: the first of the ten nobody has, else the
 * least used. Chosen at creation and changed from the drawer's swatches.
 */
export const leastUsedColor = (hues: readonly number[]): CharacterColor => {
  const counts = new Map<number, number>()
  for (const hue of hues) counts.set(hue, (counts.get(hue) ?? 0) + 1)
  let best: CharacterColor = CHARACTER_COLORS[0].id
  let fewest = Number.POSITIVE_INFINITY
  for (const color of CHARACTER_COLORS) {
    const used = counts.get(color.hue) ?? 0
    if (used < fewest) {
      fewest = used
      best = color.id
    }
  }
  return best
}

/** The chip's letters: `M`, or the second word's initial past a leading article. Locations' cast marks print it too. */
export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter((word) => word !== '')
  const first = words[0]?.[0]
  if (first === undefined) return '·'
  if (words.length >= 2 && /^(the|a|an)$/i.test(words[0] ?? '')) return (words[1]?.[0] ?? first).toUpperCase()
  return first.toUpperCase()
}

// ---------------------------------------------------------------------------
// The figure, assembled
// ---------------------------------------------------------------------------

/** Everything a card, a tile, a row and the drawer print about one record - `CastRow` plus the derived fields. */
export type CastFigure = CastRow & {
  readonly initial: string
  /** Scenes per episode, episode order. */
  readonly episodeScenes: readonly number[]
  /** Dialogue words as a whole percentage of the project's. */
  readonly share: number
  /** How many authored relationships name this record (`0024`). */
  readonly relationships: number
}

export const figuresOf = (
  cast: readonly CastRow[],
  index: readonly (SceneRef & { readonly words: number })[],
  episodeOrdinals: readonly number[],
  relationships: readonly Relationship[],
): readonly CastFigure[] => {
  const refs = new Map<NodeId, SceneRef>(index.map((ref) => [ref.sceneNodeId, ref]))
  const projectWords = index.reduce((total, scene) => total + scene.words, 0)
  const related = new Map<CharacterId, number>()
  for (const row of relationships) {
    related.set(row.aId, (related.get(row.aId) ?? 0) + 1)
    related.set(row.bId, (related.get(row.bId) ?? 0) + 1)
  }
  return cast.map((row) => ({
    ...row,
    initial: initialsOf(row.name),
    episodeScenes: perEpisode(row.scenes, refs, episodeOrdinals),
    share: shareOf(row.words, projectWords),
    relationships: related.get(row.id) ?? 0,
  }))
}
