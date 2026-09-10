import { redirect } from 'next/navigation'

import { currentIdentity } from '../lib/auth/session'

/**
 * `/` - a doormat, not a page.
 *
 * AGENTS.md, Routing: "Everything under `/app/`. One prefix for the signed-in
 * product." So the root has nothing of its own to show and forwards on the one
 * fact it can establish: whether there is a session.
 *
 * There is no marketing page. If one is ever written it lands here, and this
 * redirect becomes the signed-in branch of it.
 *
 * `dynamic = 'force-dynamic'` because the answer depends on a cookie. Without
 * it Next would try to prerender this at build time, where `cookies()` is not
 * available - and on a machine with no Supabase project configured, that build
 * would fail on a page whose only job is to forward.
 */
export const dynamic = 'force-dynamic'

const RootPage = async () => {
  const identity = await currentIdentity()
  redirect(identity === null ? '/sign-in' : '/app')
}

export default RootPage
