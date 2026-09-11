import type { ReactNode } from 'react'

import { requireUser } from '../../../../lib/auth/session'
import { Sidebar } from '../../_shell/sidebar'

/**
 * The home shell: the four-item sidebar beside a page column.
 *
 * This is the chrome `/app/new`, `/app/recents`, `/app/screenwriting`,
 * `/app/filmmaking`, `/app/trash` and `/app/settings` share. It used to be
 * drawn by `(app)/layout.tsx` for everything under `/app`; the project
 * workspace has a different chrome - the 66px rail - so the sidebar moved one
 * level down into this route group and the parent layout kept only what both
 * shells need: the session boundary, the ephemeral provider and the frame.
 *
 * `requireUser()` is called again here for the avatar. It is `cache()`d per
 * request, so this is a memo hit on the boundary check the parent already
 * made, not a second round trip.
 */
const HomeLayout = async ({ children }: { readonly children: ReactNode }) => {
  const user = await requireUser('/app')

  return (
    <>
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </>
  )
}

export default HomeLayout
