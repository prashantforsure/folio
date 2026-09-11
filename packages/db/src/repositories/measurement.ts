import type { EpisodeId, Measurement, MeasurementId, MeasurementScene } from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { DocumentId, MeasurementRecord, NodeId, PageMode, ScriptFormat } from '@folio/script'
import { asc, eq, sql } from 'drizzle-orm'

import { measurementNodes, measurementPages, measurementScenes, measurements } from '../schema'
import { dbOf, scoped } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp } from './mapping'

/**
 * Measurement records.
 *
 * This repository writes page numbers, and it is the only one that may.
 * AGENTS.md, exception table: page number and eighths go "on a **measurement
 * record**. Never a node attribute."
 *
 * Note what is missing: there is no `setPageNumber`, no `updateNodePage`, and
 * nothing that takes a node id and a page. A measurement is written whole, by
 * `writeMeasurement`, from the output of one `paginate` call - because a page
 * number is only meaningful as part of a complete pass over a specific node
 * list at a specific format, and a function that could set one in isolation
 * would be a function that could make the sheet disagree with the export.
 */

const toMeasurement = (row: typeof measurements.$inferSelect): Measurement => ({
  id: row.id as MeasurementId,
  projectId: brandProjectId(row.projectId),
  episodeId: row.episodeId as EpisodeId,
  documentId: row.documentId as DocumentId,
  format: row.format as ScriptFormat,
  pageMode: row.pageMode as PageMode,
  liveRepaginate: row.liveRepaginate,
  sheet: row.sheet,
  totalPages: row.totalPages,
  totalLines: row.totalLines,
  totalScenes: row.totalScenes,
  totalEighths: row.totalEighths,
  nodeDigest: row.nodeDigest,
  computedAt: stamp(row.computedAt),
})

/**
 * Store one complete pagination pass.
 *
 * One statement, and it replaces rather than merges: the header is upserted
 * on `(document_id, format, page_mode)`, every page, scene and node row the
 * record names is upserted under it, and every row it does not name is
 * deleted - so the rows that exist when the statement commits are exactly
 * the record's, and at no instant are they anything else. A half-updated
 * measurement is a sheet that disagrees with itself, which is the exact
 * failure AGENTS.md's "Export must agree with on-screen pagination exactly"
 * is about; a statement is atomic without a transaction, and on the request
 * path each parameterised statement is two round trips (`client.ts`), so
 * one statement is also seven round trips fewer than the transaction this
 * replaced.
 *
 * Upsert-and-prune rather than delete-and-insert because a delete and an
 * insert in one statement share a snapshot: the old children would still be
 * in their primary keys when the new ones landed. The two halves touch
 * disjoint rows - named ones are updated, unnamed ones deleted - which is
 * what Postgres requires of data-modifying `WITH` clauses.
 *
 * `nodeDigest` is supplied by the caller rather than computed here. The
 * caller is the one holding the node list that was measured; hashing it
 * again here would mean this repository deciding what "the same node list"
 * means, which is a question the pagination engine already answers.
 */
