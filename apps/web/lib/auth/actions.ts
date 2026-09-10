'use server'

import type { AuthError } from '@supabase/supabase-js'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { APP_HOME, SIGN_IN, asRoute } from '../routes'
import { failure, sent } from './result'
import type { AuthResult } from './result'
import { supabaseServer } from './server'

/**
 * Every way into and out of a session.
 *
 * ## The auth model this file implements, and what it costs
 *
 * AGENTS.md, Constraints used to say "**No email provider.** Therefore: Google
 * OAuth only, no password accounts, no magic links, no email confirmation."
 * That constraint has been **overridden by the client for this phase**, in
 * favour of Google OAuth *and* email + password, with confirmation and password
 * reset delivered by **Supabase's built-in SMTP sender**. AGENTS.md,
 * Constraints has been rewritten in the same change to say so - a contract
 * describing code that no longer exists is worse than a permissive one.
 *
 * The cost is real, and it is not hidden from the user. Supabase's built-in
 * sender is rate limited project-wide - a handful of messages an hour - and
 * Supabase documents it as unsuitable for production. When it refuses, this
 * file says so, in those words; see `describe()`. "Please try again" is wrong
 * advice for a limit measured in hours.
 *
 * What did **not** change: there is still no transactional email provider, so
 * nothing notifies asynchronously, team invites are still share links copied by
 * the inviter, and job completion is still in-app only.
 *
 * ## Enumeration
 *
 * Sign-in failures are deliberately indistinguishable - a wrong password and an
 * address with no account return the same sentence - and the reset request
 * always reports success. Supabase's own errors are more specific than that;
 * `describe()` is the one place that flattening happens.
 */

const EmailSchema = z.email('That does not look like an email address.')

// Supabase's own minimum is 6. Eight is this app's, and the forms say so rather
// than leaving it to be discovered by being refused.
const PasswordSchema = z.string().min(8, 'Use at least 8 characters.')

const field = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const RATE_LIMITED =
  'Too many emails have gone out from this project in the last hour. Folio sends through ' +
  'Supabase’s built-in email, which is rate limited. Wait an hour, or sign in with Google.'

/**
 * Where Supabase should send the browser back to.
 *
 * Built from the request rather than from an env var, so a preview deployment,
 * a LAN address and localhost all work unconfigured. Those addresses still have
 * to be allow-listed in the Supabase dashboard under Authentication, URL
 * Configuration: Supabase refuses a `redirectTo` it does not recognise, and
 * that refusal is the security control here, not this function.
 */
const origin = async (): Promise<string> => {
  const head = await headers()
  const explicit = head.get('origin')
  if (explicit !== null && explicit.length > 0) return explicit
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000'
  const proto = head.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

const callbackUrl = async (next: string): Promise<string> =>
  `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`

/**
 * A Supabase auth error, in the writer's terms.
 *
 * The rate-limit branch is the one that earns its place: it is the predictable
 * consequence of the built-in-SMTP decision, and it is the only failure here
 * that is about the project rather than about the person typing.
 */
const describe = (error: AuthError): string => {
  const message = error.message.toLowerCase()
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return RATE_LIMITED
  }
  if (message.includes('email not confirmed')) {
    return 'That account has not been confirmed yet. The confirmation link is in your inbox.'
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'There is already an account with that address. Sign in instead, or reset the password.'
  }
  return error.message
}

const isRateLimit = (error: AuthError): boolean =>
  error.status === 429 || error.message.toLowerCase().includes('rate limit')

/**
 * Google. AGENTS.md's original provider, and still the one that touches no
 * email infrastructure at all.
 *
 * `skipBrowserRedirect` because this runs on the server: Supabase hands back a
 * URL and Next performs the redirect, which keeps the PKCE code verifier in a
 * cookie this server wrote.
 */
export const signInWithGoogle = async (
  _previous: AuthResult,
  formData: FormData,
): Promise<AuthResult> => {
  const supabase = await supabaseServer()
  const next = field(formData, 'next') || APP_HOME
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: await callbackUrl(next), skipBrowserRedirect: true },
  })

  if (error !== null) return failure('form', describe(error))
  // Supabase's own URL, not user input: it is built by the SDK from the
  // project URL and is never a route in this app.
  redirect(asRoute(data.url))
}

