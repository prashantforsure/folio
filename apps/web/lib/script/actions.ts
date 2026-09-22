'use server'

import type { ThreadId } from '@folio/contracts'
import {
  NodeIdSchema,
  ScreenplayNodeSchema,
  ScriptFormatSchema,
  ThreadIdSchema,
  TitlePageInputSchema,
} from '@folio/contracts'
import {
  commitNodePlan,
  createDocument,
  createMentionTarget,
  listComments,
  listMemberProfiles,
  mintNodeIds,
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
  replaceNodes,
  replyToThread,
  retireNodes,
  reviveNodeIds,
  setProjectFormat,
  setProjectPagination,
  setThreadState,
  snapshotVersion,
  writeTitlePage,
} from '@folio/db'
import type { DocumentId, NodeId, ScreenplayNode } from '@folio/script'
import { cueSpelling } from '@folio/script'
import {
  countFdxNodes,
  countFountainNodes,
  importFinalDraft,
  parseFountain,
  serialiseFinalDraft,
  text,
  typed,
} from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isPaginationControl, paginationFromControl } from '../state/project-preferences'
import { digestOf } from './digest'
import { readFdx, writeFdx } from './fdx-adapter'
import { cachedRows, forgetRows, rememberRows, rowsAfterWrite } from './row-cache'
import { isRefusal, openEpisode, openEpisodeWith } from './gate'
import type { EpisodeGate } from './gate'
import type { ThreadNodeKind, ThreadView } from './panel'
import { initialsOf, whenLabel } from './panel'
import type {
  ExportScriptResult,
  ImportScriptResult,
  MentionTargetResult,
  SaveScriptResult,
  SimpleResult,
  ThreadResult,
  TitlePageResult,
} from './result'
import {
  deferAfterSave,
  deriveSpeculatively,
  measure,
  measureAndDerive,
  readDerivationReads,
  statsFor,
} from './server'

/**
 * The Script route's writes. The only surface in the product that writes the
 * document, and every write goes: gate -> repository -> pipeline -> result.
 *
 * ## Saving is last-write-wins with a conflict banner
 *
 * AGENTS.md, Constraints: "No realtime collaboration. Last-write-wins with a
 * conflict banner." The client sends the `documents.updated_at` it last saw
 * as `baseUpdatedAt`. If the row has moved on, somebody else saved in
 * between - and this save **still wins**: the rows are written, and the
 * result carries the two timestamps so the banner can say whose work was
 * overwritten. Refusing the write would be a merge, and a merge is the
 * feature that was cut.
 *
 * ## Ids are checked, not trusted
 *
 * The editor mints ids so Enter does not wait on a round trip. Every id
 * that is new to the document is checked against the tombstones and against
 * every node in the project, inside `commitNodePlan`'s one statement, before a
 * row is written. A reused id refuses the write as `ids-unusable`. This is
 * ADR 0001's "never reused" at the only door that can enforce it.
 *
 * ## Snapshots
 *
 * `versions` is the undo backstop, not a keystroke log. The client asks for
 * a snapshot at most once every few minutes and on an explicit save; the
 * import path takes one `before_import`. Cadence is an assumption, flagged.
 */

const RetirementSchema = z.object({
  nodeId: z.string().min(1),
  mergedInto: z.string().min(1).nullable(),
})

const SaveScriptInputSchema = z.object({
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
})

export type SaveScriptInput = z.input<typeof SaveScriptInputSchema>

const invalid = (message: string): SaveScriptResult => ({
  status: 'invalid',
  message: `The script did not read as a node list (${message}).`,
})

