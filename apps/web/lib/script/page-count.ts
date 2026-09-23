import type { Episode, Measurement, MeasurementScene, Project } from '@folio/contracts'
import { listSceneMeasurements, readDocumentByKind, readMeasurement, readScreenplayNodes } from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { MeasurementRecord, NodeId, PageMode, ScriptFormat } from '@folio/script'

import { measure, nodeDigest, readMeasureInputs } from './server'

/**
 * An episode's page count, on the server - roadmap task 2.4, the agent's
 * `get_page_count`.
 *
 * Pagination runs in the browser (`_script/script-workspace.tsx`,
 * `repaginateLocally`) and the result is stored as a measurement with the
 * digest of the node list it measured (`measurements.node_digest`). This reads
 * that record **when its digest matches the stored nodes** - the page count the
 * writer is looking at - and otherwise runs the same engine here, through the
 * same `measure()` a save uses, so a count is never read off a stale record.
 *
 * A page number lives only on a measurement (AGENTS.md, Tenancy): nothing is
 * written back from here. Every number is the engine's (ruling R4).
 *
 * ## The asian format refuses
 *
 * Its sheet width is AGENTS.md open decision 8 and the engine refuses rather
 * than guess (`packages/script/src/sheet.ts`). This refuses first, in words,
 * rather than returning a number nobody ruled on.
 */

export type ScenePages = {
  readonly sceneNodeId: NodeId
  readonly number: number
  readonly startPage: number
  readonly endPage: number
  readonly eighths: number
}

export type PageCount = {
  /** `stored`: the measurement the writer's own editor wrote, still current. `computed`: measured here, now. */
  readonly source: 'stored' | 'computed'
  readonly format: ScriptFormat
  readonly pageMode: PageMode
  readonly pages: number
  readonly scenes: number
  readonly eighths: number
  readonly perScene: readonly ScenePages[]
}

export type PageCountResult =
  | { readonly status: 'ok'; readonly count: PageCount }
  | { readonly status: 'empty'; readonly message: string }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export const ASIAN_REFUSAL =
  'Pages are not counted for the Asian format yet: its sheet width is open decision 8 in AGENTS.md, and the pagination engine refuses rather than guess.'

/** A stored measurement and its scene rows, as a count. Pure. */
export const pageCountOfStored = (measurement: Measurement, scenes: readonly MeasurementScene[]): PageCount => ({
  source: 'stored',
  format: measurement.format,
  pageMode: measurement.pageMode,
  pages: measurement.totalPages,
  scenes: measurement.totalScenes,
  eighths: measurement.totalEighths,
  perScene: scenes.map((scene) => ({
    sceneNodeId: scene.sceneNodeId,
    number: scene.number,
    startPage: scene.startPage,
    endPage: scene.endPage,
    eighths: scene.eighths,
  })),
})

/** A fresh engine record as a count. Pure. */
export const pageCountOfRecord = (record: MeasurementRecord): PageCount => ({
  source: 'computed',
  format: record.format,
  pageMode: record.pageMode,
  pages: record.totals.pages,
  scenes: record.totals.scenes,
  eighths: record.totals.eighths,
  perScene: record.scenes.map((scene) => ({
    sceneNodeId: scene.id,
    number: scene.number,
    startPage: scene.startPage,
    endPage: scene.endPage,
    eighths: scene.eighths,
  })),
})

export const readPageCount = async (scope: ProjectScope, project: Project, episode: Episode): Promise<PageCountResult> => {
  if (project.format === 'asian') return { status: 'refused', message: ASIAN_REFUSAL }
  const document = await readDocumentByKind(scope, episode.id, 'screenplay')
  if (document === null) return { status: 'empty', message: 'There is no script in this episode yet, so there are no pages to count.' }
  const [read, stored] = await Promise.all([
    readScreenplayNodes(scope, document.id),
    readMeasurement(scope, document.id, project.format, project.pageMode),
  ])
  if (!read.ok) return { status: 'error', message: `The stored script would not read (${read.error.at || 'node'}: ${read.error.reason.kind}).` }
  const nodes = read.value.map((entry) => entry.node)
  if (stored !== null && stored.nodeDigest === nodeDigest(nodes)) {
    return { status: 'ok', count: pageCountOfStored(stored, await listSceneMeasurements(scope, stored.id)) }
  }
  const measured = measure(nodes, project, episode.revisionColour, await readMeasureInputs(scope, episode))
  if (!measured.ok) return { status: 'refused', message: measured.refusal.kind === 'sheet-width-unresolved' ? ASIAN_REFUSAL : 'The pages could not be counted.' }
  return { status: 'ok', count: pageCountOfRecord(measured.record) }
}
