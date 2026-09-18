import type { EpisodeSlug, ProjectId, SceneRef } from '@folio/contracts'
import type { LocationId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'
import { createCell } from '../workspace/open-cell'

/**
 * What the Locations workspace knows that the assistant panel wants: which
 * record is open, the two findings the panel's report chips answer without
 * a model (`Used only once`, `Night exteriors`), and the scene index a
 * `Scene N` in a chat answer can be turned into a link with.
 *
 * The `lib/characters/facts.ts` shape, for the same reason: the panel is
 * the shell's and the workspace is the page's, so the page publishes into
 * one cell after every render of its rows and clears it on unmount, and
 * the panel reads it. Nothing here is sent to a model - AGENTS.md, The AI
 * agent: "A report never calls a model"; what the model *is* shown on this
 * route is `lib/assistant/context.ts`'s, read server-side from the same
 * loader.
 */

export type FactsPlace = {
  readonly id: LocationId
  readonly name: string
  readonly scenes: number
  readonly first: SceneRef | null
}

export type LocationFacts = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
  /** Every present scene as a ref - the join for a `Scene N` chip. */
  readonly index: readonly SceneRef[]
  /** The drawer's record, when one is open. */
  readonly open: { readonly id: LocationId; readonly name: string } | null
  /** Places the script visits once. */
  readonly oneOffs: readonly FactsPlace[]
  /** Places with night exteriors, most first, with the count. */
  readonly nightExteriors: readonly (FactsPlace & { readonly nights: number })[]
}

const cell = createCell<LocationFacts | null>(null)

export const publishLocationFacts = cell.set

/** The published cell, or `null` when no Locations workspace is mounted. */
export const useLocationFacts = cell.use
