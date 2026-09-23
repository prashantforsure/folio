import type { EpisodeSlug, ProjectId, Relationship, SceneRef } from '@folio/contracts'
import type { CharacterId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'
import type { CastFigure } from './cast'

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

// ---------------------------------------------------------------------------
// The predicates - roadmap task 2.4
// ---------------------------------------------------------------------------

/**
 * The two findings the panel's report chips answer, as functions of the rows.
 * The workspace's effect publishes them for the panel; `readCharacterFacts`
 * (`lib/characters/server.ts`) answers the same question for the agent - one
 * predicate, so the chip and the tool cannot disagree (AGENTS.md ruling R4).
 */
export const noDescriptionOf = (figures: readonly Pick<CastFigure, 'id' | 'name' | 'bio'>[]): readonly FactsPerson[] =>
  figures.filter((figure) => figure.bio === null).map((figure) => ({ id: figure.id, name: figure.name }))

/** Records no authored relationship names, in the order given (cast order). */
export const unrelatedOf = (
  figures: readonly Pick<CastFigure, 'id' | 'name'>[],
  relationships: readonly Pick<Relationship, 'aId' | 'bId'>[],
): readonly FactsPerson[] => {
  const related = new Set(relationships.flatMap((row) => [row.aId, row.bId]))
  return figures.filter((figure) => !related.has(figure.id)).map((figure) => ({ id: figure.id, name: figure.name }))
}
