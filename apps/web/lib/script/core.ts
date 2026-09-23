import type { ThreadId } from '@folio/contracts'
import { NodeIdSchema, ScreenplayNodeSchema, ScriptFormatSchema, ThreadIdSchema, ThreadNodeKindSchema, TitlePageInputSchema } from '@folio/contracts'
import {
  commitNodePlan,
  listComments,
  listMemberProfiles,
  openThread,
  parseScreenplayRows,
  planNodeWrite,
  readDocumentById,
  readDocumentByKind,
  readLatestLockedPages,
  readMentionLabels,
  readNodeRows,
  readScreenplayNodes,
  readTombstones,
  replyToThread,
  reviveNodeIds,
  setProjectFormat,
  setProjectPagination,
  setThreadState,
  snapshotVersion,
  writeTitlePage,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'
import type { DocumentId, NodeId, ScreenplayNode } from '@folio/script'
import { serialiseFinalDraft, serialiseFountain } from '@folio/script'
import { z } from 'zod'

import { ROLE } from '../auth/roles'
import { isPaginationControl, paginationFromControl } from '../state/project-preferences'
import type { EpisodeGate } from './actor-gate'
import { roleRefusal } from './actor-gate'
import { digestOf } from './digest'
import { writeFdx } from './fdx-adapter'
import type { ThreadNodeKind, ThreadView } from './panel'
import { initialsOf, whenLabel } from './panel'
import type { ExportFountainResult, ExportScriptResult, SaveScriptResult, SimpleResult, ThreadResult, TitlePageResult } from './result'
import { cachedRows, rememberRows, rowsAfterWrite } from './row-cache'
import type { Schedule } from './server'
import { deferAfterSave, deriveSpeculatively, measure, nodeDigest, readDerivationReads, statsFor } from './server'

/**
 * The Script route's writes as **core functions** - roadmap task 4.2.
 *
 * Each takes an episode gate already opened and the raw input its action
 * takes, checks the role itself, and does everything the action did after its
 * gate - the agent's tools and the worker call these with a gate of their own
 * (`lib/script/actor-gate.ts`). Nothing here reads a cookie or reaches Next:
 * the one thing a save runs after its answer is handed a `schedule` - Next's
 * `after` from the action, the worker's own runner from a job.
 *
 * `actions.ts`'s header is the route's account of what a save is
 * (last-write-wins with a banner, ids checked not trusted, snapshots).
 */

const RetirementSchema = z.object({
  nodeId: z.string().min(1),
  mergedInto: z.string().min(1).nullable(),
})

export const SaveScriptInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  documentId: z.string().uuid(),
  baseUpdatedAt: z.string(),
  /** Every node that is new or changed since the client's last save, whole. */
  upserts: z.array(ScreenplayNodeSchema),
  /**
   * The full id list in document order - or null when no node was added,
   * removed or moved since the last save, in which case the stored order
   * stands and `upserts` may name only stored ids.
   */
  order: z.array(z.string().min(1)).nullable(),
  retirements: z.array(RetirementSchema),
  snapshot: z.boolean(),
  derive: z.boolean(),
  /** `digestOf([record, paged])` of the record the client drew for this list, if it computed one. */
  recordDigest: z.string().nullable(),
  /**
   * The `nodeDigest` of the stored list this save was planned against, for a
   * caller that wants a compare-and-swap rather than last-write-wins.
   *
   * Absent - which is every save the editor makes - and behaviour is exactly
   * what it was: the write lands and a `conflict` rides back on the result.
   * Present and disagreeing with the stored list, and **nothing is written**.
   * ADR 0003 **D10**: an agent's operations planned against a document that
   * has since changed describe a document that no longer exists, so the
   * proposal goes stale and is re-planned rather than force-applied.
   */
  expectedDigest: z.string().min(1).optional(),
})

export type SaveScriptInput = z.input<typeof SaveScriptInputSchema>

type ParsedSave = z.infer<typeof SaveScriptInputSchema>

/** This process's cached rows for a document, if it wrote them last (`row-cache.ts`). */
type CachedRows = ReturnType<typeof cachedRows>

