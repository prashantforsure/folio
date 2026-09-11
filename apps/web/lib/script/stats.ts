/**
 * The Info panel's statistics row. Real values from derivation and the node
 * list; the two routes that do not exist yet count to an honest zero, typed
 * as the literal so nobody can quietly wire an estimate into them.
 */
export type ScriptStats = {
  readonly scenes: number
  readonly words: number
  readonly characters: number
  readonly locations: number
  /** The Beats route does not exist yet. */
  readonly beats: 0
  /** The Storyboard route does not exist yet. */
  readonly shots: 0
  readonly relations: number
}

export const EMPTY_STATS: ScriptStats = {
  scenes: 0,
  words: 0,
  characters: 0,
  locations: 0,
  beats: 0,
  shots: 0,
  relations: 0,
}
