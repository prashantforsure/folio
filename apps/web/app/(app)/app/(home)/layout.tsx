import { countProjectsFor, readCreditsFor, transactionDatabase } from '@folio/db'
import type { ReactNode } from 'react'

import { requireUser } from '../../../../lib/auth/session'
import { HomeSidebar } from '../../_shell/home-sidebar'

/**
 * The home shell: the 238px sidebar beside the page column, on `--bg` with
 * the two ambient glows behind everything.
 *
 * This is the chrome `/app/new`, `/app/projects`, `/app/trash` and
 * `/app/settings` share (`handoff-account-v2/README.md`, "Shared shell"). The
 * project workspace has a different chrome - the 56px rail - so it draws its
 * own; the parent layout keeps only what both need: the session boundary, the
 * ephemeral provider and the frame.
 *
 * ## Two reads, both live, both cheap
 *
 * The sidebar prints a project count and a credit balance on every route, so
 * the layout reads them: `countProjectsFor` is one count, `readCreditsFor` one
 * sum over the ledger. Neither is cached and neither is stored - AGENTS.md, UI
 * fidelity: "Badges are live counts, never placeholders", and Jobs, credits
 * and cost: "the balance is computed, never stored". A layout re-runs when a
 * server action revalidates `/app`, which is how both move after a write.
 *
 * The count excludes archived projects, because the sidebar's number and the
 * Projects route's `All` chip are the same number and the chip excludes them.
 *
 * `requireUser()` is called again here for the account button. It is `cache()`d
 * per request, so this is a memo hit on the boundary check the parent already
 * made, not a second round trip.
 */
const HomeLayout = async ({ children }: { readonly children: ReactNode }) => {
  const user = await requireUser('/app')
  const db = await transactionDatabase()
  const [projects, credits] = await Promise.all([
    countProjectsFor(db, user.id, { trashed: false, archived: false }),
    readCreditsFor(db, user.id),
  ])
  const share = credits.settled > 0 ? Math.max(0, Math.min(1, credits.available / credits.settled)) : 0

  return (
    <>
      <div className="folio-ambient" />
      <HomeSidebar user={user} projects={projects} credits={{ available: credits.available, share }} />
      {children}
    </>
  )
}

export default HomeLayout