const invalid = (message: string): SaveScriptResult => ({
  status: 'invalid',
  message: `The script did not read as a node list (${message}).`,
})

/** The shape check a save runs before anything else - before the gate, in the action. */
export const parseSaveInput = (raw: unknown): { readonly ok: true; readonly input: ParsedSave } | { readonly ok: false; readonly result: SaveScriptResult } => {
  const parsed = SaveScriptInputSchema.safeParse(raw)
  if (parsed.success) return { ok: true, input: parsed.data }
  const issue = parsed.error.issues[0]
  return { ok: false, result: invalid(issue === undefined ? 'shape' : `${issue.path.join('.')}: ${issue.message}`) }
}

/** What a save reads besides the gate: the document, its rows (unless cached), the mention labels, the derivation reads. */
export type SaveReads = {
  readonly document: Awaited<ReturnType<typeof readDocumentById>>
  readonly freshRows: Awaited<ReturnType<typeof readNodeRows>> | null
  readonly labels: Awaited<ReturnType<typeof readMentionLabels>>
  readonly reads: Awaited<ReturnType<typeof readDerivationReads>> | null
}

/**
 * The reads, as one function of the scope - the action runs it **beside** the
 * cookie gate (`openEpisodeWith`'s `alongside`), in the same round trip; a
 * core called without them runs it after its own gate.
 */
export const saveReadsFor =
  (input: Pick<ParsedSave, 'documentId' | 'derive'>, cached: CachedRows) =>
  async (scope: ProjectScope): Promise<SaveReads> => {
    const documentId = input.documentId as DocumentId
    const [document, freshRows, labels, reads] = await Promise.all([
      readDocumentById(scope, documentId),
      cached === undefined ? readNodeRows(scope, documentId) : Promise.resolve(null),
      readMentionLabels(scope),
      input.derive ? readDerivationReads(scope) : Promise.resolve(null),
    ])
    return { document, freshRows, labels, reads }
  }

/**
 * Save the script - the delta over the stored list, checked as a list, one
 * write, the measurement computed in memory, the rest after the answer
 * (`actions.ts`'s `saveScript` says why). `options.reads` are the reads the
 * action ran beside its gate, with the cache entry it read them against;
 * absent, the core reads for itself. `options.schedule` runs the deferred half.
 */
