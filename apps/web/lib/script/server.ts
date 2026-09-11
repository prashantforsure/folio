import type {
  DocumentRecord,
  Episode,
  Project,
  Revision,
  Thread,
  TitlePage,
  Version,
} from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  commitDerivation,
  ensureSceneRecords,
  listLockedPages,
  listOpenThreads,
  listRevisions,
  listVersions,
  persistMintedRecords,
  readDerivationInput,
  readDocumentByKind,
  readMentionLabels,
  readProjectScreenplayNodes,
  readScreenplayNodes,
  readTitlePage,
  writeMeasurement,
} from '@folio/db'
import type {
  Derivation,
  DeriveError,
  LockedPage,
  MentionLabel,
  ScreenplayNode,
} from '@folio/script'
import { countDerivationIds, derive, paginate, renderableNodes } from '@folio/script'
import { createHash } from 'node:crypto'

import type { MeasureOutcome } from './result'
import type { ScriptStats } from './stats'

/**
 * The server half of the Script route: what a render reads, and the one
 * pipeline every write runs afterwards.
 *
 * ## Pagination is computed here, on every read and every write
 *
 * AGENTS.md, Pagination and the sheet: "Computed **server-side**, so client,
 * print and export agree." `paginate` is pure and a feature-length pass is
 * milliseconds, so the route does not read a stored page map back out of
 * `measurement_*` rows - it runs the engine over the node list it is about
 * to render and hands the record to the client, and on a save it runs the
 * same engine and *also* stores the record for the routes that read page
 * counts from the table. Two consumers, one function, one answer.
 *
 * ## The pipeline after a write
 *
 *   1. paginate at the project's format and mode; when the mode is
 *      `continuous`, paginate `paged` as well, because the status bar's page
 *      count is still live in minimal mode (bundle copy) and export needs it;
 *   2. store every record computed (`writeMeasurement` replaces per mode);
 *   3. derive, project-wide, against the authored rows; persist the records
 *      the pass minted and the scene rows it needs; commit the derived caches.
 *
 * A `format: asian` project refuses at step 1 - open decision 8 - and the
 * refusal is returned to the client to show, not swallowed.
 */


const wordCount = (nodes: readonly ScreenplayNode[]): number =>
  renderableNodes(nodes).reduce((total, node) => {
    const text = node.content
      .map((run) => (run.kind === 'text' ? run.text : ' '))
      .join('')
      .trim()
    return total + (text === '' ? 0 : text.split(/\s+/u).length)
  }, 0)

/** A stable hash of the list a measurement was computed from. */
export const nodeDigest = (nodes: readonly ScreenplayNode[]): string =>
  createHash('sha256').update(JSON.stringify(nodes)).digest('hex')

const lockedPagesFor = async (
  scope: ProjectScope,
  revisions: readonly Revision[],
): Promise<readonly LockedPage[]> => {
  const locked = revisions.filter((revision) => revision.locked)
  const latest = locked[locked.length - 1]
  if (latest === undefined) return []
  const pages = await listLockedPages(scope, latest.id)
  return pages.map((page) => ({ label: page.label, anchor: page.anchor, revision: page.colour }))
}

const measure = (
  nodes: readonly ScreenplayNode[],
  project: Project,
  episode: Episode,
  labels: readonly MentionLabel[],
  lockedPages: readonly LockedPage[],
): MeasureOutcome => {
  const base = {
    format: project.format,
    liveRepaginate: project.liveRepaginate,
    lockedPages,
    mentionLabels: labels,
    revision: episode.revisionColour,
  }
  const paged = paginate(nodes, { ...base, pageMode: 'paged' })
  if (!paged.ok) return { ok: false, refusal: paged.error }
  if (project.pageMode === 'paged') return { ok: true, record: paged.value, paged: paged.value }
  const continuous = paginate(nodes, { ...base, pageMode: 'continuous' })
  if (!continuous.ok) return { ok: false, refusal: continuous.error }
  return { ok: true, record: continuous.value, paged: paged.value }
}

const statsOf = (nodes: readonly ScreenplayNode[], derivation: Derivation | null): ScriptStats => {
  const entities = derivation?.entities
  const present = <T extends { readonly presence: 'present' | 'absent' }>(
    records: readonly T[] | undefined,
  ): readonly T[] => (records ?? []).filter((record) => record.presence === 'present')
  const characters = present(entities?.characters)
  return {
    scenes: present(entities?.scenes).length,
    words: wordCount(nodes),
    characters: characters.length,
    locations: present(entities?.locations).length,
    beats: 0,
    shots: 0,
    relations: characters.reduce((total, record) => total + record.authored.relationships.length, 0),
  }
}

/**
 * Derive the whole project and persist. Returns the pass, or the engine's
 * refusal, which the caller reports rather than hides.
 */
