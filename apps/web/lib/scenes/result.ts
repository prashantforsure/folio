/**
 * What the Scenes route's one server action hands back. Kept out of
 * `actions.ts` because a `'use server'` module may export only async
 * functions (AGENTS.md, Conventions > Errors: a discriminated result, never a
 * throw across the boundary).
 */
export type SynopsisResult =
  | { readonly status: 'saved'; readonly synopsis: string | null }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
