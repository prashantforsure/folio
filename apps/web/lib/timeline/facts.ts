import type { EpisodeSlug, ProjectId, SceneRef } from '@folio/contracts'
import type { NodeId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'
import { createCell } from '../workspace/open-cell'

/**
 * What the Timeline workspace knows that the assistant panel wants: which
 * scene the drawer holds, the three reports the panel's chips answer
 * without a model - the unplaced scenes, why the open scene is flagged,
 * where a thread goes quiet - and the scene index a `E2 Sc 9` in a chat
 * answer can be turned into a link with. The `lib/locations/facts.ts`
 * shape, for the same reason: the panel is the shell's and the workspace
 * is the page's, so the page publishes into one cell after every render
 * and clears it on unmount. Nothing here is sent to a model - AGENTS.md,
 * The AI agent: "A report never calls a model"; what the model *is* shown
 * on this route is `lib/assistant/context.ts`'s, read server-side.
 */

export type FactsFinding = {
  readonly key: string
  readonly ref: SceneRef
  readonly note: string
}

export type TimelineFacts = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }[]
  /** Every present scene as a ref - the join for a `E2 Sc 9` chip. */
  readonly index: readonly SceneRef[]
  /** The drawer's scene, when one is open. */
  readonly open: { readonly id: NodeId; readonly ref: SceneRef; readonly findings: readonly FactsFinding[] } | null
  /** The scenes with no story time, in page order. */
  readonly unplaced: readonly SceneRef[]
  /** The `thread-silent` findings, each with the thread's name in its note. */
  readonly quiet: readonly (FactsFinding & { readonly thread: string })[]
}

const cell = createCell<TimelineFacts | null>(null)

export const publishTimelineFacts = cell.set

/** The published cell, or `null` when no Timeline workspace is mounted. */
export const useTimelineFacts = cell.use
