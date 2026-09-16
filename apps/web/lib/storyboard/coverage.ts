import type { BoardCoverageRow } from '@folio/contracts'
import { useSyncExternalStore } from 'react'

/**
 * The `Boards` group and the `Boards drawn` widget - what the writing
 * sidebar draws on the Storyboard route (`docs/ui design/Route -
 * Storyboard v2.dc.html`): one row per scene with its status dot and shot
 * count, the selected scene lit, and the coverage widget pinned under it.
 *
 * The same shape as `lib/outline/toc.ts`, for the same reason: the sidebar
 * is the layout's and the board is the page's, so the page publishes into
 * this one cell after every write and on every selection, and the sidebar
 * reads it. The server seeds the first paint from `readBoardCoverage`
 * (one statement, in `_chrome/sidebar.tsx`), so the two agree before the
 * workspace mounts; the workspace clears the cell when it unmounts.
 */

export type BoardCoverageCell = {
  readonly rows: readonly BoardCoverageRow[]
  /** The selected scene's heading node id. Component state, never the URL (open decision 10). */
  readonly selectedId: string | null
  /** Select a scene: the board scrolls its column into view, the canvas shows it. */
  readonly onPick: (sceneNodeId: string) => void
}

type Listener = () => void

let current: BoardCoverageCell | null = null
const listeners = new Set<Listener>()

export const publishBoardCoverage = (cell: BoardCoverageCell | null): void => {
  if (cell === current) return
  current = cell
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): BoardCoverageCell | null => current
const readServer = (): BoardCoverageCell | null => null

/** The published cell, or `null` when no Storyboard workspace is mounted. */
export const useBoardCoverage = (): BoardCoverageCell | null => useSyncExternalStore(subscribe, read, readServer)
