/**
 * Turning a Supabase auth user into the three strings the chrome needs.
 *
 * Split out from `session.ts` because it is pure and therefore testable without
 * a Supabase project, a database or a request - and because "which part of a
 * name is the initial" is a product decision that deserves to be somewhere a
 * human can find it and disagree with it.
 *
 * ## Why a display name has to be derived at all
 *
 * With Google OAuth the claims carry `full_name` and `picture`, so there is
 * nothing to decide. Email sign-up carries neither: Supabase's `auth.users` row
 * for a password account has an email and nothing else. AGENTS.md's `users`
 * table makes `display_name` NOT NULL, so something has to fill it, and this
 * phase has no settings page in which to ask.
 *
 * The local part of the email is the least-wrong answer available: it is what
 * the person typed, it is stable, and it is obviously provisional in a way a
 * generated "User 4821" is not. It is also the first thing an account settings
 * page will let them change, which is where this stops being a guess.
 */

/** The claim keys Supabase's Google provider writes. Not ours to rename. */
type IdentityClaims = {
  readonly full_name?: unknown
  readonly name?: unknown
  readonly avatar_url?: unknown
  readonly picture?: unknown
}

const firstString = (...candidates: readonly unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return null
}

export const displayNameFrom = (
  email: string | null,
  claims: IdentityClaims | null,
): string => {
  const claimed = firstString(claims?.full_name, claims?.name)
  if (claimed !== null) return claimed

  const local = firstString(email?.split('@')[0])
  if (local !== null) return local

  // Neither an email nor a claim. Supabase can produce this for an anonymous
  // sign-in, which this app does not offer; it is here so the return type has
  // no null branch rather than because it is expected.
  return 'Signed in'
}

export const avatarUrlFrom = (claims: IdentityClaims | null): string | null =>
  firstString(claims?.avatar_url, claims?.picture)

/**
 * One or two characters for the round chip.
 *
 * Two words give two initials; one word gives one character, not two, because
 * the second character of a lowercased email local part is noise. Uses the
 * first code point rather than `charAt(0)` so a name outside the BMP - or a
 * Devanagari name, which AGENTS.md's own worked example uses - does not get cut
 * in half into an unrenderable surrogate.
 */
export const initialsFrom = (displayName: string): string => {
  const words = displayName.trim().split(/\s+/).filter((word) => word.length > 0)
  const first = words[0]
  if (first === undefined) return '?'

  const head = [...first][0] ?? '?'
  const second = words[1]
  if (second === undefined) return head.toUpperCase()

  const tail = [...second][0] ?? ''
  return (head + tail).toUpperCase()
}