/**
 * Save the script.
 *
 * ## The request is a delta; the write is still a node list
 *
 * A feature is ~3,000 nodes and half a megabyte as JSON, and an autosave
 * runs 1.5s after every pause. So the client sends what changed - the nodes
 * that are new or different since its last save, and the id order only when
 * a node was added, removed or moved - and the server reads the stored rows
 * (it must anyway, to plan the write and to paginate), lays the delta over
 * them, and has the whole list back in hand before anything is decided. The
 * list is validated as a list: every id in the order resolves, none
 * repeats, and an upsert with no place in the order is refused as the
 * client bug it would be. Nothing about "the script is a node list" moved;
 * only the transport did.
 *
 * ## What a save waits for
 *
 * Every read a save needs is issued **beside the gate**, in one round trip
 * (`openEpisodeWith`); the write is one statement (`commitNodePlan`); the
 * measurement is computed in memory and returned. Storing that measurement
 * and re-deriving the project happen after the response (`deferAfterSave`).
 * Three round trips between the keystroke's request and its answer, where
 * there were nineteen. The snapshot, when asked for, runs beside the write.
 */
export const saveScript = async (raw: SaveScriptInput): Promise<SaveScriptResult> => {
  const parsed = SaveScriptInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return invalid(issue === undefined ? 'shape' : `${issue.path.join('.')}: ${issue.message}`)
  }
  const input = parsed.data
  const documentId = input.documentId as DocumentId

  // The stored rows, if this process wrote them last (`row-cache.ts`): the
  // read is skipped beside the gate and the entry checked against the
  // document's stamp once that has come back.
  const cached = cachedRows(documentId)
  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    const [document, freshRows, labels, reads] = await Promise.all([
      readDocumentById(scope, documentId),
      cached === undefined ? readNodeRows(scope, documentId) : Promise.resolve(null),
      readMentionLabels(scope),
      input.derive ? readDerivationReads(scope) : Promise.resolve(null),
    ])
    return { document, freshRows, labels, reads }
  })
  if (isRefusal(gate)) return gate
  const { scope, project, episode } = gate
  const { document, freshRows, labels, reads } = gate.extra

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

  deferAfterSave(scope, episode, document, measurement, next, { derive: input.derive })

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
// Creating the document
// ---------------------------------------------------------------------------

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

/**
 * Start a blank script: the document row and one empty scene heading, so the
 * writer lands on the ghost slugline the empty state promised.
 */
export const createBlankScript = async (
  projectId: string,
  episode: string,
): Promise<SimpleResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope, project } = gate

  const already = await readDocumentByKind(scope, gate.episode.id, 'screenplay')
  if (already !== null) return { status: 'done' }

  const document = await createDocument(scope, gate.episode.id, 'screenplay', gate.episode.title)
  const [id] = await mintNodeIds(scope, 1)
  if (id === undefined) return { status: 'error', message: 'No id could be minted.' }
  const nodes: readonly ScreenplayNode[] = [
    { type: 'scene', id, provenance: typed(), content: [text('')] },
  ]
  await replaceNodes(scope, document.id, 'screenplay', nodes)
  await measureAndDerive(scope, project, gate.episode, document, nodes)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'done' }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const MAX_IMPORT_BYTES = 8 * 1024 * 1024

/**
 * Import a `.fdx` or `.fountain` file into the episode's script.
 *
 * FDX goes through `readFdx` (the `fast-xml-parser` adapter) and
 * `importFinalDraft`; Fountain through `parseFountain`. Both strip generated
 * text through the one implementation in `generated-text.ts`, which is what
 * makes "no doubled continueds" a property of the importer rather than a
 * hope. Ids are minted by the repository, one per node, after the count is
 * known - `packages/script` cannot mint one.
 *
 * An existing script is snapshotted `before_import` and replaced whole.
 */