export const signInWithPassword = async (
  _previous: AuthResult,
  formData: FormData,
): Promise<AuthResult> => {
  const email = EmailSchema.safeParse(field(formData, 'email'))
  if (!email.success) return failure('email', email.error.issues[0]?.message ?? 'Check the address.')

  const password = field(formData, 'password')
  if (password.length === 0) return failure('password', 'Enter your password.')

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password })

  if (error !== null) {
    // Deliberately identical for "wrong password" and "no such account".
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      return failure('form', 'That email and password do not match an account.')
    }
    return failure('form', describe(error))
  }

  redirect(asRoute(field(formData, 'next') || APP_HOME))
}

/**
 * Sign up, with a confirmation email.
 *
 * The confirmation is what the client's choice bought. Without a sender there
 * is no way to verify an address at all, and an unverified address is not an
 * identity: it would let anyone register somebody else's email, and it would
 * make share-link invites unsafe the moment they exist.
 *
 * When confirmations are on, Supabase returns success for an address that is
 * already registered and sends a "you already have an account" mail instead.
 * That is its anti-enumeration behaviour and it is left alone.
 */
export const signUpWithPassword = async (
  _previous: AuthResult,
  formData: FormData,
): Promise<AuthResult> => {
  const email = EmailSchema.safeParse(field(formData, 'email'))
  if (!email.success) return failure('email', email.error.issues[0]?.message ?? 'Check the address.')

  const password = PasswordSchema.safeParse(field(formData, 'password'))
  if (!password.success) {
    return failure('password', password.error.issues[0]?.message ?? 'Choose a longer password.')
  }

  const supabase = await supabaseServer()
  const next = field(formData, 'next') || APP_HOME
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: { emailRedirectTo: await callbackUrl(next) },
  })

  if (error !== null) return failure('form', describe(error))

  // A session here means the project has email confirmation switched off. That
  // is a dashboard setting this code does not control, so both outcomes are
  // handled rather than one assumed.
  if (data.session !== null) redirect(asRoute(next))

  return sent(
    `Check ${email.data} for a link confirming the address. Give it a few minutes — Folio ` +
      'sends through Supabase’s built-in email, which is slow and rate limited.',
  )
}

/**
 * Ask for a reset link.
 *
 * Always reports success, whatever Supabase says, so this endpoint cannot be
 * used to discover which addresses have accounts. The rate limit is the one
 * exception and it is reported honestly: it is a fact about the project, not
 * about the address, and hiding it leaves somebody waiting for a mail that was
 * never sent.
 */
export const requestPasswordReset = async (
  _previous: AuthResult,
  formData: FormData,
): Promise<AuthResult> => {
  const email = EmailSchema.safeParse(field(formData, 'email'))
  if (!email.success) return failure('email', email.error.issues[0]?.message ?? 'Check the address.')

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: await callbackUrl('/reset-password'),
  })

  if (error !== null && isRateLimit(error)) return failure('form', RATE_LIMITED)

  return sent(`If ${email.data} has an account, a reset link is on its way. Give it a few minutes.`)
}

/**
 * Set a new password, using the recovery session the callback established.
 *
 * There is no "current password" field, because not knowing it is the situation
 * the user is in. The recovery session is the authorisation, and it came from
 * an email only the address owner could read.
 */
export const updatePassword = async (
  _previous: AuthResult,
  formData: FormData,
): Promise<AuthResult> => {
  const password = PasswordSchema.safeParse(field(formData, 'password'))
  if (!password.success) {
    return failure('password', password.error.issues[0]?.message ?? 'Choose a longer password.')
  }
  if (field(formData, 'confirm') !== password.data) {
    // Its own field rather than 'password', so the message appears once, under
    // the box that is wrong, instead of under both.
    return failure('confirm', 'The two passwords do not match.')
  }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.getUser()
  if (error !== null || data.user === null) {
    return failure('form', 'That reset link has expired or has already been used. Ask for a new one.')
  }

  const updated = await supabase.auth.updateUser({ password: password.data })
  if (updated.error !== null) return failure('form', describe(updated.error))

  redirect(APP_HOME)
}

/**
 * Sign out.
 *
 * `scope: 'local'` clears this browser and leaves other devices signed in,
 * which is what a sign-out button means. Ending every session is a different,
 * deliberate act and belongs in account settings, which does not exist yet.
 */
export const signOut = async (): Promise<void> => {
  const supabase = await supabaseServer()
  await supabase.auth.signOut({ scope: 'local' })
  redirect(SIGN_IN)
}