export const saveScriptWith = async (
  gate: EpisodeGate,
  raw: unknown,
  options: { readonly schedule: Schedule; readonly prepared?: { readonly reads: SaveReads; readonly cached: CachedRows } },
): Promise<SaveScriptResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const parsed = parseSaveInput(raw)
  if (!parsed.ok) return parsed.result
  const input = parsed.input
  const documentId = input.documentId as DocumentId
  const { scope, project, episode } = gate

  const cached = options.prepared === undefined ? cachedRows(documentId) : options.prepared.cached
  const { document, freshRows, labels, reads } = options.prepared?.reads ?? (await saveReadsFor(input, cached)(scope))

  if (document === null || document.episodeId !== episode.id || document.kind !== 'screenplay') {
    return { status: 'refused', message: 'That script no longer exists. Reload to continue.' }
  }
  const rows =
    freshRows ??
    (cached !== undefined && cached.updatedAt === document.updatedAt
      ? cached.rows
      : await readNodeRows(scope, documentId))
  const stored = parseScreenplayRows(rows)
  if (!stored.ok) {
    return { status: 'refused', message: 'The stored script would not read. Reload to continue.' }
  }

  // The delta over the stored list, checked as a list.
  const held = new Map(stored.value.map((entry) => [entry.node.id as string, entry.node]))
  const upserts = new Map(input.upserts.map((node) => [node.id as string, node as ScreenplayNode]))
  let next: ScreenplayNode[]
  if (input.order === null) {
    for (const id of upserts.keys()) {
      if (!held.has(id)) return invalid(`node ${id} is new but no order was sent`)
    }
    next = stored.value.map((entry) => upserts.get(entry.node.id as string) ?? entry.node)
  } else {
    const seen = new Set<string>()
    next = []
    for (const id of input.order) {
      if (seen.has(id)) return invalid(`node ${id} appears twice in the order`)
      seen.add(id)
      const node = upserts.get(id) ?? held.get(id)
      if (node === undefined) return invalid(`node ${id} is in the order but was neither stored nor sent`)
      next.push(node)
    }
    for (const id of upserts.keys()) {
      if (!seen.has(id)) return invalid(`node ${id} was sent but is not in the order`)
    }
  }

  const conflict =
    document.updatedAt === input.baseUpdatedAt
      ? null
      : { expected: input.baseUpdatedAt, found: document.updatedAt }

  // The compare-and-swap, before the plan is built and long before it is
  // written. `baseUpdatedAt` above is a *report* - the write lands either way,
  // which is last-write-wins with a banner and is right for two people typing.
  // This is a *condition*, and it is what a caller that cannot see the
  // document needs instead.
  if (input.expectedDigest !== undefined && nodeDigest(stored.value.map((entry) => entry.node)) !== input.expectedDigest) {
    return { status: 'stale', conflict: conflict ?? { expected: input.baseUpdatedAt, found: document.updatedAt } }
  }

  // Every id that leaves the list gets its tombstone in the same statement
  // as its delete. What it was merged into is the client's to say - it saw
  // the merge - and an id the client did not mention is retired as deleted.
  const plan = planNodeWrite(rows, next)
  const mergedInto = new Map(input.retirements.map((entry) => [entry.nodeId, entry.mergedInto]))
  const tombstones = plan.deletes.map((nodeId) => {
    const survivor = mergedInto.get(nodeId as string) ?? null
    return { nodeId, mergedInto: survivor === null ? null : (survivor as NodeId) }
  })

  const [firstWrite, lockedPages, snapshot] = await Promise.all([
    commitNodePlan(scope, document.id, 'screenplay', plan, tombstones),
    readLatestLockedPages(scope, episode.id),
    input.snapshot
      ? snapshotVersion(scope, document.id, 'autosave', next, next.length).then(() => true)
      : Promise.resolve(false),
  ])

  // A save that reintroduces a tombstoned id - undo after a delete, chiefly -
  // is not reuse (ADR 0001; `reviveNodeIds`'s header is the argument): it is
  // the same node taking its own id back. Lift the tombstone and retry once
  // before refusing the write; an id still unusable after that is a real
  // conflict (it collides with a live node, not a retired one).
  let written = firstWrite
  if ('unusable' in written) {
    const revivable = (await readTombstones(scope, written.unusable)).map((t) => t.nodeId)
    if (revivable.length > 0) {
      await reviveNodeIds(scope, revivable)
      written = await commitNodePlan(scope, document.id, 'screenplay', plan, tombstones)
    }
  }
  if ('unusable' in written) return { status: 'ids-unusable', ids: written.unusable }
  rememberRows(documentId, written.updatedAt, rowsAfterWrite(rows, next, plan, 'screenplay'))

  const measurement = measure(next, project, episode.revisionColour, { labels, lockedPages })
  const digest = measurement.ok ? digestOf([measurement.record, measurement.paged]) : null
  const stats =
    reads === null
      ? null
      : statsFor(next, deriveSpeculatively(reads, { storedIds: new Set(held.keys()), nodes: next }))

  deferAfterSave(scope, episode, document, measurement, next, { derive: input.derive, schedule: options.schedule })

  return {
    status: 'saved',
    updatedAt: written.updatedAt,
    conflict,
    measurement: digest !== null && digest === input.recordDigest ? null : measurement,
    stats,
    labels,
    snapshotTaken: snapshot,
  }
}

// ---------------------------------------------------------------------------
// Project preferences the Info panel writes
// ---------------------------------------------------------------------------

export const paginationProblem = (control: unknown): SimpleResult | null =>
  typeof control === 'string' && isPaginationControl(control) ? null : { status: 'error', message: 'Unknown pagination control.' }

