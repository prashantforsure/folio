'use server'

import type { ThreadId } from '@folio/contracts'
import {
  ScreenplayNodeSchema,
  ScriptFormatSchema,
  ThreadIdSchema,
  TitlePageInputSchema,
} from '@folio/contracts'
import {
  createDocument,
  createMentionTarget,
  mintNodeIds,
  readDocumentByKind,
  readScreenplayNodes,
  reconcileNodes,
  replaceNodes,
  replyToThread,
  retireNodes,
  setProjectFormat,
  setProjectPagination,
  setThreadState,
  snapshotVersion,
  writeTitlePage,
} from '@folio/db'
import type { NodeId, ScreenplayNode } from '@folio/script'
import {
  countFdxNodes,
  countFountainNodes,
  importFinalDraft,
  parseFountain,
  text,
  typed,
} from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { isPaginationControl, paginationFromControl } from '../state/project-preferences'
import { readFdx } from './fdx-adapter'
import { isRefusal, openEpisode } from './gate'
import type {
  ImportScriptResult,
  MentionTargetResult,
  SaveScriptResult,
  SimpleResult,
  TitlePageResult,
} from './result'
import { measureAndDerive } from './server'

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
 * every node in the project, inside `reconcileNodes`' transaction, before a
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
  documentId: z.string(),
  baseUpdatedAt: z.string(),
  nodes: z.array(ScreenplayNodeSchema),
  retirements: z.array(RetirementSchema),
  snapshot: z.boolean(),
  derive: z.boolean(),
})

export type SaveScriptInput = z.input<typeof SaveScriptInputSchema>

export const saveScript = async (raw: SaveScriptInput): Promise<SaveScriptResult> => {
  const parsed = SaveScriptInputSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      status: 'invalid',
      message: `The script did not read as a node list${issue === undefined ? '' : ` (${issue.path.join('.')}: ${issue.message})`}.`,
    }
  }
  const input = parsed.data

  const gate = await openEpisode(input.projectId, input.episode)
  if (isRefusal(gate)) return gate
  const { scope, project, episode } = gate

  const document = await readDocumentByKind(scope, episode.id, 'screenplay')
  if (document === null || document.id !== input.documentId) {
    return { status: 'refused', message: 'That script no longer exists. Reload to continue.' }
  }

  const conflict =
    document.updatedAt === input.baseUpdatedAt
      ? null
      : { expected: input.baseUpdatedAt, found: document.updatedAt }

  const written = await reconcileNodes(scope, document.id, 'screenplay', input.nodes)
  if ('unusable' in written) return { status: 'ids-unusable', ids: written.unusable }
  await retireNodes(
    scope,
    document.id,
    input.retirements.map((entry) => ({
      nodeId: entry.nodeId as NodeId,
      mergedInto: entry.mergedInto === null ? null : (entry.mergedInto as NodeId),
    })),
  )

  let snapshotTaken = false
  if (input.snapshot) {
    await snapshotVersion(scope, document.id, 'autosave', input.nodes, input.nodes.length)
    snapshotTaken = true
  }

  const after = await measureAndDerive(scope, project, episode, document, input.nodes, {
    derive: input.derive,
  })
  return {
    status: 'saved',
    updatedAt: written.updatedAt,
    conflict,
    measurement: after.measurement,
    stats: after.stats,
    labels: after.labels,
    snapshotTaken,
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
  const label = await createMentionTarget(gate.scope, entity, parsedName.data)
  return { status: 'created', label }
}

// ---------------------------------------------------------------------------
// Threads, from the Collaboration tab
// ---------------------------------------------------------------------------

const BodySchema = z.string().trim().min(1).max(4000)

export const replyThread = async (
  projectId: string,
  episode: string,
  threadId: string,
  body: string,
): Promise<SimpleResult> => {
  const id = ThreadIdSchema.safeParse(threadId)
  const parsedBody = BodySchema.safeParse(body)
  if (!id.success || !parsedBody.success) return { status: 'error', message: 'Write a reply first.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await replyToThread(gate.scope, id.data as ThreadId, parsedBody.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'done' }
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
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'done' }
}
