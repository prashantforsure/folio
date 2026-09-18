import type {
  EpisodeSlug,
  FindingVerdict,
  Placement,
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
import type { CharacterId, DocumentId, LocationId, NodeId, ScriptFormat } from '@folio/script'
import { documentId as brandDocumentId, locationId as brandLocationId } from '@folio/script'
import { and, asc, eq, sql } from 'drizzle-orm'

import {
  documents,
  episodes,
  measurementScenes,
  measurements,
  nodes,
  sceneDerivations,
  scenes,
  storyThreads,
  timelineFindings,
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
 * writes that could leave a dangling id are handled here: deleting a thread
 * removes its id from every scene, drops the row and closes the gap in
 * `position`, in one CTE (the rebuild, 2026-09-18 - it was two statements,
 * and a failure between them left a thread with no scenes); writing a
 * scene's threads refuses a list with an id that is not one of the
 * project's, in the same statement, so an id from another project is never
 * stored; and `listTimelineScenes` hands back the text as stored, and the
 * route drops what it cannot resolve, the `key_lines` rule.
 *
 * ## One statement per write, and why it matters less here than in Script
 *
 * Over the transaction pooler a statement is two round trips
 * (`../client.ts`). None of these writes is on a keystroke path - each is
 * a click - so the discipline is kept without the heroics the Script save
 * needed: a scene's threads are one `UPDATE`, placing many scenes is one
 * `UPDATE ... FROM unnest(...)`, the thread order is the same shape, and
 * creating a thread takes its position from a subquery rather than a
 * prior read.
 *
 * ## The verdicts are the one table this route owns beside threads
 *
 * `timeline_findings` (`0023`): a row per finding the writer marked
 * deliberate, keyed on the check's own key. Insert-or-ignore to mark,
 * delete to reopen, one read per load; the check itself never touches it.
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
 * Delete a thread: the id leaves every scene's `threads`, the row goes,
 * and the remaining threads close the gap in `position`, in one statement
 * - a CTE, so the three either all land or none does, and no failure
 * between them can leave a thread with no scenes, scenes pointing at
 * nothing, or a row order with a hole. Returns whether a row was there to
 * delete.
 */
export const deleteStoryThread = async (scope: ProjectScope, threadId: StoryThreadId): Promise<boolean> => {
  const id = threadId as string
  const result = await dbOf(scope).execute(sql`
    with unlinked as (
      update ${scenes}
        set threads = array_remove(${scenes.threads}, ${id}), updated_at = now()
      where ${scoped(scope, scenes, sql`${scenes.threads} @> ARRAY[${id}]::text[]`)}
      returning ${scenes.sceneNodeId}
    ),
    gone as (
      delete from ${storyThreads}
      where ${scoped(scope, storyThreads, eq(storyThreads.id, threadId))}
      returning ${storyThreads.id}
    ),
    ranked as (
      select ${storyThreads.id} as id, row_number() over (order by ${storyThreads.position}, ${storyThreads.createdAt}, ${storyThreads.id}) - 1 as rank
      from ${storyThreads}
      where ${scoped(scope, storyThreads, sql`${storyThreads.id} <> ${id}::uuid`)}
    ),
    closed as (
      update ${storyThreads} set position = ranked.rank
      from ranked
      where ${storyThreads.id} = ranked.id and ${storyThreads.position} <> ranked.rank
      returning ${storyThreads.id}
    )
    select (select count(*)::int from gone) as deleted
  `)
  const row = result[0] as { readonly deleted: number } | undefined
  return (row?.deleted ?? 0) > 0
}

/**
 * The row order, whole: every thread of the project takes the position of
 * its index in `ids`, in one statement. A list that names a thread the
 * project does not have, or misses one it has, writes nothing - the
 * sidebar's drag hands the whole list, so a mismatch is a stale list.
 * Returns whether the order was written.
 */
export const orderStoryThreads = async (scope: ProjectScope, ids: readonly StoryThreadId[]): Promise<boolean> => {
  const list = ids.map((id) => id as string)
  const result = await dbOf(scope).execute(sql`
    with wanted as (
      select id, ordinality - 1 as rank from unnest(${sql.param(list)}::uuid[]) with ordinality as w(id, ordinality)
    ),
    mine as (
      select ${storyThreads.id} as id from ${storyThreads} where ${scoped(scope, storyThreads)}
    ),
    agreed as (
      select (select count(*) from wanted) = (select count(*) from mine)
         and not exists (select 1 from wanted where id not in (select id from mine)) as ok
    ),
    written as (
      update ${storyThreads} set position = wanted.rank, updated_at = now()
      from wanted, agreed
      where ${storyThreads.id} = wanted.id and agreed.ok and ${scoped(scope, storyThreads)}
      returning ${storyThreads.id}
    )
    select (select ok from agreed) as ok
  `)
  const row = result[0] as { readonly ok: boolean } | undefined
  return row?.ok === true
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
  /** The screenplay document the heading sits in - what a read of the scene's own lines starts from. */
  readonly documentId: DocumentId
  readonly episode: EpisodeSlug
  readonly episodeOrdinal: number
  /** Rank within the episode, 1-based. */
  readonly number: number
  readonly heading: string
  readonly synopsis: string | null
  readonly page: number | null
  /** Length in eighths on the same measurement, or null when unmeasured. */
  readonly eighths: number | null
  /** The set the heading resolved to, or null while unresolved (`scene_derivations.location_id`). */
  readonly locationId: LocationId | null
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
      documentId: documents.id,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      cast: sceneDerivations.cast,
      locationId: sceneDerivations.locationId,
      episode: episodes.slug,
      episodeOrdinal: episodes.ordinal,
      synopsis: scenes.synopsis,
      storyDay: scenes.storyDay,
      storyClock: scenes.storyClock,
      flashback: scenes.flashback,
      threads: scenes.threads,
      page: measurementScenes.startPage,
      eighths: measurementScenes.eighths,
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
      documentId: brandDocumentId(row.documentId),
      episode: brandEpisodeSlug(row.episode),
      episodeOrdinal: row.episodeOrdinal,
      number: rank,
      heading: row.heading,
      synopsis: row.synopsis ?? null,
      page: row.page ?? null,
      eighths: row.eighths ?? null,
      locationId: row.locationId === null ? null : brandLocationId(row.locationId),
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
 * Place many scenes at once - the proposal queue's `Accept all`, and the
 * empty card's `Place N scenes`. One statement over `unnest`: each scene
 * takes its proposed day and clock only where it still has no day, so a
 * scene the writer placed by hand while the queue was open is left as
 * theirs. The flashback flag is untouched. Returns the placements that
 * landed, for `unplaceScenes`.
 */
export const placeScenes = async (scope: ProjectScope, placements: readonly Placement[]): Promise<readonly Placement[]> => {
  if (placements.length === 0) return []
  const ids = placements.map((entry) => entry.sceneNodeId as string)
  const days = placements.map((entry) => entry.time.day)
  const clocks = placements.map((entry) => entry.time.clock)
  const result = await dbOf(scope).execute(sql`
    with wanted as (
      select * from unnest(${sql.param(ids)}::uuid[], ${sql.param(days)}::int[], ${sql.param(clocks)}::text[]) as w(id, day, clock)
    )
    update ${scenes} set story_day = wanted.day, story_clock = wanted.clock, updated_at = now()
    from wanted
    where ${scenes.sceneNodeId} = wanted.id and ${scenes.storyDay} is null and ${scoped(scope, scenes)}
    returning ${scenes.sceneNodeId} as id, ${scenes.storyDay} as day, ${scenes.storyClock} as clock
  `)
  return result.flatMap((row) => {
    const { id, day, clock } = row
    return typeof id === 'string' && typeof day === 'number' && (clock === null || typeof clock === 'string') ? [{ sceneNodeId: id as NodeId, time: { day, clock } }] : []
  })
}

/**
 * The undo of a bulk placement: clear the story time off exactly the
 * scenes it placed, and only where each still carries exactly that day
 * and clock - a scene the writer retimed in the meantime is theirs and is
 * left alone. One statement. Returns how many went back to unplaced.
 */
export const unplaceScenes = async (scope: ProjectScope, placements: readonly Placement[]): Promise<number> => {
  if (placements.length === 0) return 0
  const ids = placements.map((entry) => entry.sceneNodeId as string)
  const days = placements.map((entry) => entry.time.day)
  const clocks = placements.map((entry) => entry.time.clock)
  const result = await dbOf(scope).execute(sql`
    with placed as (
      select * from unnest(${sql.param(ids)}::uuid[], ${sql.param(days)}::int[], ${sql.param(clocks)}::text[]) as w(id, day, clock)
    )
    update ${scenes} set story_day = null, story_clock = null, updated_at = now()
    from placed
    where ${scenes.sceneNodeId} = placed.id and ${scenes.storyDay} = placed.day and ${scenes.storyClock} is not distinct from placed.clock and ${scoped(scope, scenes)}
    returning ${scenes.sceneNodeId}
  `)
  return result.length
}

/**
 * A scene's threads, whole, in the writer's order - the first is its row.
 * One statement, and it refuses a list naming a thread the project does
 * not have (the count of the project's threads among `threadIds` must be
 * the list's length), so an id from elsewhere is never stored. Returns
 * whether the scene was there and the list was clean.
 */
export const writeSceneThreads = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  threadIds: readonly StoryThreadId[],
): Promise<boolean> => {
  const list = [...new Set(threadIds.map((id) => id as string))]
  const known = dbOf(scope)
    .select({ count: sql<number>`count(*)::int` })
    .from(storyThreads)
    .where(scoped(scope, storyThreads, sql`${storyThreads.id} = any(${sql.param(list)}::uuid[])`))
  const rows = await dbOf(scope)
    .update(scenes)
    .set({ threads: list, updatedAt: new Date() })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId), sql`(${known}) = ${list.length}`))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** Every finding the writer marked deliberate, by the check's key. */
export const listFindingVerdicts = async (scope: ProjectScope): Promise<ReadonlySet<string>> => {
  const rows = await dbOf(scope).select({ key: timelineFindings.key }).from(timelineFindings).where(scoped(scope, timelineFindings))
  return new Set(rows.map((row) => row.key))
}

/** `It's deliberate`: one row, insert-or-ignore on the key. */
export const markFindingDeliberate = async (scope: ProjectScope, verdict: FindingVerdict): Promise<void> => {
  await dbOf(scope)
    .insert(timelineFindings)
    .values({
      ...tenant(scope),
      kind: verdict.kind,
      key: verdict.key,
      aRef: verdict.aRef,
      bRef: verdict.bRef,
      subject: verdict.subject,
    })
    .onConflictDoNothing()
}

/** `Reopen`: the row goes. Returns whether one was there. */
export const reopenFinding = async (scope: ProjectScope, key: string): Promise<boolean> => {
  const rows = await dbOf(scope)
    .delete(timelineFindings)
    .where(scoped(scope, timelineFindings, eq(timelineFindings.key, key)))
    .returning({ id: timelineFindings.id })
  return rows.length > 0
}
