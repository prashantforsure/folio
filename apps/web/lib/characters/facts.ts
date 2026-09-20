import type { EpisodeSlug, ProjectId, SceneRef } from '@folio/contracts'
import type { CharacterId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'
import { createCell } from '../workspace/open-cell'

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
 *
 * The fourth pass (2026-09-20) replaced the never-share pair (the Presence
 * grid's finding, gone with the grid) with `unrelated` - the records no
 * authored relationship names, which is what the graph shows as a lone
 * tile.
 */

export type FactsPerson = { readonly id: CharacterId; readonly name: string }

export type CharacterFacts = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
  /** Every present scene as a ref - the join for a `Scene N` chip. */
  readonly index: readonly SceneRef[]
  /** The drawer's record, when one is open. */
  readonly open: FactsPerson | null
  readonly noDescription: readonly FactsPerson[]
  /** Records no authored relationship names, cast order. */
  readonly unrelated: readonly FactsPerson[]
}

const cell = createCell<CharacterFacts | null>(null)

export const publishCharacterFacts = cell.set

/** The published cell, or `null` when no Characters workspace is mounted. */
export const useCharacterFacts = cell.use
