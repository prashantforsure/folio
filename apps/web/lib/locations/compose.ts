import { useSyncExternalStore } from 'react'

import { createOpenCell } from '../workspace/open-cell'

/**
 * Whether the `New location` drawer is open - the sidebar's `+`, the
 * toolbar's `＋ New` and the grid's dashed tile all open the one drawer the
 * layout mounts. `lib/workspace/open-cell.ts` says why it is a cell.
 */
const cell = createOpenCell()

export const setNewLocationOpen = cell.set
export const useNewLocationOpen = cell.use

/**
 * The queue's intent: a sidebar row under `Needs a decision`, the widget's
 * count and the Scenes modal's unresolved line all mean "show me the
 * queue, unfolded". The queue reads the cell once on mount and clears it.
 */
export type QueueIntent = 'rows' | null

type Listener = () => void
let intent: QueueIntent = null
const listeners = new Set<Listener>()

export const setQueueIntent = (next: QueueIntent): void => {
  if (next === intent) return
  intent = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useQueueIntent = (): QueueIntent => useSyncExternalStore(subscribe, () => intent, () => null)
