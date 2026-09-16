import type { HeadingLevel } from '@folio/script'
import { useSyncExternalStore } from 'react'

/**
 * "In this outline" - the sidebar's list on the Outline route
 * (`docs/ui design/Route - Outline v2.dc.html`): the title, then every
 * heading in document order with its level, the row the caret is under
 * lit. The copy under the eyebrow when there is nothing to list: "Headings
 * appear here as you write them. Nothing to list yet."
 *
 * ## Why a cell, and why here
 *
 * The sidebar is the writing layout's (`_chrome/sidebar.tsx`, a Server
 * Component) and the editor is the page's, two subtrees that share no
 * ancestor below the layout. The list must be live - a heading typed on the
 * page appears in the sidebar as it is typed - so the page publishes it
 * into this one cell and the sidebar's group reads it. The same mechanism
 * the editor uses to reach its own chrome (`editor-store.ts`'s slices),
 * one level up. Nothing is persisted and nothing survives a navigation:
 * the workspace clears the cell when it unmounts, and the server render of
 * the next Outline visit seeds the sidebar from the document again
 * (`loadOutlineToc`).
 *
 * Not in `lib/state/`: the README there lists what a *person* set - a
 * theme, a panel - and this is what the document contains.
 */

export type TocRow = {
  /** The block's node id; `title` for the title row. */
  readonly id: string
  readonly text: string
  /** `title` for the title row, else the heading's level. */
  readonly level: 'title' | HeadingLevel
}

export type OutlineToc = {
  readonly rows: readonly TocRow[]
  /** The row the caret is under: the last heading at or above the caret block, else the title. */
  readonly activeId: string | null
  /** Scroll the editor to a row and put the caret there. */
  readonly onPick: (id: string) => void
}

export const TITLE_ROW_ID = 'title'

/** The mono chip beside a row: `title`, `H1`, `H2`, `H3`. */
export const tocLevelLabel = (level: TocRow['level']): string => (level === 'title' ? 'title' : `H${String(level)}`)

type Listener = () => void

let current: OutlineToc | null = null
const listeners = new Set<Listener>()

export const publishOutlineToc = (toc: OutlineToc | null): void => {
  if (toc === current) return
  current = toc
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): OutlineToc | null => current
const readServer = (): OutlineToc | null => null

/** The published list, or `null` when no Outline workspace is mounted. */
export const useOutlineToc = (): OutlineToc | null => useSyncExternalStore(subscribe, read, readServer)

/**
 * The lit row for a caret: the nearest heading at or above the caret block
 * in `ids` order, else the title. Pure, so the workspace and its tests
 * agree on it.
 */
export const activeTocRow = (rows: readonly TocRow[], ids: readonly string[], caretBlockId: string | null): string | null => {
  if (rows.length === 0) return null
  if (caretBlockId === null) return rows[0]?.id ?? null
  const caretIndex = ids.indexOf(caretBlockId)
  if (caretIndex === -1) return rows[0]?.id ?? null
  let active: string | null = rows[0]?.id ?? null
  for (const row of rows) {
    if (row.level === 'title') continue
    const at = ids.indexOf(row.id)
    if (at === -1) continue
    if (at > caretIndex) break
    active = row.id
  }
  return active
}