export const setPaginationWith = async (gate: EpisodeGate, control: unknown): Promise<SimpleResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  if (typeof control !== 'string' || !isPaginationControl(control)) return { status: 'error', message: 'Unknown pagination control.' }
  await setProjectPagination(gate.scope, paginationFromControl(control))
  return { status: 'done' }
}

export const formatProblem = (format: unknown): SimpleResult | null =>
  ScriptFormatSchema.safeParse(format).success ? null : { status: 'error', message: 'Unknown format.' }

export const setFormatWith = async (gate: EpisodeGate, format: unknown): Promise<SimpleResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const parsed = ScriptFormatSchema.safeParse(format)
  if (!parsed.success) return { status: 'error', message: 'Unknown format.' }
  await setProjectFormat(gate.scope, parsed.data)
  return { status: 'done' }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const stemOf = (title: string): string =>
  title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')

/** The script as `.fdx` text - `exportScriptFdx`'s body. Comments never enter it. */
export const exportScriptFdxWith = async (gate: EpisodeGate): Promise<ExportScriptResult> => {
  const refused = roleRefusal(gate, ROLE.export)
  if (refused !== null) return refused
  const { scope, episode: current } = gate
  const document = await readDocumentByKind(scope, current.id, 'screenplay')
  if (document === null) return { status: 'error', message: 'There is no script to export yet.' }
  const [read, labels] = await Promise.all([readScreenplayNodes(scope, document.id), readMentionLabels(scope)])
  if (!read.ok) {
    return { status: 'error', message: `The stored script would not read (${read.error.at || 'node'}: ${read.error.reason.kind}).` }
  }
  const exported = serialiseFinalDraft(
    read.value.map((entry) => entry.node),
    { mentionLabels: labels },
  )
  const count = (reason: 'subtitle-as-general' | 'unresolved-mention' | 'empty-block'): number =>
    exported.unrepresentable.filter((entry) => entry.reason === reason).length
  const stem = stemOf(current.title)
  return {
    status: 'exported',
    filename: `${stem === '' ? current.slug : stem}.fdx`,
    xml: writeFdx(exported.root),
    omitted: exported.omitted.length,
    subtitlesAsGeneral: count('subtitle-as-general'),
    unresolvedMentions: count('unresolved-mention'),
    emptyBlocks: count('empty-block'),
  }
}

