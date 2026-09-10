import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { establishSession } from '../../../lib/auth/callback'
import { syncProfile } from '../../../lib/auth/profile'
import { safeNextParam } from '../../../lib/routes'

/**
 * The single door into a session.
 *
 * Google, email confirmation and password recovery all land here, which is why
 * `syncProfile()` has exactly one caller. The Supabase half of this - the two
 * link shapes, the exchange, the verification - is in `lib/auth/callback.ts`,
 * behind the boundary eslint draws around `@supabase/*` imports. What is left
 * here is routing: read the query, decide where to send the browser.
 *
 * ## `next` is validated, and that is not paranoia
 *
 * `next` comes from a URL, and a URL in a confirmation email is a URL an
 * attacker can compose. Passing it unchecked to a redirect is an open redirect
 * on a page the user has just been told to trust - the classic phishing step,
 * made worse here by arriving in a genuine email from the real product.
 * `safeNextParam()` requires a single leading slash and rejects a second;
 * `//evil.example` and `https://evil.example` are both refused, and the
 * double-slash case is the one that is easy to miss.
 *
 * It is applied here **and** where the value is put into the form, in
 * `(auth)/sign-in/page.tsx`. Either alone leaves a path where the other is not
 * consulted.
 *
 * ## Failure goes somewhere a person can act
 *
 * An expired or reused link is the common case - reset links are single-use and
 * mail clients pre-fetch them - so this redirects to sign-in with a readable
 * reason rather than rendering an error page with no way forward.
 */

const bounce = (request: NextRequest, reason: string): NextResponse => {
  const url = request.nextUrl.clone()
  url.pathname = '/sign-in'
  url.search = ''
  url.searchParams.set('problem', reason)
  return NextResponse.redirect(url)
}

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  const next = safeNextParam(request.nextUrl.searchParams.get('next') ?? undefined)

  const outcome = await establishSession(request.nextUrl.searchParams)
  if (!outcome.ok) return bounce(request, outcome.reason)

  // Best-effort, and never a reason to fail the sign-in. See profile.ts.
  await syncProfile(outcome.user)

  // `new URL(next, origin)` rather than assigning to `pathname`, so a `next`
  // that carries a query string - `/app/project/x?view=map` - survives instead
  // of having its `?` percent-encoded into the path.
  return NextResponse.redirect(new URL(next, request.nextUrl.origin))
}
