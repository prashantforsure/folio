import type { Route } from 'next'

/**
 * The one place a runtime string becomes a route.
 *
 * `next.config.ts` sets `typedRoutes: true`, so `Route` is a union of the paths
 * that actually exist and `redirect('/app')` typechecks only because `/app`
 * is one of them. That is the good case and it needs nothing from this file.
 *
 * The bad case is unavoidable and worth naming rather than scattering: three of
 * the auth actions redirect to a destination that **came from a form field**.
 * A `next` parameter is a string at runtime by definition, and no amount of
 * typing proves a string the user's browser sent is a route this app declares.
 * The type system cannot help, so the assertion is made once, here, where it
 * can be read together with the check that makes it safe.
 *
 * ## The assertion is not the safety; `safeNext` is
 *
 * What actually protects this is validation, in three places, all of which run
 * before anything reaches here:
 *
 *   - `safeNextParam()` in `app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx`,
 *     before the value is put into a hidden input,
 *   - `safeNextParam()` in `lib/auth/actions.ts`, on the way back out of the
 *     form - the hidden input is a suggestion and the request body is what
 *     arrives, so the render-time check protects nothing on its own, and
 *   - `safeNextParam()` in `app/auth/callback/route.ts`, before it is followed.
 *
 * All three require a single leading slash and reject a second, so `//evil.example`
 * and `https://evil.example` are both refused. That double slash is the case
 * that is easy to miss: a browser reads `//host` as protocol-relative, and a
 * naive `startsWith('/')` waves it through. An unchecked redirect target on a
 * page reached from a genuine confirmation email is the most convincing
 * phishing step this app could offer.
 *
 * If a route ever *cannot* be validated to a known path, the answer is a
 * lookup table, not a wider assertion.
 *
 * This is a single `as`, not the banned `as unknown as` (AGENTS.md, Conventions
 * > Typing).
 */
export const asRoute = (path: string): Route => path as Route

/**
 * `next` out of `searchParams`, made safe before it reaches a hidden input.
 *
 * One leading slash and not two, so neither `//evil.example` nor an absolute
 * URL survives. It is applied at each of the three points above on purpose -
 * rendering the form, reading the submitted field, and following the callback.
 * Any one alone leaves a path where the others are not consulted, and the
 * render-time one is the weakest of the three: nothing obliges a request to
 * carry the value that was drawn.
 *
 * It lives here rather than beside the forms because it is pure, and because a
 * redirect guard that sits in a file full of JSX is a redirect guard nobody
 * finds when they go looking for the redirect guard.
 */
export const safeNextParam = (raw: string | string[] | undefined): string => {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) return '/app'
  return value
}

export const firstParam = (raw: string | string[] | undefined): string | undefined =>
  Array.isArray(raw) ? raw[0] : raw

/** Where a successful sign-in goes when nothing else was asked for. */
export const APP_HOME = '/app'

/** Where sign-out and an unauthenticated request go. */
export const SIGN_IN = '/sign-in'
