import type { CharacterId } from '@folio/script'
import { useSyncExternalStore } from 'react'

import type { RenameRestore } from './result'

/**
 * The rename's undo offer: what the last rename rewrote, held for the
 * status bar's `Undo` until it is taken, replaced by a later rename, or the
 * Characters workspace unmounts (the cell is cleared then - a rename undone
 * from another route would rewrite a script nobody is looking at). One
 * cell, the `compose.ts` shape: the toast is the page's, the offer must
 * survive the drawer closing, and nothing about it is an address.
 */
export type UndoOffer = {
  readonly characterId: CharacterId
  readonly previousName: string
  readonly name: string
  readonly cues: number
  readonly restores: readonly RenameRestore[]
}

type Listener = () => void

let current: UndoOffer | null = null
const listeners = new Set<Listener>()

export const offerUndo = (offer: UndoOffer | null): void => {
  if (offer === current) return
  current = offer
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): UndoOffer | null => current
const readServer = (): UndoOffer | null => null

export const useUndoOffer = (): UndoOffer | null => useSyncExternalStore(subscribe, read, readServer)
