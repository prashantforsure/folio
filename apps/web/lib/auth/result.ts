/**
 * What a server action hands back.
 *
 * AGENTS.md, Conventions > Errors: "Server actions return a discriminated
 * result, never a bare throw across the boundary." A thrown error crossing a
 * Server Action boundary in production is replaced by Next with an opaque
 * digest, so the user is shown nothing useful and the developer is shown a hash
 * - which is why the rule exists rather than being a matter of taste.
 *
 * `redirect()` is the one exception and it is not an exception: it throws a
 * sentinel Next itself catches, and a successful sign-in never returns.
 *
 * `field` exists so a form can put the message beside the input it belongs to.
 * `'form'` means the message is about the attempt rather than a value - a wrong
 * password, a rate limit - and belongs above the submit button.
 */

export type AuthField = 'email' | 'password' | 'confirm' | 'form'

export type AuthResult =
  | { readonly status: 'idle' }
  | { readonly status: 'error'; readonly field: AuthField; readonly message: string }
  | { readonly status: 'sent'; readonly message: string }

export const IDLE: AuthResult = { status: 'idle' }

export const failure = (field: AuthField, message: string): AuthResult => ({
  status: 'error',
  field,
  message,
})

export const sent = (message: string): AuthResult => ({ status: 'sent', message })
