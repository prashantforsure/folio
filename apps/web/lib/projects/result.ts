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
 * `'done'` was added with the account routes (2026-09-22): a rename, an
 * archive and a trash all happen in place on a list the writer is looking at,
 * so they revalidate and come back rather than redirecting, and the dialog
 * that posted needs to know it may close. Creation still redirects and still
 * never returns.
 */

export type ProjectField = 'title' | 'kind' | 'projectType' | 'format' | 'logline' | 'file' | 'form'

export type ProjectActionResult =
  | { readonly status: 'idle' }
  | { readonly status: 'done' }
  | { readonly status: 'error'; readonly field: ProjectField; readonly message: string }

export const IDLE: ProjectActionResult = { status: 'idle' }

export const DONE: ProjectActionResult = { status: 'done' }

export const failure = (field: ProjectField, message: string): ProjectActionResult => ({
  status: 'error',
  field,
  message,
})

/** The launcher's "Start from a story": the project made, and where to go - never a redirect. */
export type StoryProjectResult =
  | { readonly status: 'created'; readonly projectId: string; readonly title: string; readonly href: string }
  | { readonly status: 'error'; readonly message: string }
