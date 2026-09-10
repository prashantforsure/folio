import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { publicEnv } from '../env/public'

/**
 * The Supabase client for server code. **Auth and storage only** - see
 * `browser.ts` for the rule and where it is enforced.
 *
 * ## It uses the anon key, not the service-role key, and that is correct
 *
 * AGENTS.md, Tenancy says "The server uses the service-role key, which bypasses
 * RLS" - that sentence is about **data access**, which in this codebase is
 * Drizzle over `DATABASE_URL_*`, and it is why the project-scoped repository
 * layer has to be the mechanism. It is not about auth.
 *
 * Reading who is signed in is the opposite situation: the request carries the
 * user's own session cookie, and the anon key plus that cookie is exactly the
 * identity we want. Using the service-role key here would mean the auth client
 * could act as anybody, which is both unnecessary and the single most dangerous
 * object this codebase could construct.
 *
 * Nothing in this phase needs `SUPABASE_SERVICE_ROLE_KEY`. It stays declared in
 * `@folio/db/env` for Storage and admin operations in later phases.
 *
 * ## `getUser`, never `getSession`, on the server
 *
 * `getSession()` returns whatever is in the cookie without verifying it, so a
 * forged cookie satisfies it. `getUser()` calls the Auth server and validates
 * the JWT. Everything on this path that decides whether someone is signed in
 * goes through `currentIdentity()` in `session.ts`, which uses `getUser`.
 *
 * ## The `setAll` try/catch is not swallowing an error
 *
 * Server Components may not write cookies - Next throws if they try. Refreshing
 * a token during a render is therefore expected to fail here, and the write is
 * done by `proxy.ts` instead, which runs before the render and can set
 * them. Removing the catch turns every expired-token render into a crash. The
 * comment is at the catch as well, because that is where somebody will read it.
 */
export const supabaseServer = async (): Promise<SupabaseClient> => {
  const env = publicEnv()
  const store = await cookies()

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (written) => {
        try {
          for (const cookie of written) store.set(cookie.name, cookie.value, cookie.options)
        } catch {
          // A Server Component cannot set a cookie. Expected: the refreshed
          // token is written by proxy.ts, which runs first and can.
        }
      },
    },
  })
}
