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
  listOpenThreads,
  listRevisions,
  listVersions,
  persistMintedRecords,
  readDerivationInput,
  readDocumentByKind,
  readLatestLockedPages,
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
  RevisionColour,
  ScreenplayNode,
} from '@folio/script'
import { countDerivationIds, derive, paginate, renderableNodes } from '@folio/script'
import { after } from 'next/server'
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
 * ## What a save waits for, and what it does not
 *
 * The request path is ~400ms from the database and pays two round trips per
 * statement (`@folio/db`'s `client.ts`), so what a save *awaits* before it
 * answers is the whole of what a writer feels between a keystroke and
 * "saved". A save awaits exactly what the answer depends on: the node write,
 * and the measurement *computed* - the sheet is drawn from it. Everything
 * whose result the answer does not carry runs **after the response**
 * (`after()` from `next/server`, which Server Functions support):
 *
 *   1. storing the measurement - `writeMeasurement`, one statement per mode,
 *      for the routes that count pages from the table;
 *   2. derivation, when the client asked for it - project-wide, nine tables
 *      read and six rewritten, on a cadence (`script-workspace.tsx`), on
 *      `⌘S`, and always on import and creation.
 *
 * Both are caches of a computation the response already carried, both are
 * replaced whole on the next save, and both are digest-tagged or
 * reproducible - so a process dying between the response and the store
 * costs a stale cache for one save, never a lost keystroke. The stats the
 * Info panel shows come from a *speculative* pass over the same reads,
 * ids discarded, exactly as `loadScript` computes them.
 *
 * ## Deferred work is serialised, per key
 *
 * Two saves a second apart both defer a measurement store for the same
 * document; two `⌘S` presses defer two derivations for the same project. A
 * derivation that read the previous entities before the last one committed
 * would re-mint the records it was about to persist - the exact bug
 * `persistMintedRecords`' header records. So `later()` runs deferred jobs
 * one at a time per key, and a job queued while another waits **replaces**
 * it: the store that runs is always for the newest save. This is a lock in
 * one process, which is what one Next server is. A second instance would
 * not share it, and that is recorded here rather than solved.
 *
 * A `format: asian` project refuses at measurement - open decision 8 - and
 * the refusal is returned to the client to show, not swallowed.
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

/** What the engine needs beside the nodes, read once per request. */
export type MeasureInputs = {
  readonly labels: readonly MentionLabel[]
  readonly lockedPages: readonly LockedPage[]
}

export const readMeasureInputs = async (
  scope: ProjectScope,
  episode: Episode,
): Promise<MeasureInputs> => {
  const [labels, lockedPages] = await Promise.all([
    readMentionLabels(scope),
    readLatestLockedPages(scope, episode.id),
  ])
  return { labels, lockedPages }
}

export const measure = (
  nodes: readonly ScreenplayNode[],
  project: Project,
  revision: RevisionColour,
  inputs: MeasureInputs,
): MeasureOutcome => {
  const base = {
    format: project.format,
    liveRepaginate: project.liveRepaginate,
    lockedPages: inputs.lockedPages,
    mentionLabels: inputs.labels,
    revision,
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

// ---------------------------------------------------------------------------
// Deferred work, one job at a time per key
// ---------------------------------------------------------------------------

type Pending = { job: () => Promise<void> }

const running = new Map<string, Promise<void>>()
const waiting = new Map<string, Pending>()

/**
 * Run `job` after the current one for `key` finishes. A job queued while
 * one is already waiting replaces it - only the newest matters.
 */
const later = (key: string, job: () => Promise<void>): Promise<void> => {
  const pending = waiting.get(key)
  if (pending !== undefined) {
    pending.job = job
    return running.get(key) ?? Promise.resolve()
  }
  const slot: Pending = { job }
  waiting.set(key, slot)
  const previous = running.get(key) ?? Promise.resolve()
  const next = previous.then(async () => {
    waiting.delete(key)
    try {
      await slot.job()
    } catch (cause) {
      console.error({
        event: 'folio.script.deferred_failed',
        key,
        message: cause instanceof Error ? cause.message : String(cause),
        note: 'A cache write after the response failed. The next save rewrites it.',
      })
    }
  })
  running.set(key, next)
  void next.then(() => {
    if (running.get(key) === next) running.delete(key)
  })
  return next
}

/** Store both records the measurement produced. One statement each, in parallel. */
const storeMeasurement = async (
  scope: ProjectScope,
  episode: Episode,
  document: DocumentRecord,
  measurement: MeasureOutcome,
  nodes: readonly ScreenplayNode[],
): Promise<void> => {
  if (!measurement.ok) return
  const digest = nodeDigest(nodes)
  const target = { episodeId: episode.id, documentId: document.id }
  await Promise.all([
    writeMeasurement(scope, target, measurement.paged, digest),
    measurement.record === measurement.paged
      ? Promise.resolve()
      : writeMeasurement(scope, target, measurement.record, digest),
  ])
}

/**
 * Derive the whole project and persist. Returns the pass, or the engine's
 * refusal, which the caller reports rather than hides.
 */
export const rederiveProject = async (
  scope: ProjectScope,
): Promise<{ readonly ok: true; readonly derivation: Derivation } | { readonly ok: false; readonly error: DeriveError | { readonly kind: 'unreadable' } }> => {
  const [all, previous] = await Promise.all([readProjectScreenplayNodes(scope), readDerivationInput(scope)])
  if (!all.ok) return { ok: false, error: { kind: 'unreadable' } }
  const needed = countDerivationIds(all.value, previous)
  const freshIds = Array.from({ length: needed }, () => crypto.randomUUID())
  const pass = derive(all.value, previous, { freshIds })
  if (!pass.ok) return { ok: false, error: pass.error }
  // The scene's authored row: `scene_derivations` has a foreign key to it and
  // nothing else creates it. See `@folio/db`'s `scenes.ts`. Minted records
  // and scene rows are independent tables, so they land together.
  await Promise.all([
    persistMintedRecords(scope, pass.value.minted),
    ensureSceneRecords(scope, pass.value.entities.scenes),
  ])
  await commitDerivation(scope, pass.value.entities)
  return { ok: true, derivation: pass.value }
}

/** The two reads a derivation pass takes. Issued beside a save's other reads. */
export type DerivationReads = Awaited<ReturnType<typeof readDerivationReads>>

export const readDerivationReads = async (scope: ProjectScope) => {
  const [all, previous] = await Promise.all([readProjectScreenplayNodes(scope), readDerivationInput(scope)])
  return { all, previous }
}

/**
 * A derivation pass over the rows as read, nothing written. What
 * `loadScript` and a save both count the Info panel's figures from.
 *
 * A save counts over the list it is writing, which the project-wide read -
 * issued beside the write - has not seen. The read is ordered by episode
 * then document order and a document's nodes are contiguous in it, so the
 * document's stored run is cut out by id and the new list put in its
 * place. A document with no stored rows yet is appended; that shifts
 * nothing but the speculative scene numbers of a later episode.
 */
export const deriveSpeculatively = (
  reads: DerivationReads,
  replacing?: { readonly storedIds: ReadonlySet<string>; readonly nodes: readonly ScreenplayNode[] },
): Derivation | null => {
  if (!reads.all.ok) return null
  let nodes = reads.all.value
  if (replacing !== undefined) {
    const { storedIds } = replacing
    const first = nodes.findIndex((node) => storedIds.has(node.id as string))
    const kept = nodes.filter((node) => !storedIds.has(node.id as string))
    const at = first < 0 ? kept.length : first
    nodes = [...kept.slice(0, at), ...replacing.nodes, ...kept.slice(at)]
  }
  const needed = countDerivationIds(nodes, reads.previous)
  const pass = derive(nodes, reads.previous, {
    freshIds: Array.from({ length: needed }, () => crypto.randomUUID()),
  })
  return pass.ok ? pass.value : null
}

export type AfterWrite = {
  readonly measurement: MeasureOutcome
  /** Null when derivation was not run this time; the client keeps its last. */
  readonly stats: ScriptStats | null
  readonly labels: readonly MentionLabel[]
}

/**
 * The pipeline after the node rows are written, **awaited whole**: the
 * measurement stored and, when asked, the project re-derived, before this
 * returns. For the paths that revalidate afterwards - creation, import,
 * restore - where the next render reads the tables this writes.
 *
 * The Script route's autosave does not call this; see `deferAfterSave`.
 */
export const measureAndDerive = async (
  scope: ProjectScope,
  project: Project,
  episode: Episode,
  document: DocumentRecord,
  nodes: readonly ScreenplayNode[],
  options: { readonly derive: boolean } = { derive: true },
): Promise<AfterWrite> => {
  const [inputs, derived] = await Promise.all([
    readMeasureInputs(scope, episode),
    options.derive ? rederiveProject(scope) : Promise.resolve(null),
  ])
  const measurement = measure(nodes, project, episode.revisionColour, inputs)
  await storeMeasurement(scope, episode, document, measurement, nodes)
  return {
    measurement,
    stats: derived === null ? null : statsOf(nodes, derived.ok ? derived.derivation : null),
    labels: inputs.labels,
  }
}

/**
 * The same pipeline, after the response. Queued per document (the store)
 * and per project (the derivation), newest wins - see the header.
 */
export const deferAfterSave = (
  scope: ProjectScope,
  episode: Episode,
  document: DocumentRecord,
  measurement: MeasureOutcome,
  nodes: readonly ScreenplayNode[],
  options: { readonly derive: boolean },
): void => {
  after(async () => {
    await Promise.all([
      later(`measurement:${document.id}`, () => storeMeasurement(scope, episode, document, measurement, nodes)),
      options.derive
        ? later(`derive:${scope.projectId}`, async () => {
            const result = await rederiveProject(scope)
            if (!result.ok) {
              console.error({
                event: 'folio.script.derive_refused',
                projectId: scope.projectId,
                error: result.error,
              })
            }
          })
        : Promise.resolve(),
    ])
  })
}

export const statsFor = (nodes: readonly ScreenplayNode[], derivation: Derivation | null): ScriptStats =>
  statsOf(nodes, derivation)

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
      /** What the client needs to run the engine itself and get the server's answer. */
      readonly lockedPages: readonly LockedPage[]
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

  const [read, inputs, revisions, versions, threads, reads] = await Promise.all([
    readScreenplayNodes(scope, document.id),
    readMeasureInputs(scope, episode),
    listRevisions(scope, episode.id),
    listVersions(scope, document.id, 20),
    listOpenThreads(scope),
    readDerivationReads(scope),
  ])
  if (!read.ok) {
    return {
      state: 'unreadable',
      document,
      detail: `${read.error.at || 'node'}: ${read.error.reason.kind}`,
    }
  }
  const nodes = read.value.map((entry) => entry.node)
  const measurement = measure(nodes, project, episode.revisionColour, inputs)

  const ids = new Set(nodes.map((node) => node.id as string))
  return {
    state: 'draft',
    document,
    nodes,
    measurement,
    stats: statsOf(nodes, deriveSpeculatively(reads)),
    labels: inputs.labels,
    lockedPages: inputs.lockedPages,
    titlePage,
    threads: threads.filter(
      (thread) => thread.anchor.kind === 'script_node' && ids.has(thread.anchor.nodeId),
    ),
    revisions,
    versions,
  }
}
