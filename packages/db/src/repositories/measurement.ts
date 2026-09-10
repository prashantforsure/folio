import type { EpisodeId, Measurement, MeasurementId, MeasurementScene } from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import type { DocumentId, MeasurementRecord, NodeId, PageMode, ScriptFormat } from '@folio/script'
import { asc, eq } from 'drizzle-orm'

import { measurementNodes, measurementPages, measurementScenes, measurements } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
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
 * The whole write is one transaction, and it replaces rather than merges: a
 * half-updated measurement is a sheet that disagrees with itself, which is the
 * exact failure AGENTS.md's "Export must agree with on-screen pagination
 * exactly" is about.
 *
 * `nodeDigest` is supplied by the caller rather than computed here. The caller
 * is the one holding the node list that was measured; hashing it again here
 * would mean this repository deciding what "the same node list" means, which is
 * a question the pagination engine already answers.
 */
export const writeMeasurement = async (
  scope: ProjectScope,
  target: { readonly episodeId: EpisodeId; readonly documentId: DocumentId },
  record: MeasurementRecord,
  nodeDigest: string,
): Promise<Measurement> => {
  return dbOf(scope).transaction(async (tx) => {
    await tx
      .delete(measurements)
      .where(
        scoped(
          scope,
          measurements,
          eq(measurements.documentId, target.documentId),
          eq(measurements.format, record.format),
          eq(measurements.pageMode, record.pageMode),
        ),
      )
    const inserted = await tx
      .insert(measurements)
      .values({
        ...tenant(scope),
        episodeId: target.episodeId,
        documentId: target.documentId,
        format: record.format,
        pageMode: record.pageMode,
        liveRepaginate: record.liveRepaginate,
        sheet: record.sheet,
        totalPages: record.totals.pages,
        totalLines: record.totals.lines,
        totalScenes: record.totals.scenes,
        totalEighths: record.totals.eighths,
        nodeDigest,
      })
      .returning()
    const header = inserted[0]
    if (header === undefined) {
      throw new Error('Folio: inserting a measurement returned no row. This is a bug in the repository.')
    }

    if (record.pages.length > 0) {
      await tx.insert(measurementPages).values(
        record.pages.map((page) => ({
          ...tenant(scope),
          measurementId: header.id,
          ordinal: page.ordinal,
          label: page.label,
          locked: page.locked,
          colour: page.revision,
          linesUsed: page.linesUsed,
          firstNodeId: page.firstNode,
          artefacts: page.artefacts,
        })),
      )
    }

    if (record.scenes.length > 0) {
      await tx.insert(measurementScenes).values(
        record.scenes.map((scene) => ({
          ...tenant(scope),
          measurementId: header.id,
          sceneNodeId: scene.id,
          number: scene.number,
          startPage: scene.startPage,
          endPage: scene.endPage,
          lines: scene.lines,
          eighths: scene.eighths,
        })),
      )
    }

    if (record.nodes.length > 0) {
      await tx.insert(measurementNodes).values(
        record.nodes.map((node) => ({
          ...tenant(scope),
          measurementId: header.id,
          nodeId: node.id,
          firstPage: node.runs[0]?.page ?? 1,
          lastPage: node.runs.at(-1)?.page ?? 1,
          lines: node.lines,
          runs: node.runs,
        })),
      )
    }

    return toMeasurement(header)
  })
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
