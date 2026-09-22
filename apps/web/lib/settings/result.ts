/**
 * What an account-settings action hands back.
 *
 * AGENTS.md, Conventions > Errors: "Server actions return a discriminated
 * result, never a bare throw across the boundary." Same shape as
 * `lib/auth/result.ts` and `lib/projects/result.ts`, and in its own file for
 * the same reason they are: **a `'use server'` module may export nothing but
 * async functions.** A constant beside the actions type-checks, lints and
 * builds, and then fails at runtime the first time the form posts - "A 'use
 * server' file can only export async functions, found object" - which is a
 * long way from the line that caused it. The split is what makes that
 * impossible rather than remembered.
 *
 * `field` names which control the message belongs beside; `'form'` is about
 * the attempt as a whole and renders in the save bar.
 */

export type SettingsField = 'name' | 'password' | 'confirm' | 'form'

export type SettingsResult =
  | { readonly status: 'idle' }
  | { readonly status: 'saved'; readonly message: string }
  | { readonly status: 'error'; readonly field: SettingsField; readonly message: string }

export const SETTINGS_IDLE: SettingsResult = { status: 'idle' }

export const saved = (message: string): SettingsResult => ({ status: 'saved', message })

export const failure = (field: SettingsField, message: string): SettingsResult => ({
  status: 'error',
  field,
  message,
})
