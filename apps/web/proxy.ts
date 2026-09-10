import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { supabaseForProxy } from './lib/auth/edge'

/**
 * Token refresh, and the first of two route guards.
 *
 * ## Why this is `proxy.ts` and not `middleware.ts`
 *
 * Next 16 deprecates the `middleware` file convention in favour of `proxy`,
 * and warns on every build while the old name is used. Same execution model,
 * same Edge runtime, same `config.matcher`; only the file name and the exported
 * function name changed. Every Supabase document still says "middleware", so
 * this note is here to save the next person looking for a file that is not
 * there.
 *
 * ## Why this file has to exist at all
 *
 * Supabase access tokens are short-lived. A Server Component cannot write a
 * cookie, so it cannot store a refreshed token - see the `setAll` catch in
 * `lib/auth/server.ts`. Middleware runs before the render and can, so this is
 * the only place a refresh can be persisted. Without it a session silently
 * stops working about an hour after sign-in, which is exactly long enough to
 * look like something else.
 *
 * ## It is a redirect, not the security boundary
 *
 * The boundary is `requireUser()` in `lib/auth/session.ts`, called by the
 * `(app)` layout that every `/app` route renders inside. This file only spares
 * the user a render they were going to be bounced out of. The distinction
 * matters because `matcher` below is a list, and lists get edited: a route
 * added to the tree is protected by being in the tree, never by being
 * remembered here.
 *
 * AGENTS.md, Development philosophy 5: "The server enforces; the client
 * discloses." Middleware is closer to the client than it looks.
 *
 * ## The response object is passed through, not rebuilt
 *
 * `supabase.auth.getUser()` may refresh the token, and the new cookies are
 * written onto `response` by `setAll` in `lib/auth/edge.ts`. Constructing a
 * fresh `NextResponse` after that call - the obvious tidy-up - throws those
 * cookies away and produces a session that refreshes on every request and never
 * persists.
 *
 * ## No `@supabase/*` and no `@folio/db` import here, deliberately
 *
 * The Supabase client is built in `lib/auth/edge.ts` because eslint confines
 * those imports to `lib/auth/**`; that file's header explains why the exemption
 * was not widened instead.
 *
 * `@folio/db` is absent for a different reason: this runs on the Edge runtime,
 * where `postgres` and `process.loadEnvFile` do not exist. The profile row is
 * written at `/auth/callback`, which is a Node route.
 */

/** Everything under this prefix requires a session. AGENTS.md, Routing. */
const PROTECTED_PREFIX = '/app'

/** Signed-in users have no business on these. */
const AUTH_PATHS = new Set(['/sign-in', '/sign-up', '/forgot-password'])

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const response = NextResponse.next({ request })
  const supabase = supabaseForProxy(request, response)

  // getUser, not getSession: getSession trusts the cookie without verifying it.
  const { data } = await supabase.auth.getUser()
  const signedIn = data.user !== null
  const path = request.nextUrl.pathname

  if (!signedIn && (path === PROTECTED_PREFIX || path.startsWith(`${PROTECTED_PREFIX}/`))) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.search = ''
    url.searchParams.set('next', `${path}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }

  if (signedIn && AUTH_PATHS.has(path)) {
    const url = request.nextUrl.clone()
    url.pathname = PROTECTED_PREFIX
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

/**
 * Everything except static assets and the auth callback.
 *
 * `/auth/callback` is excluded because it establishes the session itself;
 * running a refresh against a request that has no session yet is wasted work
 * and, on a recovery link, races the exchange.
 *
 * The pattern excludes `_next` and anything with a file extension. Running this
 * on every image request costs an Auth round trip per asset.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|auth/callback|favicon.ico|fonts/|.*\\.[\\w]+$).*)'],
}
