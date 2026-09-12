/**
 * The Info panel's statistics row. Real values from derivation and the node
 * list; two rows count to an honest zero, typed as the literal so nobody can
 * quietly wire an estimate into them.
 */
export type ScriptStats = {
  readonly scenes: number
  readonly words: number
  readonly characters: number
  readonly locations: number
  /**
   * The outline's beat blocks are not counted here: that would add a
   * sequential read to the save path. The Outline's own panel counts them.
   */
  readonly beats: 0
  /** Shots are not read on the save path either. */
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
