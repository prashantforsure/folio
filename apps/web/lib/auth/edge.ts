import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest, NextResponse } from 'next/server'

import { publicEnv } from '../env/public'

/**
 * The Supabase client `proxy.ts` uses, on the Edge runtime.
 *
 * ## Why this is here and not in `proxy.ts`
 *
 * `eslint.config.mjs` refuses `@supabase/*` imports everywhere except
 * `apps/web/lib/auth/**`, `apps/web/lib/storage/**` and
 * `apps/worker/src/storage/**`. AGENTS.md, Deliberately not using: "Supabase
 * client libraries for data access in server code. [...] The Supabase JS client
 * is for auth and storage only."
 *
 * The proxy needs a client, and there were two ways to give it one: widen the
 * lint exemption to cover `proxy.ts`, or put the construction behind the
 * boundary and import a function. Widening a security-shaped exemption to admit
 * one more file is how such lists stop meaning anything, so it is this. The
 * rule keeps its exact shape and the boundary keeps its exact membership.
 *
 * ## Why it is a third client and not `supabaseServer()`
 *
 * Three different cookie stores, not three copies of one idea:
 *
 *   `server.ts`   `cookies()` from `next/headers`. Reads freely; **cannot**
 *                 write, because a Server Component may not set a cookie.
 *   `browser.ts`  `document.cookie`, via `createBrowserClient`.
 *   here          the request/response pair, which is the **only** place a
 *                 refreshed token can actually be persisted.
 *
 * ## Both objects are written to, and that is not redundant
 *
 * `setAll` writes each cookie onto `request.cookies` *and* `response.cookies`.
 * The request copy is what anything later in this same pass reads; the response
 * copy is what reaches the browser. Writing only the response leaves the rest
 * of the pass looking at the old token; writing only the request refreshes a
 * token nobody keeps, on every request, forever.
 */
export const supabaseForProxy = (request: NextRequest, response: NextResponse): SupabaseClient => {
  const env = publicEnv()

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (written) => {
        for (const cookie of written) {
          request.cookies.set(cookie.name, cookie.value)
          response.cookies.set(cookie.name, cookie.value, cookie.options)
        }
      },
    },
  })
}
