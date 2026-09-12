import type { LocationId } from '@folio/script'

/**
 * What the Locations route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type CreateResult = { readonly status: 'created'; readonly id: LocationId } | Failure

export type SavedResult = { readonly status: 'saved' } | Failure

/** The rename's diff: how many headings were rewritten, across how many episodes. */
export type RenameResult =
  | { readonly status: 'renamed'; readonly headings: number; readonly episodes: number }
  | Failure

export type BindResult = { readonly status: 'bound' } | Failure

export type MergeResult = { readonly status: 'merged'; readonly into: LocationId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

/** After a queue decision: how many slugline rows still carry a proposal. The badge. */
export type ResolveResult = { readonly status: 'resolved'; readonly pending: number } | Failure

export type DeriveResult = { readonly status: 'derived'; readonly locations: number } | Failure
