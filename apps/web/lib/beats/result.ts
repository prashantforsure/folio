import type { BeatRow, BeatTiming } from '@folio/contracts'

/**
 * What the Beats route's server actions hand back. Kept out of `actions.ts`
 * because a `'use server'` module may export only async functions
 * (AGENTS.md, Conventions > Errors: a discriminated result, never a throw
 * across the boundary).
 */

export type Refusal = { readonly status: 'refused'; readonly message: string }
export type Failure = { readonly status: 'error'; readonly message: string }

/** A beat was added: the row as the route would read it, and where the whole list now stands. */
export type AddBeatResult = { readonly status: 'added'; readonly beat: BeatRow; readonly beats: readonly BeatRow[] } | Refusal | Failure

/** The block's text changed. */
export type HeadlineResult = { readonly status: 'saved'; readonly text: string } | Refusal | Failure

export type TimingResult = { readonly status: 'saved'; readonly timing: BeatTiming } | Refusal | Failure

/** The outline's beat blocks in their new order, renumbered. */
export type OrderResult = { readonly status: 'saved'; readonly beats: readonly BeatRow[] } | Refusal | Failure

export type DeleteResult = { readonly status: 'deleted'; readonly beats: readonly BeatRow[] } | Refusal | Failure

export type LinkResult = { readonly status: 'saved' } | Refusal | Failure
