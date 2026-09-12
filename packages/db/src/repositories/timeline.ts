import type {
  EpisodeSlug,
  StoryThread,
  StoryThreadEdit,
  StoryThreadId,
  StoryTimeEdit,
} from '@folio/contracts'
import {
  episodeSlug as brandEpisodeSlug,
  projectId as brandProjectId,
  storyThreadId as brandStoryThreadId,
} from '@folio/contracts'
import type { CharacterId, NodeId, ScriptFormat } from '@folio/script'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import {
  documents,
  episodes,
  measurementScenes,
  measurements,
  nodes,
  sceneDerivations,
  scenes,
  storyThreads,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The Timeline route's reads, and every authored write it makes.
 *
 * ## Two authored things, two tables
 *
 * A thread is a `story_threads` row (AUTHORED, `schema/timeline.ts`). Story
 * time and the thread links are columns on `scenes` (AUTHORED,
 * `schema/derived.ts`): `story_day`, `story_clock`, `flashback`, and
 * `threads` - thread ids as text, in the writer's order. Both sit on the
 * authored side of the split, so a re-derive cannot touch them: the
 * derivation writer holds a handle that reaches only the derived tables.
 * Nothing here writes a derived table, and nothing here reads a node's
 * content.
 *
 * ## The link is on the scene, and stale ids are dropped on read
 *
 * There is no foreign key from `scenes.threads` to `story_threads`, so the
 * two writes that could leave a dangling id are handled here: deleting a
 * thread removes its id from every scene in one `array_remove` statement
 * before the row goes, and `listTimelineScenes` keeps only ids the caller
 * can resolve - it hands back the text, and the route drops what it cannot
 * find, the `key_lines` rule.
 *
 * ## One statement per write, and why it matters less here than in Script
 *
 * Over the transaction pooler a statement is two round trips
 * (`../client.ts`). None of these writes is on a keystroke path - each is
 * a click on the panel - so the discipline is kept without the heroics the
 * Script save needed: link and unlink are one `UPDATE` each, placing many
 * scenes is one `UPDATE ... WHERE = ANY`, and creating a thread takes its
 * position from a subquery rather than a prior read.
 */

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

type ThreadRow = typeof storyThreads.$inferSelect

const toThread = (row: ThreadRow): StoryThread => ({
  id: brandStoryThreadId(row.id),
  projectId: brandProjectId(row.projectId),
  name: row.name,
  colour: row.colour,
  position: row.position,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** Every thread, in row order. */
export const listStoryThreads = async (scope: ProjectScope): Promise<readonly StoryThread[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(storyThreads)
    .where(scoped(scope, storyThreads))
    .orderBy(asc(storyThreads.position), asc(storyThreads.createdAt), asc(storyThreads.id))
  return rows.map(toThread)
}

/**
 * Create a thread at the end of the list. The position is
 * `max(position) + 1` over the project's threads, taken in the insert
 * itself so there is no read before the write and no race between two
 * writers to leave a gap.
 */
export const createStoryThread = async (
  scope: ProjectScope,
  edit: StoryThreadEdit,
): Promise<StoryThreadId> => {
  const next = dbOf(scope)
    .select({ value: sql<number>`coalesce(max(${storyThreads.position}) + 1, 0)` })
    .from(storyThreads)
    .where(scoped(scope, storyThreads))
  const rows = await dbOf(scope)
    .insert(storyThreads)
    .values({
      ...tenant(scope),
      name: edit.name,
      colour: edit.colour,
      position: sql`(${next})`,
    })
    .returning({ id: storyThreads.id })
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: inserting a story thread returned no row.')
  return brandStoryThreadId(row.id)
}

/** Rename or recolour. Returns whether a row was there to write. */
export const updateStoryThread = async (
  scope: ProjectScope,
  threadId: StoryThreadId,
  edit: StoryThreadEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(storyThreads)
    .set({ name: edit.name, colour: edit.colour, updatedAt: new Date() })
    .where(scoped(scope, storyThreads, eq(storyThreads.id, threadId)))
    .returning({ id: storyThreads.id })
  return rows.length > 0
}

/**
 * Delete a thread. Two statements, in this order: the id leaves every
 * scene's `threads` first, then the row goes - so a failure between the
 * two leaves a thread with no scenes, which the route can show, rather
 * than scenes pointing at nothing, which it would have to hide.
 */
export const deleteStoryThread = async (scope: ProjectScope, threadId: StoryThreadId): Promise<boolean> => {
  await dbOf(scope)
    .update(scenes)
    .set({ threads: sql`array_remove(${scenes.threads}, ${threadId as string})`, updatedAt: new Date() })
    .where(scoped(scope, scenes, sql`${scenes.threads} @> ARRAY[${threadId as string}]::text[]`))
  const rows = await dbOf(scope)
    .delete(storyThreads)
    .where(scoped(scope, storyThreads, eq(storyThreads.id, threadId)))
    .returning({ id: storyThreads.id })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/**
 * One present scene as the timeline reads it, straight off the tables.
 * `threads` is the text column as stored; the route resolves it against
 * `listStoryThreads` and drops what it cannot find.
 */
export type TimelineSceneRecord = {
  readonly sceneNodeId: NodeId
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  /** Rank within the episode, 1-based. */
  readonly number: number
  readonly heading: string
  readonly synopsis: string | null
  readonly page: number | null
  readonly cast: readonly CharacterId[]
  readonly storyDay: number | null
  readonly storyClock: string | null
  readonly flashback: boolean
  readonly threads: readonly string[]
}

/**
 * Every present scene across the project, in page order - episode running
 * order, then scene order within it - with what the writer hung on it and
 * its start page.
 *
 * The chain is the one every cross-episode read walks: the derived row
 * hangs off the heading node, the node belongs to a document, the document
 * to an episode. The page is `measurement_scenes` on the project's own
 * measurement (`format`, `paged` - `workspace.ts`, "one measurement,
 * chosen the same way everywhere"), LEFT JOINed so an unmeasured script
 * still lists its scenes and the panel prints `—`. The authored row is LEFT
 * JOINed too, defensively: after `ensureSceneRecords` it always exists, but
 * a missing one must read as "nothing authored", not as a missing scene.
 */
export const listTimelineScenes = async (
  scope: ProjectScope,
  format: ScriptFormat,
): Promise<readonly TimelineSceneRecord[]> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      cast: sceneDerivations.cast,
      episode: episodes.slug,
      episodeOrdinal: episodes.ordinal,
      synopsis: scenes.synopsis,
      storyDay: scenes.storyDay,
      storyClock: scenes.storyClock,
      flashback: scenes.flashback,
      threads: scenes.threads,
      page: measurementScenes.startPage,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(documents, and(eq(documents.id, nodes.documentId), eq(documents.kind, 'screenplay')))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .leftJoin(scenes, eq(scenes.sceneNodeId, sceneDerivations.sceneNodeId))
    .leftJoin(
      measurements,
      and(
        eq(measurements.documentId, documents.id),
        eq(measurements.format, format),
        eq(measurements.pageMode, 'paged'),
      ),
    )
    .leftJoin(
      measurementScenes,
      and(
        eq(measurementScenes.measurementId, measurements.id),
        eq(measurementScenes.sceneNodeId, sceneDerivations.sceneNodeId),
      ),
    )
    .where(scoped(scope, sceneDerivations, eq(sceneDerivations.presence, 'present')))
    .orderBy(asc(episodes.ordinal), asc(sceneDerivations.number))

  let rank = 0
  let lastEpisode = -1
  return rows.map((row) => {
    if (row.episodeOrdinal !== lastEpisode) {
      lastEpisode = row.episodeOrdinal
      rank = 0
    }
    rank += 1
    return {
      sceneNodeId: row.sceneNodeId as NodeId,
      episode: brandEpisodeSlug(row.episode),
      episodeOrdinal: row.episodeOrdinal,
      number: rank,
      heading: row.heading,
      synopsis: row.synopsis ?? null,
      page: row.page ?? null,
      cast: row.cast as CharacterId[],
      storyDay: row.storyDay ?? null,
      storyClock: row.storyClock ?? null,
      flashback: row.flashback ?? false,
      threads: row.threads ?? [],
    }
  })
}

/**
 * Write a scene's story time - day, clock, flashback - whole. Returns
 * whether a row was there to write; `false` is a stale card or an id from
 * elsewhere, and the caller reports it rather than creating a record for a
 * scene derivation never produced. The clock-needs-a-day rule is the
 * contract's and the column check's; both refuse before this runs.
 */
export const writeStoryTime = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  edit: StoryTimeEdit,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(scenes)
    .set({
      storyDay: edit.day,
      storyClock: edit.day === null ? null : edit.clock,
      flashback: edit.flashback,
      updatedAt: new Date(),
    })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}

/**
 * Give every named scene that has no story time a day, no clock. One
 * statement. The two "Assume continuous" / "Continue from Day N" buttons
 * are this with a different day; a scene that already has a time is left
 * exactly as it is. Returns how many were placed.
 */
export const placeUnplacedScenes = async (
  scope: ProjectScope,
  sceneNodeIds: readonly NodeId[],
  day: number,
): Promise<number> => {
  if (sceneNodeIds.length === 0) return 0
  const rows = await dbOf(scope)
    .update(scenes)
    .set({ storyDay: day, updatedAt: new Date() })
    .where(
      scoped(
        scope,
        scenes,
        inArray(scenes.sceneNodeId, [...sceneNodeIds]),
        sql`${scenes.storyDay} IS NULL`,
      ),
    )
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length
}

/**
 * Add a thread to the end of a scene's list, if it is not already there.
 * One statement; a second link of the same thread is a no-op, not a
 * duplicate. Returns whether the scene row exists.
 */
export const linkSceneThread = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  threadId: StoryThreadId,
): Promise<boolean> => {
  const id = threadId as string
  const rows = await dbOf(scope)
    .update(scenes)
    .set({
      threads: sql`case when ${scenes.threads} @> ARRAY[${id}]::text[] then ${scenes.threads} else array_append(${scenes.threads}, ${id}) end`,
      updatedAt: new Date(),
    })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}

/** Remove a thread from a scene's list. One statement. Returns whether the scene row exists. */
export const unlinkSceneThread = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  threadId: StoryThreadId,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(scenes)
    .set({ threads: sql`array_remove(${scenes.threads}, ${threadId as string})`, updatedAt: new Date() })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}
