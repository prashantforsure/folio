import type { EpisodeSlug, LocationRow, ProjectId, SceneRef } from '@folio/contracts'
import type { LocationId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'

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

// ---------------------------------------------------------------------------
// The predicates - roadmap task 2.4
// ---------------------------------------------------------------------------

/**
 * The panel's two reports as functions of the rows; the workspace publishes
 * them and `readLocationFacts` (`lib/locations/server.ts`) answers the agent
 * with the same ones (AGENTS.md ruling R4).
 */
/** What the two predicates read of a row. */
export type FactsRow = Pick<LocationRow, 'id' | 'name' | 'kind' | 'parentId' | 'firstSeen' | 'rollup' | 'rollupQuadrant'>

export const oneOffsOf = (rows: readonly FactsRow[]): readonly FactsPlace[] =>
  rows.filter((row) => row.kind === 'one-off').map((row) => ({ id: row.id, name: row.name, scenes: row.rollup.scenes, first: row.firstSeen }))

/** Primary sets with at least one night exterior, most first. */
export const nightExteriorsOf = (rows: readonly FactsRow[]): readonly (FactsPlace & { readonly nights: number })[] =>
  rows
    .filter((row) => row.parentId === null && row.rollupQuadrant.extNight > 0)
    .sort((a, b) => b.rollupQuadrant.extNight - a.rollupQuadrant.extNight)
    .map((row) => ({ id: row.id, name: row.name, scenes: row.rollup.scenes, first: row.firstSeen, nights: row.rollupQuadrant.extNight }))
