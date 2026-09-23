import type { EpisodeSlug, ProjectId, SceneRef, TimelineSceneRow } from '@folio/contracts'
import type { NodeId } from '@folio/script'

import type { WorkspaceShape } from '../workspace/hrefs'
import type { FindingBuckets, NoteBook } from './view'
import { findingNote, findingsAbout } from './view'

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

// ---------------------------------------------------------------------------
// The predicates - roadmap task 2.4
// ---------------------------------------------------------------------------

/** A timeline row as a scene ref - the join for a citation chip. */
export const timelineRefOf = (scene: TimelineSceneRow): SceneRef => ({
  sceneNodeId: scene.sceneNodeId,
  episode: scene.episode,
  episodeOrdinal: scene.episodeOrdinal,
  number: scene.number,
  heading: scene.heading,
})

/**
 * The panel's reports as functions of the rows and the bucketed check; the
 * workspace publishes them and `readTimelineFacts` (`lib/timeline/server.ts`)
 * answers the agent with the same ones (AGENTS.md ruling R4).
 */
export const unplacedOf = (scenes: readonly TimelineSceneRow[]): readonly SceneRef[] =>
  scenes.filter((scene) => scene.storyTime === null).map(timelineRefOf)

/** The `thread-silent` findings the writer has not answered, each with its thread's name. */
export const quietOf = (
  buckets: FindingBuckets,
  scenes: readonly TimelineSceneRow[],
  book: NoteBook,
): readonly (FactsFinding & { readonly thread: string })[] => {
  const byId = new Map<NodeId, TimelineSceneRow>(scenes.map((scene) => [scene.sceneNodeId, scene]))
  return buckets.open
    .filter((finding) => finding.kind === 'thread-silent')
    .flatMap((finding) => {
      const scene = byId.get(finding.sceneId)
      return scene === undefined
        ? []
        : [{ key: finding.key, ref: timelineRefOf(scene), note: findingNote(finding, book), thread: (finding.subject === null ? null : book.threadName(finding.subject)) ?? 'A thread' }]
    })
}

/** The open findings about one scene, as the drawer's chip answers them. */
export const findingsForScene = (buckets: FindingBuckets, scene: TimelineSceneRow, book: NoteBook): readonly FactsFinding[] =>
  findingsAbout(buckets, scene.sceneNodeId).map((finding) => ({ key: finding.key, ref: timelineRefOf(scene), note: findingNote(finding, book) }))
