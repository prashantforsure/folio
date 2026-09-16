import { useSyncExternalStore } from 'react'

/**
 * Whether a route's edit drawer is open - `docs/ui design/README.md`,
 * "Panels (assistant and drawer)": both are 400px, in flow above 1200px
 * and over the content below it, where "an open panel also **forces the
 * sidebar closed** ... Solve it at the shell, not in the children."
 *
 * The assistant is the shell's own flag; the drawer is a route's - the
 * Characters route's is its `/characters/:id` URL - and the shell cannot
 * see a page's params. So the route publishes into this one cell while its
 * drawer is mounted, and `_chrome/project-shell.tsx` reads it beside the
 * assistant flag for the one breakpoint rule. The same shape as
 * `lib/storyboard/coverage.ts`, for the same reason; the drawer clears it
 * on unmount.
 */

type Listener = () => void

let current = false
const listeners = new Set<Listener>()

export const publishDrawer = (open: boolean): void => {
  if (open === current) return
  current = open
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): boolean => current
const readServer = (): boolean => false

export const useDrawerOpen = (): boolean => useSyncExternalStore(subscribe, read, readServer)