export const importScript = async (
  _previous: ImportScriptResult,
  formData: FormData,
): Promise<ImportScriptResult> => {
  const gate = await openEpisode(formData.get('projectId'), formData.get('episode'))
  if (isRefusal(gate)) return gate
  const { scope, project, episode } = gate

  const file = formData.get('file')
  if (!(file instanceof File)) return { status: 'error', message: 'Choose a .fdx or .fountain file.' }
  if (file.size === 0) return { status: 'error', message: 'That file is empty.' }
  if (file.size > MAX_IMPORT_BYTES) {
    return { status: 'error', message: 'That file is larger than 8 MB. Split it or export a smaller draft.' }
  }
  const name = file.name.toLowerCase()
  const kind = name.endsWith('.fdx') ? 'fdx' : name.endsWith('.fountain') || name.endsWith('.txt') ? 'fountain' : null
  if (kind === null) return { status: 'error', message: 'Folio imports .fdx and .fountain files.' }
  const source = await file.text()

  type Parsed = {
    readonly nodes: readonly ScreenplayNode[]
    readonly stripped: number
    readonly headingsNotRecognised: number
    readonly unsupported: number
  }
  let parsed: Parsed
  if (kind === 'fdx') {
    const tree = readFdx(source)
    const needed = countFdxNodes(tree)
    if (needed === 0) return { status: 'error', message: 'No paragraphs were found in that Final Draft file.' }
    const freshIds = await mintNodeIds(scope, needed)
    const imported = importFinalDraft(tree, { freshIds })
    if (!imported.ok) return { status: 'error', message: `Final Draft import refused: ${imported.error.kind}.` }
    parsed = {
      nodes: imported.value.nodes,
      stripped: imported.value.stripped.length,
      headingsNotRecognised: imported.value.headingsNotRecognised.length,
      unsupported: imported.value.unsupported.length,
    }
  } else {
    const needed = countFountainNodes(source)
    if (needed === 0) return { status: 'error', message: 'No script elements were found in that Fountain file.' }
    const freshIds = await mintNodeIds(scope, needed)
    const imported = parseFountain(source, { freshIds })
    if (!imported.ok) return { status: 'error', message: `Fountain import refused: ${imported.error.kind}.` }
    parsed = {
      nodes: imported.value.nodes,
      stripped: imported.value.stripped.length,
      headingsNotRecognised: imported.value.rejectedHeadings.length,
      unsupported: imported.value.unsupported.length,
    }
  }
  const { nodes, stripped, headingsNotRecognised, unsupported } = parsed

  let document = await readDocumentByKind(scope, episode.id, 'screenplay')
  if (document === null) {
    document = await createDocument(scope, episode.id, 'screenplay', episode.title)
  } else {
    const previous = await readScreenplayNodes(scope, document.id)
    if (previous.ok && previous.value.length > 0) {
      const before = previous.value.map((entry) => entry.node)
      await snapshotVersion(scope, document.id, 'before_import', before, before.length)
      await retireNodes(
        scope,
        document.id,
        before.map((node) => ({ nodeId: node.id, mergedInto: null })),
      )
    }
  }
  await replaceNodes(scope, document.id, 'screenplay', nodes)
  forgetRows(document.id)
  await measureAndDerive(scope, project, episode, document, nodes)
  revalidatePath(workspacePath(project.id), 'layout')
  return { status: 'imported', nodes: nodes.length, stripped, headingsNotRecognised, unsupported }
}

// ---------------------------------------------------------------------------
// Project preferences the Info panel writes
// ---------------------------------------------------------------------------

/*
 * Neither of these revalidates. The workspace has already applied the setting
 * to the sheet it is drawing before the call is made (`script-workspace.tsx`,
 * "Pagination and format"), and a `revalidatePath` here would answer a
 * one-column update by re-running `loadScript` over every node in the
 * episode - seconds on a feature, for a tree the client would then ignore.
 * Every other route reads the row fresh on its next request, as dynamic
 * routes do; the stored measurement is re-cut on the next save, which was
 * already the case.
 */

