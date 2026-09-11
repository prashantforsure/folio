import { transactionDatabase, readUser } from '@folio/db'
import { userId as brandUserId } from '@folio/contracts'
import type { UserId } from '@folio/contracts'
import type { User as AuthUser } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { asRoute } from '../routes'
import { avatarUrlFrom, displayNameFrom, initialsFrom } from './identity'
import { supabaseServer } from './server'

/**
 * Who is signed in, for Server Components and server actions.
 *
 * ## `getUser`, never `getSession`
 *
 * `getSession()` reads the cookie and believes it. `getUser()` asks the Auth
 * server to verify the JWT. Every decision in this app about whether somebody
 * is signed in goes through this function, so the verifying call is made once,
 * here, and the unverified one appears nowhere in the repository.
 *
 * ## Route protection is enforced twice, on purpose
 *
 * `proxy.ts` redirects an unauthenticated request away from `/app/**`
 * before a render starts. That is a redirect, not a security boundary: it runs
 * on a path matcher, and a matcher is a list somebody edits. `requireUser()` is
 * the boundary, and it is called by the layout every `/app` route renders
 * inside, so a route added to the tree is protected by being in the tree rather
 * than by being remembered in a config.
 *
 * AGENTS.md, Development philosophy 5: "The server enforces; the client
 * discloses."
 */

export type ShellUser = {
  readonly id: UserId
  readonly email: string | null
  readonly displayName: string
  readonly initials: string
  readonly avatarUrl: string | null
}

const claimsOf = (user: AuthUser): Record<string, unknown> => user.user_metadata

/**
 * Wrapped in React's `cache()` so one request asks the Auth server once.
 *
 * The `(app)` layout calls `requireUser()` as the security boundary, and the
 * pages inside it call it again because they need the user's id and a layout
 * cannot pass props to a page. Without the cache that is two verifying round
 * trips per render; with it the second call is a memo hit for the life of the
 * request and nothing else. `cache()` is per request in Server Components, so
 * nothing leaks between users.
 */
export const currentIdentity = cache(async (): Promise<AuthUser | null> => {
  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.getUser()
  if (error !== null) return null
  return data.user
})

/**
 * The identity, enriched by our own `users` row when there is one.
 *
 * AGENTS.md, Tech stack: "`auth.users` is identity; `users`/`memberships` are
 * ours." So identity is the base and the profile row is an overlay, not the
 * other way round. That ordering is what makes the first render after sign-up
 * work: the trigger in `0001_rls_and_grants.sql` and `syncProfile()` both write
 * the row, but a render can still arrive before either has, and a chrome that
 * needs a row it might not have yet is a chrome that intermittently has no
 * name in it.
 *
 * A failed profile read is logged and stepped over rather than thrown. The
 * repository is reached over the transaction pooler, and losing the database
 * should degrade the avatar menu, not sign the user out of an app whose session
 * is in a cookie and is still perfectly valid. **Note for the phase that adds
 * observability:** this is a `console.error` because pino and Sentry are not
 * installed yet; it is a structured object so it is one line to convert.
 */
export const shellUserFrom = async (identity: AuthUser): Promise<ShellUser> => {
  const id = brandUserId(identity.id)
  const claims = claimsOf(identity)
  const email = identity.email ?? null

  let displayName = displayNameFrom(email, claims)
  let avatarUrl = avatarUrlFrom(claims)

  try {
    const db = await transactionDatabase()
    const profile = await readUser(db, id)
    if (profile !== null) {
      displayName = profile.displayName
      avatarUrl = profile.avatarUrl
    }
  } catch (cause) {
    console.error({
      event: 'folio.profile.read_failed',
      userId: identity.id,
      message: cause instanceof Error ? cause.message : String(cause),
      note: 'Falling back to auth claims. The session is unaffected.',
    })
  }

  return { id, email, displayName, initials: initialsFrom(displayName), avatarUrl }
}

/** The signed-in user, or a redirect to sign-in carrying where they were going. */
export const requireUser = async (returnTo: string): Promise<ShellUser> => {
  const identity = await currentIdentity()
  // A query string, so `Route` cannot describe it as a literal.
  if (identity === null) redirect(asRoute(`/sign-in?next=${encodeURIComponent(returnTo)}`))
  return shellUserFrom(identity)
}
