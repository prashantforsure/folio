import type { FrameState, ShotRow } from '@folio/contracts'

/**
 * What the Storyboard route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Refusal = { readonly status: 'refused'; readonly message: string }
export type Failure = { readonly status: 'error'; readonly message: string }

/** The scene's shots after a write that changed its list: added, proposed, accepted, discarded, moved. */
export type SceneShotsResult =
  | { readonly status: 'saved'; readonly shots: readonly ShotRow[]; readonly accepted: number }
  | Refusal
  | Failure

/** One shot rewritten. */
export type ShotResult = { readonly status: 'saved'; readonly shot: ShotRow } | Refusal | Failure

/**
 * A frame asked for. `queued` carries the balance after the reservation;
 * `insufficient` the balance that was too small, so the button can say
 * "N available · M needed" in the writer's terms.
 */
export type FrameResult =
  | { readonly status: 'queued'; readonly frame: FrameState; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number; readonly cost: number }
  | Refusal
  | Failure

export type CancelResult =
  | { readonly status: 'cancelled'; readonly frame: FrameState; readonly available: number }
  | { readonly status: 'requested'; readonly frame: FrameState }
  | Refusal
  | Failure