export const setPagination = async (
  projectId: string,
  episode: string,
  control: string,
): Promise<SimpleResult> => {
  if (!isPaginationControl(control)) return { status: 'error', message: 'Unknown pagination control.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await setProjectPagination(gate.scope, paginationFromControl(control))
  return { status: 'done' }
}

export const setFormat = async (
  projectId: string,
  episode: string,
  format: string,
): Promise<SimpleResult> => {
  const parsed = ScriptFormatSchema.safeParse(format)
  if (!parsed.success) return { status: 'error', message: 'Unknown format.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await setProjectFormat(gate.scope, parsed.data)
  return { status: 'done' }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * The script as `.fdx` text: the stored rows, read strictly, through the pure
 * `serialiseFinalDraft` and the adapter's `XMLBuilder`. Comments never enter
 * it (AGENTS.md, Export); what the mapping changed is counted back so the
 * panel can say so. Nothing is written, nothing is stored - the file goes
 * straight to the browser's download, so the built-in-SMTP-only constraint
 * on "your export is ready" never comes up. Not an agent-writable surface.
 */
export const exportScriptFdx = async (projectId: string, episode: string): Promise<ExportScriptResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
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
  const stem = current.title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '')
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

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

export const saveTitlePage = async (
  projectId: string,
  episode: string,
  raw: unknown,
): Promise<TitlePageResult> => {
  const parsed = TitlePageInputSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', message: 'The cover did not read.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const titlePage = await writeTitlePage(gate.scope, gate.episode.id, parsed.data)
  return { status: 'saved', titlePage }
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

const MentionNameSchema = z.string().trim().min(1).max(120)

export const createMention = async (
  projectId: string,
  episode: string,
  entity: string,
  name: string,
): Promise<MentionTargetResult> => {
  if (entity !== 'character' && entity !== 'location') {
    return { status: 'error', message: 'A mention is a character or a location.' }
  }
  const parsedName = MentionNameSchema.safeParse(name)
  if (!parsedName.success) return { status: 'error', message: 'Give the record a name.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  // A character binds its name's spelling as its first alias, as `createCharacter`
  // does, so a cue typed later resolves to it instead of proposing it.
  const label = await createMentionTarget(
    gate.scope,
    entity,
    parsedName.data,
    entity === 'character' ? cueSpelling(parsedName.data) : null,
  )
  return { status: 'created', label }
}

// ---------------------------------------------------------------------------
// Threads, inline in the document
// ---------------------------------------------------------------------------

const BodySchema = z.string().trim().min(1).max(4000)

/**
 * A thread as the card draws it, shaped here so every action that changes
 * one returns the whole card and the client replaces it - no route
 * revalidation, no second read. The member list is one read; a thread has
 * a handful of turns.
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

/**
 * Open a thread on a node. From the block's `+` handle - creation did not
 * exist before the redesign. The Script passes `script_node`, the Outline
 * `outline_block` (`lib/script/panel.ts`, `ThreadNodeKind`): both are node
 * ids in the same table, and the anchor kind is what `loadScript` /
 * `loadOutline` filter their threads by, so a kind that lied would draw the
 * card on neither route.
 */
export const openThreadOnNode = async (
  projectId: string,
  episode: string,
  nodeId: string,
  body: string,
  kind: ThreadNodeKind = 'script_node',
): Promise<ThreadResult> => {
  const id = NodeIdSchema.safeParse(nodeId)
  const parsedBody = BodySchema.safeParse(body)
  if (!id.success || !parsedBody.success) return { status: 'error', message: 'Write a comment first.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const thread = await openThread(gate.scope, { kind, nodeId: id.data }, parsedBody.data)
  return { status: 'ok', thread: await threadViewOf(gate, thread.id, id.data as string, thread.state) }
}

export const replyThread = async (
  projectId: string,
  episode: string,
  threadId: string,
  nodeId: string,
  body: string,
): Promise<ThreadResult> => {
  const id = ThreadIdSchema.safeParse(threadId)
  const parsedBody = BodySchema.safeParse(body)
  if (!id.success || !parsedBody.success) return { status: 'error', message: 'Write a reply first.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await replyToThread(gate.scope, id.data as ThreadId, parsedBody.data)
  return { status: 'ok', thread: await threadViewOf(gate, id.data as ThreadId, nodeId, 'open') }
}

export const resolveThread = async (
  projectId: string,
  episode: string,
  threadId: string,
): Promise<SimpleResult> => {
  const id = ThreadIdSchema.safeParse(threadId)
  if (!id.success) return { status: 'error', message: 'That thread could not be found.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await setThreadState(gate.scope, id.data as ThreadId, 'resolved')
  return { status: 'done' }
}