export const writeMeasurement = async (
  scope: ProjectScope,
  target: { readonly episodeId: EpisodeId; readonly documentId: DocumentId },
  record: MeasurementRecord,
  nodeDigest: string,
): Promise<Measurement> => {
  const pages = record.pages.map((page) => ({
    ordinal: page.ordinal,
    label: page.label,
    locked: page.locked,
    colour: page.revision,
    lines_used: page.linesUsed,
    first_node_id: page.firstNode,
    artefacts: page.artefacts,
  }))
  const scenes = record.scenes.map((scene) => ({
    scene_node_id: scene.id,
    number: scene.number,
    start_page: scene.startPage,
    end_page: scene.endPage,
    lines: scene.lines,
    eighths: scene.eighths,
  }))
  const placed = record.nodes.map((node) => ({
    node_id: node.id,
    first_page: node.runs[0]?.page ?? 1,
    last_page: node.runs.at(-1)?.page ?? 1,
    lines: node.lines,
    runs: node.runs,
  }))
  const rows = await dbOf(scope).execute(sql`
    with head as (
      insert into ${measurements}
        (project_id, episode_id, document_id, format, page_mode, live_repaginate, sheet,
         total_pages, total_lines, total_scenes, total_eighths, node_digest, computed_at)
      values
        (${scope.projectId}, ${target.episodeId}, ${target.documentId},
         ${record.format}::script_format, ${record.pageMode}::page_mode, ${record.liveRepaginate},
         ${jsonb(record.sheet)}, ${record.totals.pages}, ${record.totals.lines},
         ${record.totals.scenes}, ${record.totals.eighths}, ${nodeDigest}, now())
      on conflict (document_id, format, page_mode) do update set
        episode_id = excluded.episode_id, live_repaginate = excluded.live_repaginate,
        sheet = excluded.sheet, total_pages = excluded.total_pages, total_lines = excluded.total_lines,
        total_scenes = excluded.total_scenes, total_eighths = excluded.total_eighths,
        node_digest = excluded.node_digest, computed_at = now()
      returning *
    ),
    pages as (
      insert into ${measurementPages}
        (project_id, measurement_id, ordinal, label, locked, colour, lines_used, first_node_id, artefacts)
      select ${scope.projectId}, head.id, r.ordinal, r.label, r.locked, r.colour, r.lines_used, r.first_node_id, r.artefacts
      from head, jsonb_to_recordset(${jsonb(pages)})
        as r(ordinal int, label text, locked boolean, colour revision_colour, lines_used int, first_node_id uuid, artefacts jsonb)
      on conflict (measurement_id, ordinal) do update set
        label = excluded.label, locked = excluded.locked, colour = excluded.colour,
        lines_used = excluded.lines_used, first_node_id = excluded.first_node_id, artefacts = excluded.artefacts
      returning ordinal
    ),
    stale_pages as (
      delete from ${measurementPages}
      where ${scoped(scope, measurementPages)}
        and ${measurementPages.measurementId} = (select id from head)
        and ${measurementPages.ordinal} > ${record.pages.length}
      returning ordinal
    ),
    scenes as (
      insert into ${measurementScenes}
        (project_id, measurement_id, scene_node_id, number, start_page, end_page, lines, eighths)
      select ${scope.projectId}, head.id, r.scene_node_id, r.number, r.start_page, r.end_page, r.lines, r.eighths
      from head, jsonb_to_recordset(${jsonb(scenes)})
        as r(scene_node_id uuid, number int, start_page int, end_page int, lines int, eighths int)
      on conflict (measurement_id, scene_node_id) do update set
        number = excluded.number, start_page = excluded.start_page, end_page = excluded.end_page,
        lines = excluded.lines, eighths = excluded.eighths
      returning scene_node_id
    ),
    stale_scenes as (
      delete from ${measurementScenes}
      where ${scoped(scope, measurementScenes)}
        and ${measurementScenes.measurementId} = (select id from head)
        and ${measurementScenes.sceneNodeId} <> all(${sql.param(scenes.map((scene) => scene.scene_node_id))}::uuid[])
      returning scene_node_id
    ),
    placed as (
      insert into ${measurementNodes}
        (project_id, measurement_id, node_id, first_page, last_page, lines, runs)
      select ${scope.projectId}, head.id, r.node_id, r.first_page, r.last_page, r.lines, r.runs
      from head, jsonb_to_recordset(${jsonb(placed)})
        as r(node_id uuid, first_page int, last_page int, lines int, runs jsonb)
      on conflict (measurement_id, node_id) do update set
        first_page = excluded.first_page, last_page = excluded.last_page, lines = excluded.lines, runs = excluded.runs
      returning node_id
    ),
    stale_placed as (
      delete from ${measurementNodes}
      where ${scoped(scope, measurementNodes)}
        and ${measurementNodes.measurementId} = (select id from head)
        and ${measurementNodes.nodeId} <> all(${sql.param(placed.map((node) => node.node_id))}::uuid[])
      returning node_id
    )
    select head.*,
      (select count(*)::int from pages) as pages_written,
      (select count(*)::int from scenes) as scenes_written,
      (select count(*)::int from placed) as nodes_written
    from head
  `)
  const row = rows[0] as
    | (Record<string, unknown> & {
        readonly pages_written: number
        readonly scenes_written: number
        readonly nodes_written: number
      })
    | undefined
  if (row === undefined) {
    throw new Error('Folio: writing a measurement returned no row. This is a bug in the repository.')
  }
  if (
    row.pages_written !== record.pages.length ||
    row.scenes_written !== record.scenes.length ||
    row.nodes_written !== record.nodes.length
  ) {
    throw new Error(
      'Folio: a measurement write landed fewer rows than the record has. This is a bug in the repository.',
    )
  }
  return toMeasurement(measurementRowFromRaw(row))
}

