import type { BeatAuthoredRow, BeatTiming, EpisodeId } from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { NodeId, ScriptFormat } from '@folio/script'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import {
  beats,
  documents,
  measurementScenes,
  measurements,
  nodes,
  sceneDerivations,
  scenes,
} from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The beat's authored row, and the scene links a beat names.
 *
 * A beat is an outline `beat` block (`@folio/script`, `beats.ts`). Nothing
 * here creates, orders or deletes one - that is a document write and it
 * goes through `documents.ts` like every other node write. What is here is
 * what hangs *off* the block by its node id: the `beats` row (duration,
 * timeline position, canvas spot - `schema/beats.ts`) and the links on
 * `scenes.beats`.
 *
 * ## The row is written whole, and it is written on first touch
 *
 * There is no `ensureBeatRecords`. A scene's row has to exist before
 * derivation writes the derived row that points at it; a beat's row points
 * at nothing and nothing points at it, so it is created by the first write
 * that has something to say (`writeBeatTiming` is an upsert) and a beat
 * that has never been timed or placed simply has no row. Reads LEFT JOIN
 * and the route prints `UNSET_BEAT_TIMING`. No write on a read path.
 *
 * ## Links live on the scene, are written one statement at a time
 *
 * `scenes.beats` is an array of beat node ids. Linking appends if absent,
 * unlinking removes; both are one `UPDATE` with the tenant predicate, and
 * both return whether a scene row was there to write - a stale card or an
 * id from another project is reported, never silently created. The read
 * side is one query over the episode's present scenes with their arrays,
 * and the inversion (beat -> scenes) is done in memory: the array is small
 * and a `= ANY` per beat would be a statement per beat.
 */

type BeatRow = typeof beats.$inferSelect

const toBeatAuthored = (row: BeatRow): BeatAuthoredRow => ({
  beatNodeId: row.beatNodeId as NodeId,
  projectId: brandProjectId(row.projectId),
  durationMinutes: row.durationMinutes,
  placedAtMinute: row.placedAtMinute,
  canvas: row.canvasX === null || row.canvasY === null ? null : { x: row.canvasX, y: row.canvasY },
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** The authored rows for these beat blocks, keyed by node id. Missing means untimed. */
export const readBeatRows = async (
  scope: ProjectScope,
  beatNodeIds: readonly NodeId[],
): Promise<ReadonlyMap<NodeId, BeatAuthoredRow>> => {
  if (beatNodeIds.length === 0) return new Map()
  const rows = await dbOf(scope)
    .select()
    .from(beats)
    .where(scoped(scope, beats, inArray(beats.beatNodeId, [...beatNodeIds])))
  return new Map(rows.map((row) => [row.beatNodeId as NodeId, toBeatAuthored(row)]))
}

/**
 * Set a beat's timing. Whole: the caller sends every field, because the
 * row is small and "which of three nullable fields did you mean" is a
 * partial-update protocol nobody needs. One statement, insert or update.
 *
 * The caller has already checked that `beatNodeId` is a beat block of an
 * outline in this project - this table has no foreign key to say so.
 */
export const writeBeatTiming = async (
  scope: ProjectScope,
  beatNodeId: NodeId,
  timing: BeatTiming,
): Promise<BeatAuthoredRow> => {
  const values = {
    ...tenant(scope),
    beatNodeId: beatNodeId as string,
    durationMinutes: timing.durationMinutes,
    placedAtMinute: timing.placedAtMinute,
    canvasX: timing.canvas?.x ?? null,
    canvasY: timing.canvas?.y ?? null,
  }
  const rows = await dbOf(scope)
    .insert(beats)
    .values(values)
    .onConflictDoUpdate({
      target: beats.beatNodeId,
      set: {
        durationMinutes: values.durationMinutes,
        placedAtMinute: values.placedAtMinute,
        canvasX: values.canvasX,
        canvasY: values.canvasY,
        updatedAt: new Date(),
      },
      // A conflict on the primary key from another project is a bug, not a
      // merge: the tenant predicate on the update keeps it from becoming one.
      setWhere: scoped(scope, beats),
    })
    .returning()
  const row = rows[0]
  if (row === undefined) {
    throw new Error('Folio: writing a beat row returned no row. The id belongs to another project.')
  }
  return toBeatAuthored(row)
}

// ---------------------------------------------------------------------------
// Scene links
// ---------------------------------------------------------------------------

/** One present scene of the episode with the beats it delivers. */
export type SceneLinkRow = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly heading: string
  /** From the measurement at the project's format in `paged` mode; null when unmeasured. */
  readonly page: number | null
  readonly beats: readonly NodeId[]
}

const PAGE_MODE_FOR_LINKS = 'paged' as const

/**
 * The episode's present scenes, in script order, each with its `scenes.beats`.
 *
 * The same chain `workspace.ts` walks - derived row, heading node, document,
 * episode - with a LEFT JOIN to the authored row for the links and to the
 * paged measurement for the page, so an unmeasured script still lists its
 * scenes with `page: null`.
 */
export const listSceneLinks = async (
  scope: ProjectScope,
  episodeId: EpisodeId,
  format: ScriptFormat,
): Promise<readonly SceneLinkRow[]> => {
  const rows = await dbOf(scope)
    .select({
      sceneNodeId: sceneDerivations.sceneNodeId,
      number: sceneDerivations.number,
      heading: sceneDerivations.heading,
      beats: scenes.beats,
      page: measurementScenes.startPage,
    })
    .from(sceneDerivations)
    .innerJoin(nodes, eq(nodes.id, sceneDerivations.sceneNodeId))
    .innerJoin(
      documents,
      and(
        eq(documents.id, nodes.documentId),
        eq(documents.episodeId, episodeId),
        eq(documents.kind, 'screenplay'),
      ),
    )
    .leftJoin(scenes, eq(scenes.sceneNodeId, sceneDerivations.sceneNodeId))
    .leftJoin(
      measurements,
      and(
        eq(measurements.documentId, documents.id),
        eq(measurements.format, format),
        eq(measurements.pageMode, PAGE_MODE_FOR_LINKS),
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
    .orderBy(asc(sceneDerivations.number))

  return rows.map((row) => ({
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    heading: row.heading,
    page: row.page,
    beats: (row.beats ?? []).map((id) => id as NodeId),
  }))
}

/** Name a scene as delivering a beat. Idempotent. `false` when the scene has no row here. */
export const linkBeatScene = async (
  scope: ProjectScope,
  beatNodeId: NodeId,
  sceneNodeId: NodeId,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(scenes)
    .set({
      beats: sql`case when ${sql.param(beatNodeId as string)} = any(${scenes.beats}) then ${scenes.beats} else array_append(${scenes.beats}, ${sql.param(beatNodeId as string)}) end`,
      updatedAt: new Date(),
    })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}

/** Take a beat off a scene. Idempotent. `false` when the scene has no row here. */
export const unlinkBeatScene = async (
  scope: ProjectScope,
  beatNodeId: NodeId,
  sceneNodeId: NodeId,
): Promise<boolean> => {
  const rows = await dbOf(scope)
    .update(scenes)
    .set({
      beats: sql`array_remove(${scenes.beats}, ${sql.param(beatNodeId as string)})`,
      updatedAt: new Date(),
    })
    .where(scoped(scope, scenes, eq(scenes.sceneNodeId, sceneNodeId)))
    .returning({ sceneNodeId: scenes.sceneNodeId })
  return rows.length > 0
}
