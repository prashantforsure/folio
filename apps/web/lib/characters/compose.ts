import { useSyncExternalStore } from 'react'

/**
 * Two small cells the Characters route's page and other routes both reach.
 *
 * A flag set outside the workspace's tree (the empty card's `＋ By hand`,
 * the Scenes modal's link to the queue) lives in a module cell rather than
 * in either tree. Both are component state by nature - a drawer or an
 * unfolded queue that survived a route change would open on the wrong
 * route - and neither is an address (`lib/state/README.md`).
 *
 *   - `newCharacterOpen`  whether the `New character` drawer is open; the
 *                         toolbar's `＋ New character` and the empty card set it.
 *   - `queueIntent`       which part of the `Needs a decision` panel to
 *                         unfold: the Scenes modal's link sets it; the
 *                         workspace opens the panel, the queue unfolds, and
 *                         clears it.
 *
 * The third cell, `drawerIntent` (the sidebar's ghost `×`), went with the
 * sidebar in the fourth pass (2026-09-20).
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