/** The header, as `execute` hands it back: snake_case, driver-typed. */
const measurementRowFromRaw = (raw: Record<string, unknown>): typeof measurements.$inferSelect => {
  const text = (key: string): string => {
    const value = raw[key]
    if (typeof value !== 'string') throw new Error(`Folio: measurement header column ${key} is not text.`)
    return value
  }
  const int = (key: string): number => {
    const value = raw[key]
    if (typeof value !== 'number') throw new Error(`Folio: measurement header column ${key} is not a number.`)
    return value
  }
  const when = (key: string): Date => {
    const value = raw[key]
    if (value instanceof Date) return value
    if (typeof value === 'string') return new Date(value)
    throw new Error(`Folio: measurement header column ${key} is not a timestamp.`)
  }
  return {
    id: text('id'),
    projectId: text('project_id'),
    episodeId: text('episode_id'),
    documentId: text('document_id'),
    format: text('format') as typeof measurements.$inferSelect.format,
    pageMode: text('page_mode') as typeof measurements.$inferSelect.pageMode,
    liveRepaginate: raw['live_repaginate'] === true,
    sheet: raw['sheet'],
    totalPages: int('total_pages'),
    totalLines: int('total_lines'),
    totalScenes: int('total_scenes'),
    totalEighths: int('total_eighths'),
    nodeDigest: text('node_digest'),
    computedAt: when('computed_at'),
  }
}

/**
 * The current measurement for a document at one format and mode.
 *
 * Returns the header only. Whether it is stale is the caller's call: compare
 * `nodeDigest` against the node list in hand. This repository does not decide,
 * because a stale measurement is still the right thing to render while a fresh
 * one is computing.
 */
export const readMeasurement = async (
  scope: ProjectScope,
  documentId: DocumentId,
  format: ScriptFormat,
  pageMode: PageMode,
): Promise<Measurement | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(measurements)
    .where(
      scoped(
        scope,
        measurements,
        eq(measurements.documentId, documentId),
        eq(measurements.format, format),
        eq(measurements.pageMode, pageMode),
      ),
    )
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toMeasurement(row)
}

/**
 * Start page and eighths per scene.
 *
 * The Scenes route and the Production breakdown read this, and it is the reason
 * the measurement record decomposes into tables at all rather than being one
 * JSON column.
 */
export const listSceneMeasurements = async (
  scope: ProjectScope,
  measurementId: MeasurementId,
): Promise<readonly MeasurementScene[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(measurementScenes)
    .where(scoped(scope, measurementScenes, eq(measurementScenes.measurementId, measurementId)))
    .orderBy(asc(measurementScenes.number))
  return rows.map((row) => ({
    projectId: brandProjectId(row.projectId),
    measurementId: row.measurementId as MeasurementId,
    sceneNodeId: row.sceneNodeId as NodeId,
    number: row.number,
    startPage: row.startPage,
    endPage: row.endPage,
    lines: row.lines,
    eighths: row.eighths,
  }))
}
