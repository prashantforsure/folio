import { useSyncExternalStore } from 'react'

/**
 * A one-bit cell a route's chrome and its page both reach: whether the
 * route's `New <record>` drawer is open. Three doors open it - the
 * sidebar's `+`, the toolbar's `＋ New`, the grid's dashed card - and the
 * sidebar is the layout's while the grid is the page's, so the flag lives
 * in one cell both can reach rather than in either tree. Component state
 * by nature (a drawer that survived a route change would open on the
 * wrong route); `lib/state/README.md`'s rule that a URL-worthy value is a
 * param does not apply - a half-filled form is not an address.
 *
 * One factory, one cell per record route: `lib/locations/compose.ts` is
 * `createOpenCell()`, and `lib/characters/compose.ts` is the same shape
 * written out before this existed.
 */
export type OpenCell = {
  readonly set: (open: boolean) => void
  readonly use: () => boolean
}

export const createOpenCell = (): OpenCell => {
  type Listener = () => void
  let current = false
  const listeners = new Set<Listener>()

  const set = (open: boolean): void => {
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
  const use = (): boolean => useSyncExternalStore(subscribe, read, readServer)
  return { set, use }
}
