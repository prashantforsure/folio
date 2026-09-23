import type { Episode, Project } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { listEpisodes, readDocumentByKind, readMeasurement, readMeasurementLayout, readScreenplayNodes, readTitlePage } from '@folio/db'
import type { PrintMeasure, PrintedPage, ScreenplayNode, SheetSpec } from '@folio/script'
import { printMeasureOf, printPages, printTitlePage, resolveSheet } from '@folio/script'

import { ROLE } from '../auth/roles'
import type { EpisodeGate, ProjectGate } from './actor-gate'
import { roleRefusal } from './actor-gate'
import { ASIAN_REFUSAL } from './page-count'
import type { PdfPage } from './pdf'
import { writeScriptPdf } from './pdf'
import type { ExportPdfResult } from './result'
import { measure, nodeDigest, readMeasureInputs } from './server'

/**
 * The PDF export as core functions - roadmap task 5.3. `exportScriptPdfWith`
 * is one episode (the Script route's menu, the agent's `export_script`);
 * `exportProjectPdfWith` is the project card's - every episode with a script,
 * in running order, each opening on its own cover.
 *
 * ## From the measurement record, measured again only when it is stale
 *
 * An episode's pages come from its **stored** measurement when its
 * `node_digest` matches the node list - the pages the writer's own editor
 * measured and the Script route draws - read whole with
 * `readMeasurementLayout`. When it is stale, missing, or does not print (the
 * printer refuses a record that is not a measurement of this list), the same
 * engine measures it here through the same `measure()` a save runs, with the
 * same mention names and locked pages. Nothing is written back: a page number
 * lives on a measurement record, and this is an export, a read.
 *
 * The asian format refuses, as page counting does: its sheet width is open
 * decision 8, and a PDF drawn on a sheet nobody ruled is a guess.
 */

type Section = { readonly pages: readonly PdfPage[]; readonly scriptPages: number; readonly source: 'stored' | 'computed' }

const stemOf = (title: string): string =>
  title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

const sheetFor = (project: Project): SheetSpec | null => {
  const resolved = resolveSheet(project.format)
  return resolved.ok ? resolved.value : null
}

/** One episode: its cover and its pages, or why it has none. `null` for an episode with no script. */
const sectionOf = async (scope: ProjectScope, project: Project, episode: Episode, sheet: SheetSpec): Promise<Section | string | null> => {
  const document = await readDocumentByKind(scope, episode.id, 'screenplay')
  if (document === null) return null
  const [read, stored, inputs, cover] = await Promise.all([
    readScreenplayNodes(scope, document.id),
    readMeasurement(scope, document.id, project.format, 'paged'),
    readMeasureInputs(scope, episode),
    readTitlePage(scope, episode.id),
  ])
  if (!read.ok) return `The stored script would not read (${read.error.at || 'node'}: ${read.error.reason.kind}).`
  const nodes: readonly ScreenplayNode[] = read.value.map((entry) => entry.node)

  let printed: readonly PrintedPage[] | null = null
  let source: Section['source'] = 'stored'
  if (stored !== null && stored.nodeDigest === nodeDigest(nodes)) {
    const layout = await readMeasurementLayout(scope, stored.id)
    const fromStore: PrintMeasure = { sheet, pages: layout.pages, runs: layout.runs }
    const drawn = printPages(nodes, fromStore, inputs.labels)
    if (drawn.ok) printed = drawn.value
  }
  if (printed === null) {
    source = 'computed'
    const measured = measure(nodes, project, episode.revisionColour, inputs)
    if (!measured.ok) return measured.refusal.kind === 'sheet-width-unresolved' ? ASIAN_REFUSAL : 'The script could not be measured.'
    const drawn = printPages(nodes, printMeasureOf(measured.paged), inputs.labels)
    if (!drawn.ok) return 'The script could not be laid out on the page.'
    printed = drawn.value
  }

  const title = cover?.title ?? (project.projectType === 'film' ? project.title : `${project.title}: ${episode.title}`)
  const titleLines = printTitlePage(
    {
      title,
      credit: cover?.credit ?? null,
      author: cover?.author ?? null,
      source: cover?.source ?? null,
      draftDate: cover?.draftDate ?? null,
      contact: cover?.contact ?? null,
      copyright: cover?.copyright ?? null,
      notes: cover?.notes ?? null,
    },
    sheet,
  )
  return {
    pages: [{ kind: 'title', lines: titleLines }, ...printed.map((page, index): PdfPage => ({ kind: 'script', page, numbered: index > 0 }))],
    scriptPages: printed.length,
    source,
  }
}

const written = async (sheet: SheetSpec, sections: readonly Section[], filename: string, title: string, author: string | null): Promise<ExportPdfResult> => {
  const pdf = await writeScriptPdf(sheet, sections.flatMap((section) => section.pages), { title, author })
  if (!pdf.ok) return { status: 'error', message: pdf.message }
  return {
    status: 'exported',
    filename,
    base64: toBase64(pdf.bytes),
    pages: sections.reduce((total, section) => total + section.scriptPages, 0),
    source: sections.every((section) => section.source === 'stored') ? 'stored' : 'computed',
  }
}

/** One episode's script as PDF - `exportScriptPdf`'s body, and `export_script`'s. Comments never enter it. */
export const exportScriptPdfWith = async (gate: EpisodeGate): Promise<ExportPdfResult> => {
  const refused = roleRefusal(gate, ROLE.export)
  if (refused !== null) return refused
  const { scope, project, episode } = gate
  const sheet = sheetFor(project)
  if (sheet === null) return { status: 'refused', message: ASIAN_REFUSAL }
  const section = await sectionOf(scope, project, episode, sheet)
  if (section === null) return { status: 'error', message: 'There is no script to export yet.' }
  if (typeof section === 'string') return { status: 'error', message: section }
  const stem = stemOf(episode.title)
  const author = (await readTitlePage(scope, episode.id))?.author ?? null
  return written(sheet, [section], `${stem === '' ? episode.slug : stem}.pdf`, project.projectType === 'film' ? project.title : `${project.title}: ${episode.title}`, author)
}

/** Every episode with a script, in running order, one PDF - the project card's `Export PDF`. */
export const exportProjectPdfWith = async (gate: ProjectGate): Promise<ExportPdfResult> => {
  const refused = roleRefusal(gate, ROLE.export)
  if (refused !== null) return refused
  const { scope, project } = gate
  const sheet = sheetFor(project)
  if (sheet === null) return { status: 'refused', message: ASIAN_REFUSAL }
  const episodes = [...(await listEpisodes(scope))].sort((a, b) => a.ordinal - b.ordinal)
  const sections: Section[] = []
  for (const episode of episodes) {
    const section = await sectionOf(scope, project, episode, sheet)
    if (section === null) continue
    if (typeof section === 'string') return { status: 'error', message: `${episode.title}: ${section}` }
    sections.push(section)
  }
  if (sections.length === 0) return { status: 'error', message: 'There is no script in this project to export yet.' }
  const stem = stemOf(project.title)
  return written(sheet, sections, `${stem === '' ? 'script' : stem}.pdf`, project.title, null)
}