export const rederiveProject = async (
  scope: ProjectScope,
): Promise<{ readonly ok: true; readonly derivation: Derivation } | { readonly ok: false; readonly error: DeriveError | { readonly kind: 'unreadable' } }> => {
  const all = await readProjectScreenplayNodes(scope)
  if (!all.ok) return { ok: false, error: { kind: 'unreadable' } }
  const previous = await readDerivationInput(scope)
  const needed = countDerivationIds(all.value, previous)
  const freshIds = Array.from({ length: needed }, () => crypto.randomUUID())
  const pass = derive(all.value, previous, { freshIds })
  if (!pass.ok) return { ok: false, error: pass.error }
  await persistMintedRecords(scope, pass.value.minted)
  // The scene's authored row: `scene_derivations` has a foreign key to it and
  // nothing else creates it. See `@folio/db`'s `scenes.ts`.
  await ensureSceneRecords(scope, pass.value.entities.scenes)
  await commitDerivation(scope, pass.value.entities)
  return { ok: true, derivation: pass.value }
}

export type AfterWrite = {
  readonly measurement: MeasureOutcome
  /** Null when derivation was not run this time; the client keeps its last. */
  readonly stats: ScriptStats | null
  readonly labels: readonly MentionLabel[]
}

/**
 * Steps 1-3 of the pipeline, after the node rows are written.
 *
 * Measurement runs every time - the sheet is drawn from it and other routes
 * count from it. Derivation runs when `derive` is true: it is project-wide,
 * reads nine tables and rewrites six, and a keystroke autosave every 1.5s
 * does not need the Characters route's caches rebuilt each time. The client
 * asks for it on a cadence (`script-workspace.tsx`), on `⌘S`, and import
 * and creation always ask. Independent reads run in parallel: a save is a
 * round-trip budget, and on a remote database each round trip is the cost.
 */
export const measureAndDerive = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
  document: DocumentRecord,
  nodes: readonly ScreenplayNode[],
  options: { readonly derive: boolean } = { derive: true },
): Promise<AfterWrite> => {
  const derived = options.derive ? await rederiveProject(scope) : null
  const [labels, revisions] = await Promise.all([
    readMentionLabels(scope),
    listRevisions(scope, episode.id),
  ])
  const lockedPages = await lockedPagesFor(scope, revisions)
  const measurement = measure(nodes, project, episode, labels, lockedPages)
  if (measurement.ok) {
    const digest = nodeDigest(nodes)
    const target = { episodeId: episode.id, documentId: document.id }
    await writeMeasurement(scope, target, measurement.paged, digest)
    if (measurement.record !== measurement.paged) {
      await writeMeasurement(scope, target, measurement.record, digest)
    }
  }
  return {
    measurement,
    stats: derived === null ? null : statsOf(nodes, derived.ok ? derived.derivation : null),
    labels,
  }
}

// ---------------------------------------------------------------------------
// What the route reads
// ---------------------------------------------------------------------------

export type ScriptLoad =
  | { readonly state: 'empty'; readonly titlePage: TitlePage | null }
  | {
      readonly state: 'draft'
      readonly document: DocumentRecord
      readonly nodes: readonly ScreenplayNode[]
      readonly measurement: MeasureOutcome
      readonly stats: ScriptStats
      readonly labels: readonly MentionLabel[]
      readonly titlePage: TitlePage | null
      readonly threads: readonly Thread[]
      readonly revisions: readonly Revision[]
      readonly versions: readonly Version[]
    }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }

/**
 * Everything the Script route renders, in one read.
 *
 * `empty` is decided here, from whether a screenplay document exists - never
 * from a URL. Stats come from a *speculative* derivation over the current
 * rows, the same function the save runs, so the numbers in the Info panel are
 * "counted from the document, not estimated", as the bundle's copy says.
 */
export const loadScript = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
): Promise<ScriptLoad> => {
  const [document, titlePage] = await Promise.all([
    readDocumentByKind(scope, episode.id, 'screenplay'),
    readTitlePage(scope, episode.id),
  ])
  if (document === null) return { state: 'empty', titlePage }

  const read = await readScreenplayNodes(scope, document.id)
  if (!read.ok) {
    return {
      state: 'unreadable',
      document,
      detail: `${read.error.at || 'node'}: ${read.error.reason.kind}`,
    }
  }
  const nodes = read.value.map((entry) => entry.node)

  const [labels, revisions, versions, threads, all, previous] = await Promise.all([
    readMentionLabels(scope),
    listRevisions(scope, episode.id),
    listVersions(scope, document.id, 20),
    listOpenThreads(scope),
    readProjectScreenplayNodes(scope),
    readDerivationInput(scope),
  ])
  const lockedPages = await lockedPagesFor(scope, revisions)
  const measurement = measure(nodes, project, episode, labels, lockedPages)

  // Speculative: same function, ids discarded, nothing written.
  let derivation: Derivation | null = null
  if (all.ok) {
    const needed = countDerivationIds(all.value, previous)
    const pass = derive(all.value, previous, {
      freshIds: Array.from({ length: needed }, () => crypto.randomUUID()),
    })
    if (pass.ok) derivation = pass.value
  }

  const ids = new Set(nodes.map((node) => node.id as string))
  return {
    state: 'draft',
    document,
    nodes,
    measurement,
    stats: statsOf(nodes, derivation),
    labels,
    titlePage,
    threads: threads.filter(
      (thread) => thread.anchor.kind === 'script_node' && ids.has(thread.anchor.nodeId),
    ),
    revisions,
    versions,
  }
}
