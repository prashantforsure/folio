'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { resetScenesView, useScenesView } from './view-state'

/**
 * The route's `<main>`: the box the writing layout's surface card holds,
 * around the body in every one of its states - the empty cards or the
 * workspace. The geometry is what the chrome's `RouteShell` drew before the
 * views became state (the same two boxes: a column that clips, a body that
 * scrolls), so the empty card and the canvas sit where they did. Scenes was
 * the last route on that shell, and it went with this pass.
 *
 * It is a client component for one attribute. The smoke test reads the
 * current view off `main[data-route="scenes"][data-sub-view]`, the contract
 * every route keeps; the shell wrote it from the parsed `?view=`, and now
 * that the view is the cell (`view-state.tsx`, ruled 2026-09-17) only a
 * client tree can read it. The Storyboard's workspace writes the same
 * attribute on its own `<main>`.
 *
 * The cell resets here, on unmount - here and not in the workspace, since
 * the workspace is not mounted over an empty episode and the reset must
 * hold for every state: leave the route on the list, come back through the
 * sidebar's row, and it opens on the cards, as the bare-path link did.
 */
export const ScenesMain = ({ children }: { readonly children: ReactNode }) => {
  const view = useScenesView()
  useEffect(() => resetScenesView, [])
  return (
    <main data-route="scenes" data-sub-view={view} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </main>
  )
}
