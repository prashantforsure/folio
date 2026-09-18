import { useSyncExternalStore } from 'react'

/**
 * Three small cells the Characters route's layout and page both reach.
 *
 * The sidebar is the layout's while the grid and the drawer are the page's,
 * so a flag one sets and the other reads lives in a module cell rather than
 * in either tree. All three are component state by nature - a drawer or an
 * unfolded queue that survived a route change would open on the wrong
 * route - and none is an address (`lib/state/README.md`).
 *
 *   - `newCharacterOpen`  whether the `New character` drawer is open; the
 *                         sidebar's `+` and the toolbar's `+ New` set it.
 *   - `queueIntent`       which part of the queue to unfold on the Cast view:
 *                         the sidebar's `Needs a decision` rows, its
 *                         `Walk-ons` rows and the Scenes modal's link set it;
 *                         the queue subscribes, unfolds, and clears it.
 *   - `drawerIntent`      what the drawer should open on: the sidebar's ghost
 *                         `×` on an off-page record sets `delete` before
 *                         navigating, so the write goes through the page's
 *                         `run` and the status bar rather than a second path.
 */

type Listener = () => void

const cell = <T>(initial: T) => {
  let current = initial
  const listeners = new Set<Listener>()
  const set = (value: T): void => {
    if (value === current) return
    current = value
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const read = (): T => current
  const readServer = (): T => initial
  return { set, read, use: (): T => useSyncExternalStore(subscribe, read, readServer) }
}

const newCharacter = cell(false)

export const setNewCharacterOpen = (open: boolean): void => {
  newCharacter.set(open)
}

export const useNewCharacterOpen = (): boolean => newCharacter.use()

export type QueueIntent = 'rows' | 'walk-ons' | null

const queue = cell<QueueIntent>(null)

export const setQueueIntent = (intent: QueueIntent): void => {
  queue.set(intent)
}

/** Subscribed: the queue and the walk-ons line unfold when it changes, then clear it. */
export const useQueueIntent = (): QueueIntent => queue.use()

export type DrawerIntent = 'delete' | null

const drawer = cell<DrawerIntent>(null)

export const setDrawerIntent = (intent: DrawerIntent): void => {
  drawer.set(intent)
}

/** Read once and cleared by the drawer on mount. */
export const takeDrawerIntent = (): DrawerIntent => {
  const intent = drawer.read()
  drawer.set(null)
  return intent
}
