/**
 * What a project action hands back.
 *
 * AGENTS.md, Conventions > Errors: "Server actions return a discriminated
 * result, never a bare throw across the boundary." Same shape as
 * `lib/auth/result.ts` and for the same reason - a thrown error crossing a
 * Server Action boundary in production is replaced by Next with an opaque
 * digest.
 *
 * `field` names which control the message belongs beside. `'form'` is about
 * the attempt as a whole - not a member, not enabled - and renders above the
 * buttons.
 *
 * There is no `'done'` status: every action here either redirects or
 * revalidates the list it changed, so a success never returns.
 */

export type ProjectField = 'title' | 'kind' | 'projectType' | 'format' | 'form'

export type ProjectActionResult =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly field: ProjectField; readonly message: string }

export const IDLE: ProjectActionResult = { status: 'idle' }

export const failure = (field: ProjectField, message: string): ProjectActionResult => ({
  status: 'error',
  field,
  message,
})
