import { useSyncExternalStore } from 'react'

/**
 * Whether the `New character` drawer is open. Three doors open it - the
 * sidebar's `+`, the toolbar's `＋ New`, the grid's dashed card - and the
 * sidebar is the layout's while the grid is the page's, so the flag lives
 * in one cell both can reach rather than in either tree. Component state
 * by nature (a drawer that survived a route change would open on the
 * wrong route); `lib/state/README.md`'s rule that a URL-worthy value is a
 * param does not apply - a half-filled form is not an address.
 */

type Listener = () => void

let current = false
const listeners = new Set<Listener>()

export const setNewCharacterOpen = (open: boolean): void => {
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

export const useNewCharacterOpen = (): boolean => useSyncExternalStore(subscribe, read, readServer)
