import type { StoryThreadId } from '@folio/contracts'

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

/** After a bulk placement: how many scenes were given a day. */
export type PlacedResult = { readonly status: 'placed'; readonly scenes: number } | Failure
