import type { EmailOtpType, User as AuthUser } from '@supabase/supabase-js'

import { supabaseServer } from './server'

/**
 * Turning a link into a session.
 *
 * Every route into a session ends here - Google, email confirmation and
 * password recovery all land on `/auth/callback`, which is why `syncProfile()`
 * has exactly one caller.
 *
 * ## Why this is a module and not the route handler
 *
 * `eslint.config.mjs` confines `@supabase/*` imports to `lib/auth/**`,
 * `lib/storage/**` and `apps/worker/src/storage/**`. The route handler needs
 * `EmailOtpType`, so either the exemption widens to admit `app/auth/**` or the
 * Supabase knowledge moves behind the boundary. Widening a security-shaped
 * exemption one file at a time is how such lists stop meaning anything, so it
 * is this - the same call that `lib/auth/edge.ts` makes for the proxy.
 *
 * It leaves the route handler doing what a route handler should: read the
 * query, call one function, redirect. Redirect policy - and the validation of
 * `next` that makes it safe - stays there, because that is routing.
 *
 * ## Two link shapes, because Supabase sends two
 *
 * - **`?code=`** - the PKCE exchange. Google, and the default confirmation
 *   template, arrive this way.
 * - **`?token_hash=&type=`** - the older OTP shape, still produced by a project
 *   whose email templates use `{{ .TokenHash }}`. Handling it is a few lines,
 *   and its absence is a confirmation link that dead-ends on a project
 *   configured slightly differently from the one this was written against.
 *
 * ## Failure is data, not a throw
 *
 * An expired or reused link is the common case, not an edge case: reset links
 * are single-use and mail clients pre-fetch them. So the outcome is a
 * discriminated result carrying a sentence, and the caller decides where to put
 * it - which is a page the person can act on, not an error screen.
 */

export type CallbackOutcome =
  | { readonly ok: true; readonly user: AuthUser }
  | { readonly ok: false; readonly reason: string }

const OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]

const isOtpType = (raw: string): raw is EmailOtpType =>
  (OTP_TYPES as readonly string[]).includes(raw)

const refused = (reason: string): CallbackOutcome => ({ ok: false, reason })

export const establishSession = async (params: URLSearchParams): Promise<CallbackOutcome> => {
  // Supabase reports a refused link in the query string rather than by status.
  const providerError = params.get('error_description') ?? params.get('error')
  if (providerError !== null) return refused(providerError)

  const supabase = await supabaseServer()
  const code = params.get('code')
  const tokenHash = params.get('token_hash')
  const rawType = params.get('type')
  const type = rawType !== null && isOtpType(rawType) ? rawType : null

  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error !== null) return refused(error.message)
  } else if (tokenHash !== null && type !== null) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error !== null) return refused(error.message)
  } else {
    return refused('That link is missing its token. Ask for a new one.')
  }

  // getUser, not getSession: getSession trusts the cookie without verifying it.
  const { data } = await supabase.auth.getUser()
  if (data.user === null) return refused('That link did not produce a session.')

  return { ok: true, user: data.user }
}