/** The same export as Fountain - `exportScriptFountain`'s body; the comments are stripped here, not by the serialiser. */
export const exportScriptFountainWith = async (gate: EpisodeGate): Promise<ExportFountainResult> => {
  const refused = roleRefusal(gate, ROLE.export)
  if (refused !== null) return refused
  const { scope, episode: current } = gate
  const document = await readDocumentByKind(scope, current.id, 'screenplay')
  if (document === null) return { status: 'error', message: 'There is no script to export yet.' }
  const read = await readScreenplayNodes(scope, document.id)
  if (!read.ok) {
    return { status: 'error', message: `The stored script would not read (${read.error.at || 'node'}: ${read.error.reason.kind}).` }
  }
  const nodes = read.value.map((entry) => entry.node)
  const exportable = nodes.filter((node) => node.type !== 'comment')
  const serialised = serialiseFountain(exportable)
  const stem = stemOf(current.title)
  return {
    status: 'exported',
    filename: `${stem === '' ? current.slug : stem}.fountain`,
    text: serialised.text,
    omitted: nodes.length - exportable.length,
    forced: serialised.unrepresentable.length,
  }
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

export const titlePageProblem = (raw: unknown): TitlePageResult | null =>
  TitlePageInputSchema.safeParse(raw).success ? null : { status: 'error', message: 'The cover did not read.' }

export const saveTitlePageWith = async (gate: EpisodeGate, raw: unknown): Promise<TitlePageResult> => {
  const refused = roleRefusal(gate, ROLE.authoredEdit)
  if (refused !== null) return refused
  const parsed = TitlePageInputSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', message: 'The cover did not read.' }
  const titlePage = await writeTitlePage(gate.scope, gate.episode.id, parsed.data)
  return { status: 'saved', titlePage }
}

// ---------------------------------------------------------------------------
// Threads, inline in the document
// ---------------------------------------------------------------------------

const BodySchema = z.string().trim().min(1).max(4000)

/**
 * A thread as the card draws it, shaped here so every action that changes
 * one returns the whole card and the client replaces it - no route
 * revalidation, no second read.
 */
const threadViewOf = async (gate: EpisodeGate, threadId: ThreadId, nodeId: string, state: 'open' | 'resolved'): Promise<ThreadView> => {
  const [comments, members] = await Promise.all([listComments(gate.scope, threadId), listMemberProfiles(gate.scope)])
  const nameOf = (userId: string): string => members.find((member) => member.userId === userId)?.displayName ?? 'Someone'
  return {
    id: threadId,
    nodeId,
    state,
    turns: comments.map((comment) => {
      const who = nameOf(comment.authorId)
      return { id: comment.id, who, initials: initialsOf(who), when: whenLabel(comment.createdAt), body: comment.body, mine: comment.authorId === gate.actor }
    }),
  }
}

export const openThreadProblem = (nodeId: unknown, body: unknown, kind: unknown): ThreadResult | null =>
  NodeIdSchema.safeParse(nodeId).success && ThreadNodeKindSchema.safeParse(kind).success && BodySchema.safeParse(body).success
    ? null
    : { status: 'error', message: 'Write a comment first.' }

/** Open a thread on a node. `kind` is parsed rather than trusted - see `openThreadOnNode`. */
export const openThreadOnNodeWith = async (gate: EpisodeGate, nodeId: unknown, body: unknown, kind: ThreadNodeKind | string = 'script_node'): Promise<ThreadResult> => {
  const refused = roleRefusal(gate, ROLE.comment)
  if (refused !== null) return refused
  const id = NodeIdSchema.safeParse(nodeId)
  const anchor = ThreadNodeKindSchema.safeParse(kind)
  const parsedBody = BodySchema.safeParse(body)
  if (!id.success || !anchor.success || !parsedBody.success) return { status: 'error', message: 'Write a comment first.' }
  const thread = await openThread(gate.scope, { kind: anchor.data, nodeId: id.data }, parsedBody.data)
  return { status: 'ok', thread: await threadViewOf(gate, thread.id, id.data as string, thread.state) }
}

export const replyProblem = (threadId: unknown, nodeId: unknown, body: unknown): ThreadResult | null =>
  ThreadIdSchema.safeParse(threadId).success && NodeIdSchema.safeParse(nodeId).success && BodySchema.safeParse(body).success
    ? null
    : { status: 'error', message: 'Write a reply first.' }

export const replyThreadWith = async (gate: EpisodeGate, threadId: unknown, nodeId: unknown, body: unknown): Promise<ThreadResult> => {
  const refused = roleRefusal(gate, ROLE.comment)
  if (refused !== null) return refused
  const id = ThreadIdSchema.safeParse(threadId)
  const node = NodeIdSchema.safeParse(nodeId)
  const parsedBody = BodySchema.safeParse(body)
  if (!id.success || !node.success || !parsedBody.success) return { status: 'error', message: 'Write a reply first.' }
  await replyToThread(gate.scope, id.data as ThreadId, parsedBody.data)
  return { status: 'ok', thread: await threadViewOf(gate, id.data as ThreadId, node.data as string, 'open') }
}

export const threadIdProblem = (threadId: unknown): SimpleResult | null =>
  ThreadIdSchema.safeParse(threadId).success ? null : { status: 'error', message: 'That thread could not be found.' }

export const resolveThreadWith = async (gate: EpisodeGate, threadId: unknown): Promise<SimpleResult> => {
  const refused = roleRefusal(gate, ROLE.comment)
  if (refused !== null) return refused
  const id = ThreadIdSchema.safeParse(threadId)
  if (!id.success) return { status: 'error', message: 'That thread could not be found.' }
  await setThreadState(gate.scope, id.data as ThreadId, 'resolved')
  return { status: 'done' }
}
