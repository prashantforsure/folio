import type { ProductionScene } from '@folio/contracts'

/**
 * What the Production route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 *
 * Every write that changes a scene's reels or shots returns the **whole
 * scene re-read** - reels, shots, takes, clip - because a reel's status is
 * folded from all of it and a partial patch would leave the client folding
 * over stale rows. The redesign renders what comes back.
 */

export type Refusal = { readonly status: 'refused'; readonly message: string }
export type Failure = { readonly status: 'error'; readonly message: string }

/** The scene after a write to its reels or shots. */
export type SceneResult = { readonly status: 'saved'; readonly scene: ProductionScene } | Refusal | Failure

/**
 * Frames asked for, for a reel. `queued` carries the scene with the jobs on
 * it and the balance after the reservation; `insufficient` the balance that
 * was too small and what was needed, so the button can say "N available ·
 * M needed" in the writer's terms.
 */
export type FramesResult =
  | { readonly status: 'queued'; readonly scene: ProductionScene; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number; readonly needed: number }
  | Refusal
  | Failure

/** A render asked for. Same shape as frames, one job. */
export type RenderResult =
  | { readonly status: 'queued'; readonly scene: ProductionScene; readonly available: number }
  | { readonly status: 'insufficient'; readonly available: number; readonly cost: number }
  | Refusal
  | Failure

/** A job stopped - a frame's or a render's. Queued: cancelled and released. Running: asked to stop. */
export type CancelResult =
  | { readonly status: 'cancelled'; readonly scene: ProductionScene; readonly available: number }
  | { readonly status: 'requested'; readonly scene: ProductionScene }
  | Refusal
  | Failure

/** A project-wide setting written. */
export type SavedResult = { readonly status: 'saved' } | Refusal | Failure
