import { useSyncExternalStore } from 'react'

import type { EpisodeStats, SceneCoverage } from './view'

/**
 * The `Scenes from script` group and the `Episode frames` widget - what
 * the sidebar draws on the Production route (`docs/ui design/Route -
 * Production v2.dc.html`): one row per scene with its progress bar and
 * meta, the selected scene lit, and the frame count pinned under it.
 *
 * The same shape as `lib/storyboard/coverage.ts`, for the same reason: the
 * sidebar is the layout's and the reels are the page's, so the page
 * publishes into this one cell after every write and on every selection,
 * and the sidebar reads it. The server seeds the first paint from the same
 * `loadProduction` read the page makes (`cache()`d, so one read), and the
 * workspace clears the cell when it unmounts.
 */

export type ProductionCoverageCell = {
  readonly rows: readonly SceneCoverage[]
  readonly stats: EpisodeStats
  /** The selected scene's heading node id. Component state, never the URL (open decision 10). */
  readonly selectedId: string | null
  /** Select a scene: the strip lights its tab and the reels below are its. */
  readonly onPick: (sceneNodeId: string) => void
}

type Listener = () => void

let current: ProductionCoverageCell | null = null
const listeners = new Set<Listener>()

export const publishProductionCoverage = (cell: ProductionCoverageCell | null): void => {
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

const read = (): ProductionCoverageCell | null => current
const readServer = (): ProductionCoverageCell | null => null

/** The published cell, or `null` when no Production workspace is mounted. */
export const useProductionCoverage = (): ProductionCoverageCell | null => useSyncExternalStore(subscribe, read, readServer)
