import { useSyncExternalStore } from 'react'

/**
 * A cell a route's chrome and its page both reach, outside either tree.
 *
 * Two shapes on one factory. `createOpenCell` is the one-bit case: whether
 * the route's `New <record>` drawer is open - three doors open it (the
 * sidebar's `+`, the toolbar's `＋ New`, the grid's dashed card) and the
 * sidebar is the layout's while the grid is the page's, so the flag lives
 * here rather than in either tree. `createCell<T>` is the same store over
 * any value: the facts cells (`lib/characters/facts.ts`, `lib/locations/
 * facts.ts`, `lib/timeline/facts.ts`) publish what the assistant panel's
 * report chips answer from, and the panel - the shell's - reads it. Every
 * cell is component state by nature (a drawer that survived a route change
 * would open on the wrong route; a route's facts belong to its mount);
 * `lib/state/README.md`'s rule that a URL-worthy value is a param does not
 * apply - a half-filled form is not an address.
 *
 * `readServer` answers the initial value: on the server nothing is
 * published, and a hydration must agree with that.
 */
export type Cell<T> = {
  readonly set: (value: T) => void
  readonly use: () => T
}

export const createCell = <T>(initial: T): Cell<T> => {
  type Listener = () => void
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
  const use = (): T => useSyncExternalStore(subscribe, read, readServer)
  return { set, use }
}

export type OpenCell = Cell<boolean>

export const createOpenCell = (): OpenCell => createCell(false)
