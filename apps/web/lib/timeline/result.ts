import type { Placement, StoryThreadId } from '@folio/contracts'

import type { ExcerptLine } from '../scenes/excerpt'

/**
 * What the Timeline route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type SavedResult = { readonly status: 'saved' } | Failure

export type ThreadCreatedResult = { readonly status: 'created'; readonly id: StoryThreadId } | Failure

export type DeletedResult = { readonly status: 'deleted' } | Failure

/** After a bulk placement: the placements that landed - what `Undo` hands back. */
export type PlacedResult = { readonly status: 'placed'; readonly placements: readonly Placement[] } | Failure

/** After the undo: how many went back to unplaced. */
export type UnplacedResult = { readonly status: 'unplaced'; readonly scenes: number } | Failure

/** A scene's own lines, for the reader: heading first, comments left out. */
export type SceneLinesResult = { readonly status: 'ok'; readonly lines: readonly ExcerptLine[] } | Failure
