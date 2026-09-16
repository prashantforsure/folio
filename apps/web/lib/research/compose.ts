import type { ResearchCollectionId, ResearchSourceId } from '@folio/contracts'
import { useSyncExternalStore } from 'react'

/**
 * Two cells the Research route's layout and page share.
 *
 * The sidebar card is the layout's and the views are the page's, two trees
 * with no channel between them (`lib/characters/compose.ts` for the same
 * problem). Both are component state by nature and neither is worth a link
 * (`lib/state/README.md`): a half-filled drawer would open on the wrong
 * route if it survived one, and which folder the library is narrowed to is
 * a way of looking, as the Storyboard's `All shots ▾` was ruled to be.
 *
 *   drawer      `null`, or which source the `Edit source` drawer edits -
 *               `'new'` for `＋ Add source`, with the origin prefilled when
 *               the empty card's `Paste a link` opened it.
 *   collection  the sidebar's selected row: `'all'` is `Everything`.
 */

type Listener = () => void

const cell = <T>(initial: T) => {
  let current = initial
  const listeners = new Set<Listener>()
  const set = (value: T): void => {
    if (Object.is(value, current)) return
    current = value
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const use = (): T => useSyncExternalStore(subscribe, () => current, () => initial)
  return { set, use }
}

export type DrawerTarget = null | { readonly kind: 'new'; readonly origin?: string } | { readonly kind: 'edit'; readonly id: ResearchSourceId }

const drawer = cell<DrawerTarget>(null)

export const setResearchDrawer = drawer.set
export const useResearchDrawer = drawer.use

export type CollectionFilter = 'all' | ResearchCollectionId

const collection = cell<CollectionFilter>('all')

export const setCollectionFilter = collection.set
export const useCollectionFilter = collection.use
