import type { EpisodeSlug, ProjectId, PropRow, SceneRef } from '@folio/contracts'
import type { PropId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'

/**
 * What the Props workspace knows that the assistant panel wants: which
 * record is open, the two findings the panel's report chips answer without
 * a model (`Which props has nobody found yet?`, `Which props does the
 * script never mention?`), and the scene index a `Scene N` in a chat
 * answer can be turned into a link with.
 *
 * The `lib/locations/facts.ts` shape, for the same reason: the panel is
 * the shell's and the workspace is the page's, so the page publishes into
 * one cell after every render of its rows and clears it on unmount, and
 * the panel reads it. Nothing here is sent to a model - AGENTS.md, The AI
 * agent: "A report never calls a model".
 */

export type FactsProp = {
  readonly id: PropId
  readonly name: string
  readonly scenes: number
  readonly first: SceneRef | null
}

export type PropFacts = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
  /** Every present scene as a ref - the join for a `Scene N` chip. */
  readonly index: readonly SceneRef[]
  /** The drawer's record, when one is open. */
  readonly open: { readonly id: PropId; readonly name: string } | null
  /** Records still at `needed`, in the route's order. */
  readonly unsourced: readonly FactsProp[]
  /**
   * Records the script writes no line about. Not a fault - a prop can be a
   * production decision nobody wrote down - but it is the one thing the
   * evidence reading can say that a count cannot.
   */
  readonly unwritten: readonly FactsProp[]
}

// ---------------------------------------------------------------------------
// The predicates - roadmap task 2.4
// ---------------------------------------------------------------------------

/**
 * The panel's two reports as functions of the rows; the workspace publishes
 * them and `readPropFacts` (`lib/props/server.ts`) answers the agent with the
 * same ones (AGENTS.md ruling R4).
 */
/** What the two predicates read of a row. */
export type FactsRow = Pick<PropRow, 'id' | 'name' | 'status' | 'scenes' | 'firstSeen' | 'lines'>

export const unsourcedOf = (rows: readonly FactsRow[]): readonly FactsProp[] =>
  rows.filter((row) => row.status === 'needed').map((row) => ({ id: row.id, name: row.name, scenes: row.scenes.length, first: row.firstSeen }))

export const unwrittenOf = (rows: readonly FactsRow[]): readonly FactsProp[] =>
  rows.filter((row) => row.lines === 0).map((row) => ({ id: row.id, name: row.name, scenes: 0, first: null }))
