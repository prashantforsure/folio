/**
 * What `createEpisode` hands back. Same shape and reason as
 * `lib/projects/result.ts`: a discriminated result, never a throw across the
 * boundary. Kept out of `actions.ts` because a `'use server'` module may
 * export only async functions.
 */
export type CreateEpisodeResult =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly message: string }

export const IDLE: CreateEpisodeResult = { status: 'idle' }
