import { transactionDatabase, upsertUser } from '@folio/db'
import { userId as brandUserId } from '@folio/contracts'
import type { User as AuthUser } from '@supabase/supabase-js'

import { avatarUrlFrom, displayNameFrom } from './identity'

/**
 * Copy the auth identity into our own `users` row.
 *
 * AGENTS.md, Tech stack: "`auth.users` is identity; `users`/`memberships` are
 * ours." `users.id` **is** the `auth.users` id, so this is a projection rather
 * than a join key - see the header on `packages/db/src/schema/tenancy.ts` for
 * why there is no cross-schema foreign key.
 *
 * ## Called once, at the callback, and best-effort
 *
 * Every route into a session lands on `/auth/callback` - Google, email
 * confirmation and password recovery all do - so that is the one place this
 * runs. Doing it on every request would be a write on the read path.
 *
 * Failure is logged and swallowed. That is a deliberate choice with a cost, so
 * it is stated: if the database is unreachable, the user still gets signed in
 * and the shell falls back to the auth claims (`shellUserFrom`), and their
 * profile row is written the next time they sign in. The alternative - failing
 * the callback - would mean a database blip logs everybody out of an
 * application whose sessions live in cookies and are independently valid.
 *
 * `0001_rls_and_grants.sql` also carries a signup trigger that inserts this
 * row, so this is a second writer to the same row rather than the only one.
 * `upsertUser` is an upsert precisely so the two cannot collide - and it also
 * refreshes the name and avatar, which the trigger cannot do on later sign-ins.
 *
 * **Note for the phase that adds observability:** `console.error` because pino
 * and Sentry are not installed yet. The payload is already structured.
 */
export const syncProfile = async (identity: AuthUser): Promise<void> => {
  const email = identity.email
  if (email === undefined) {
    // `users.email` is NOT NULL and there is no sensible placeholder. Every
    // provider this app offers supplies one; an identity without it is not a
    // person we can file.
    console.error({
      event: 'folio.profile.no_email',
      userId: identity.id,
      note: 'Identity has no email address; profile row not written.',
    })
    return
  }

  try {
    const db = await transactionDatabase()
    await upsertUser(db, {
      id: brandUserId(identity.id),
      email,
      displayName: displayNameFrom(email, identity.user_metadata),
      avatarUrl: avatarUrlFrom(identity.user_metadata),
    })
  } catch (cause) {
    console.error({
      event: 'folio.profile.sync_failed',
      userId: identity.id,
      message: cause instanceof Error ? cause.message : String(cause),
      note: 'Sign-in proceeded. The row is written on the next sign-in.',
    })
  }
}
