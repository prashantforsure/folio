'use client'

import type { MentionEntity, SheetSpec } from '@folio/script'
import { createContext, useContext } from 'react'

import type { BlockLayout, SheetLayout } from '../../../../../../../lib/script/layout'

/**
 * What every block on the sheet needs to draw itself, handed down once.
 *
 * `sheet` is the geometry the engine resolved; `labelFor` is the mention
 * label book, because a mention stores no label; `blocks` is where a block
 * reads its own row of the layout - margins and gaps (`lib/script/layout.ts`).
 * Nothing here is a colour.
 *
 * ## Why the layout is a store and not a context value
 *
 * The layout changes on every keystroke - it is computed from the value -
 * and a context value that changes re-renders every consumer, memoised or
 * not. On a feature that was three thousand blocks re-rendering per
 * character to read a margin that, for all but one of them, had not moved.
 * So the context value holds only what changes rarely, and the layout
 * sits behind `blocks`: a block subscribes to its own id and is woken only
 * when *its* row changed. The store keeps a row's object identity while
 * its numbers are equal, which is what `useSyncExternalStore` needs to
 * leave a block alone.
 */
export type SheetContextValue = {
  readonly sheet: SheetSpec
  readonly labelFor: (entity: MentionEntity, id: string) => string | undefined
  readonly blocks: BlockLayoutStore
  /** The block the caret is in, for the element chip. */
  readonly caretBlockId: string | null
}

export type BlockLayoutStore = {
  readonly subscribe: (id: string, listener: () => void) => () => void
  readonly get: (id: string) => BlockLayout | undefined
  /** Replace the layout. Notifies exactly the blocks whose row changed. */
  readonly update: (layout: SheetLayout) => void
}

const sameRow = (a: BlockLayout, b: BlockLayout): boolean =>
  a.marginTopPx === b.marginTopPx &&
  a.measured === b.measured &&
  (a.gap === null
    ? b.gap === null
    : b.gap !== null &&
      a.gap.afterLine === b.gap.afterLine &&
      a.gap.heightPx === b.gap.heightPx &&
      a.gap.more === b.gap.more &&
      a.gap.continued === b.gap.continued)

export const createBlockLayoutStore = (initial: SheetLayout): BlockLayoutStore => {
  const rows = new Map<string, BlockLayout>(initial.blocks)
  const listeners = new Map<string, Set<() => void>>()
  return {
    subscribe: (id, listener) => {
      const set = listeners.get(id) ?? new Set()
      set.add(listener)
      listeners.set(id, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(id)
      }
    },
    get: (id) => rows.get(id),
    update: (layout) => {
      const changed: string[] = []
      for (const [id, row] of layout.blocks) {
        const current = rows.get(id)
        if (current !== undefined && sameRow(current, row)) continue
        rows.set(id, row)
        changed.push(id)
      }
      for (const id of rows.keys()) {
        if (layout.blocks.has(id)) continue
        rows.delete(id)
        changed.push(id)
      }
      for (const id of changed) {
        const set = listeners.get(id)
        if (set === undefined) continue
        for (const listener of set) listener()
      }
    },
  }
}

export const SheetContext = createContext<SheetContextValue | null>(null)

export const useSheet = (): SheetContextValue => {
  const value = useContext(SheetContext)
  if (value === null) throw new Error('Folio: a sheet block rendered outside SheetContext.')
  return value
}
