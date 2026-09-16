import type { BoardCoverageRow, ShotRow, StoryboardScene } from '@folio/contracts'

import { ABSENT } from '../workspace/format'

/**
 * What the Storyboard route derives before it draws - the mockup's
 * `data()` method, over real rows (`docs/ui design/Route - Storyboard
 * v2.dc.html`). Pure, and tested in `tests/storyboard-board.test.ts`, so
 * the three views, the sidebar group and its widget agree on every count
 * and every colour.
 *
 * ## Colour is semantic and strict
 *
 * README, "Tokens": green is settled, amber needs a decision, orange is
 * destructive or live. The mockup's rule for a scene's dot - no shots is
 * `--ink3`, every shot drawn is `--ok`, anything else `--warn` - is kept,
 * and proposals (which the mockup does not have) fall under amber, because
 * a proposal is exactly a decision waiting. A shot's dot follows its frame:
 * drawn is green, a failed or refused frame is orange, a proposal is amber,
 * and a shot with no frame yet is `--ink3` - nothing has gone wrong, there
 * is just no picture.
 */

export type Tone = 'ok' | 'warn' | 'live' | 'none'

/** A shot is boarded once it is accepted; a proposal is a question, not a shot. */
export const isAccepted = (shot: ShotRow): boolean => shot.state === 'accepted'

export const isDrawn = (shot: ShotRow): boolean => shot.frame.kind === 'drawn'

/** The mono state beside a canvas node's title, in the writer's terms. */
export const shotStateLabel = (shot: ShotRow): string => {
  if (shot.state === 'proposed') return 'proposed'
  switch (shot.frame.kind) {
    case 'empty':
      return 'no frame'
    case 'queued':
      return 'queued'
    case 'running':
      return 'drawing'
    case 'drawn':
      return 'drawn'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'refused'
    case 'cancelled':
      return 'cancelled'
  }
}

export const shotTone = (shot: ShotRow): Tone => {
  if (shot.state === 'proposed') return 'warn'
  switch (shot.frame.kind) {
    case 'drawn':
      return 'ok'
    case 'failed':
    case 'blocked':
      return 'live'
    case 'empty':
    case 'queued':
    case 'running':
    case 'cancelled':
      return 'none'
  }
}

/** The mockup's rule for a scene: none, all drawn, or something still to do. */
export const sceneTone = (scene: StoryboardScene): Tone => {
  if (scene.shots.length === 0) return 'none'
  if (scene.shots.every((shot) => isAccepted(shot) && isDrawn(shot))) return 'ok'
  return 'warn'
}

/** The same rule over a coverage row, which counts rather than lists. */
export const coverageTone = (row: BoardCoverageRow): Tone => {
  if (row.shots === 0 && row.proposed === 0) return 'none'
  if (row.proposed === 0 && row.drawn === row.shots) return 'ok'
  return 'warn'
}

/** `01`, `12`. */
export const sceneNo = (number: number): string => String(number).padStart(2, '0')

/**
 * The mono slug under `Scene NN` - `EXT. COMMUNITY PITCH` in the mockup: the
 * reading's `INT` / `EXT` and set, without the time of day (that is the `DN`
 * beside it). A heading that did not read prints as written; none at all is
 * the mockup's `No heading yet`.
 */
export const sceneSlug = (scene: { readonly ie: string | null; readonly set: string; readonly heading: string }): string => {
  if (scene.set !== '') return `${scene.ie === null ? '' : `${scene.ie.toUpperCase()}. `}${scene.set}`
  return scene.heading === '' ? 'No heading yet' : scene.heading
}

/** The list view's group row: `01 — EXT. COMMUNITY PITCH`, `02 — untitled`. */
export const groupLabel = (number: number, heading: string): string =>
  `${sceneNo(number)} — ${heading === '' ? 'untitled' : heading}`

/** `DUSK`, or `—` when the heading names no time of day. */
export const dayNight = (timeOfDay: string | null): string => timeOfDay ?? ABSENT

// ---------------------------------------------------------------------------
// The filter
// ---------------------------------------------------------------------------

/**
 * The toolbar's `All shots ▾` menu. Four readings of the same rows; the
 * predicate is here so the board, the canvas and the list hide the same
 * shots.
 */
export const SHOT_FILTERS = ['all', 'drawn', 'waiting', 'proposed'] as const

export type ShotFilter = (typeof SHOT_FILTERS)[number]

export const SHOT_FILTER_LABEL: Record<ShotFilter, string> = {
  all: 'All shots',
  drawn: 'With a frame',
  waiting: 'Waiting on a frame',
  proposed: 'Proposed',
}

export const isShotFilter = (value: string): value is ShotFilter => (SHOT_FILTERS as readonly string[]).includes(value)

export const matchesFilter = (shot: ShotRow, filter: ShotFilter): boolean => {
  switch (filter) {
    case 'all':
      return true
    case 'drawn':
      return isDrawn(shot)
    case 'waiting':
      return isAccepted(shot) && !isDrawn(shot)
    case 'proposed':
      return shot.state === 'proposed'
  }
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type BoardCoverage = {
  /** Scenes with at least one accepted shot - the mockup's `Boards drawn 1 / 3`. */
  readonly boarded: number
  readonly scenes: number
  /** Accepted shots without a drawn frame - `2 shots waiting on a frame`. */
  readonly waiting: number
  /** Accepted shots across the board - the nav row and the toolbar count. */
  readonly shots: number
  /** Proposals not yet taken. Beside the count, never inside it. */
  readonly proposed: number
}

export const coverageOf = (rows: readonly BoardCoverageRow[]): BoardCoverage => ({
  boarded: rows.filter((row) => row.shots > 0).length,
  scenes: rows.length,
  waiting: rows.reduce((total, row) => total + (row.shots - row.drawn), 0),
  shots: rows.reduce((total, row) => total + row.shots, 0),
  proposed: rows.reduce((total, row) => total + row.proposed, 0),
})

/** The coverage rows of a loaded board - what the workspace publishes to the sidebar after every write. */
export const coverageRows = (scenes: readonly StoryboardScene[]): readonly BoardCoverageRow[] =>
  scenes.map((scene) => ({
    sceneNodeId: scene.sceneNodeId,
    number: scene.number,
    heading: scene.heading,
    ie: scene.ie,
    set: scene.set,
    shots: scene.shots.filter(isAccepted).length,
    proposed: scene.shots.filter((shot) => shot.state === 'proposed').length,
    drawn: scene.shots.filter((shot) => isAccepted(shot) && isDrawn(shot)).length,
  }))

/** `2 shots waiting on a frame`, `1 shot waiting on a frame`, `Every shot has a frame`, `No shots yet`. */
export const waitingCaption = (coverage: BoardCoverage): string => {
  if (coverage.shots === 0) return 'No shots yet'
  if (coverage.waiting === 0) return 'Every shot has a frame'
  return `${String(coverage.waiting)} ${coverage.waiting === 1 ? 'shot' : 'shots'} waiting on a frame`
}
