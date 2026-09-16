import type { ResearchClipId, ResearchFilingId, ResearchSourceId } from '@folio/contracts'

/**
 * What the Research route's server actions hand back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never
 * a throw across the boundary).
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type SourceResult = { readonly status: 'saved'; readonly id: ResearchSourceId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

export type ClipResult = { readonly status: 'clipped'; readonly id: ResearchClipId } | Failure

export type FiledResult = { readonly status: 'filed'; readonly id: ResearchFilingId } | Failure

export type UnfiledResult = { readonly status: 'unfiled' } | Failure
