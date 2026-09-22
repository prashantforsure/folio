import type { PropId } from '@folio/script'

/**
 * What the Props route's server actions hand back.
 *
 * Kept out of `actions.ts` for the reason `lib/locations/result.ts` and
 * `lib/settings/result.ts` are: **a `'use server'` module may export
 * nothing but async functions.** A constant exported from one typechecks,
 * lints and builds, and then 500s on every post with "A 'use server' file
 * can only export async functions, found object" - a failure only a
 * browser walk finds (`apps/web/CLAUDE.md`, the account-routes pass). So
 * every type and every constant the actions need lives here.
 *
 * AGENTS.md, Conventions > Errors: a discriminated result, never a throw
 * across the boundary.
 */

export type Failure =
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type CreateResult = { readonly status: 'created'; readonly id: PropId } | Failure

export type SavedResult = { readonly status: 'saved' } | Failure

export type BindResult = { readonly status: 'bound' } | Failure

export type MergeResult = { readonly status: 'merged'; readonly into: PropId } | Failure

export type DeleteResult = { readonly status: 'deleted' } | Failure

/** After an upload: the photo's public URL, so the card can show it before the page re-reads. */
export type PhotoResult = { readonly status: 'saved'; readonly url: string | null } | Failure

/** The one refusal message a missing record gets, so every action says it the same way. */
export const REFUSED_PROP = 'That prop could not be found.'

/** Every save-shaped failure the name check produces. One sentence, the field's own. */
export const REFUSED_NAME = 'A prop needs a name, up to 200 characters.'
