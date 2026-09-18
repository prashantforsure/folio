import type { EpisodeSlug, ProjectId, SceneRef } from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import { useSyncExternalStore } from 'react'

import type { WorkspaceShape } from '../workspace/hrefs'

/**
 * What the Characters workspace knows that the assistant panel wants:
 * which record is open, the two findings the panel's report chips answer
 * without a model, and the scene index a `Scene N` in a chat answer can be
 * turned into a link with.
 *
 * The `lib/storyboard/coverage.ts` shape, for the same reason: the panel is
 * the shell's and the workspace is the page's, so the page publishes into
 * one cell after every render of its figures and clears it on unmount, and
 * the panel reads it. Nothing here is sent to a model - AGENTS.md, The AI
 * agent: "A report never calls a model" - and nothing here widens what one
 * reads; the panel prints these itself.
 */

export type FactsPerson = {
  readonly id: CharacterId
  readonly name: string
  readonly scenes: number
  readonly first: SceneRef | null
}

export type CharacterFacts = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
  /** Every present scene as a ref - the join for a `Scene N` chip. */
  readonly index: readonly SceneRef[]
  /** The drawer's record, when one is open. */
  readonly open: { readonly id: CharacterId; readonly name: string } | null
  /** The busiest pair of principals with no scene together, or null. */
  readonly neverShare: { readonly a: FactsPerson; readonly b: FactsPerson; readonly episodes: number } | null
  readonly noDescription: readonly { readonly id: CharacterId; readonly name: string }[]
}

type Listener = () => void

let current: CharacterFacts | null = null
const listeners = new Set<Listener>()

export const publishCharacterFacts = (cell: CharacterFacts | null): void => {
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

const read = (): CharacterFacts | null => current
const readServer = (): CharacterFacts | null => null

/** The published cell, or `null` when no Characters workspace is mounted. */
export const useCharacterFacts = (): CharacterFacts | null => useSyncExternalStore(subscribe, read, readServer)
