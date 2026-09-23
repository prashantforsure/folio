'use server'

import {
  createDocument,
  createMentionTarget,
  mintNodeIds,
  readDocumentByKind,
  readScreenplayNodes,
  replaceNodes,
  retireNodes,
  snapshotVersion,
} from '@folio/db'
import type { DocumentId, ScreenplayNode } from '@folio/script'
import { cueSpelling } from '@folio/script'
import {
  countFdxNodes,
  countFountainNodes,
  importFinalDraft,
  parseFountain,
  text,
  typed,
} from '@folio/script'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'

import { readFdx } from './fdx-adapter'
import { cachedRows, forgetRows } from './row-cache'
import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode, openEpisodeWith, openProject } from './gate'
import { exportProjectPdfWith, exportScriptPdfWith } from './pdf-export'
import type { ThreadNodeKind } from './panel'
import {
  exportScriptFdxWith,
  exportScriptFountainWith,
  formatProblem,
  openThreadOnNodeWith,
  openThreadProblem,
  paginationProblem,
  parseSaveInput,
  replyProblem,
  replyThreadWith,
  resolveThreadWith,
  saveReadsFor,
  saveScriptWith,
  saveTitlePageWith,
  setFormatWith,
  setPaginationWith,
  threadIdProblem,
  titlePageProblem,
} from './core'
import type { SaveScriptInput } from './core'
import type {
  ExportFountainResult,
  ExportPdfResult,
  ExportScriptResult,
  ImportScriptResult,
  MentionTargetResult,
  SaveScriptResult,
  SimpleResult,
  ThreadResult,
  TitlePageResult,
} from './result'
import { measureAndDerive } from './server'

export type { SaveScriptInput } from './core'

/**
 * The Script route's writes. The only surface in the product that writes the
 * document, and every write goes: gate -> repository -> pipeline -> result.
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * Every write the agent's tools reach is a core function in `core.ts` taking
 * an episode gate and the raw input - the tools and the worker call those with
 * a gate of their own. The action here parses what it always parsed before
 * the gate, opens the cookie gate with its capability, and calls the core;
 * `saveScript` also runs the save's reads beside the gate, as it always did,
 * and hands the core Next's `after` for the half that runs after the answer.
 * Signatures and results are unchanged. Creating a blank script, importing and
 * minting a mention are as they were.
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

/**
 * Save the script (`saveScriptWith`).
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
 * and re-deriving the project happen after the response (`deferAfterSave`,
 * through Next's `after`). Three round trips between the keystroke's request
 * and its answer, where there were nineteen. The snapshot, when asked for,
 * runs beside the write.
 */
export const saveScript = async (raw: SaveScriptInput): Promise<SaveScriptResult> => {
  const parsed = parseSaveInput(raw)
  if (!parsed.ok) return parsed.result
  const input = parsed.input

  // The stored rows, if this process wrote them last (`row-cache.ts`): the
  // read is skipped beside the gate and the entry checked against the
  // document's stamp once that has come back.
  const cached = cachedRows(input.documentId as DocumentId)
  const gate = await openEpisodeWith(input.projectId, input.episode, saveReadsFor(input, cached), ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  return saveScriptWith(gate, raw, { schedule: (task) => after(task), prepared: { reads: gate.extra, cached } })
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
  const gate = await openEpisode(projectId, episode, ROLE.authoredEdit)
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
  const gate = await openEpisode(formData.get('projectId'), formData.get('episode'), ROLE.authoredEdit)
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
  const problem = paginationProblem(control)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  return setPaginationWith(gate, control)
}

export const setFormat = async (
  projectId: string,
  episode: string,
  format: string,
): Promise<SimpleResult> => {
  const problem = formatProblem(format)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  return setFormatWith(gate, format)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * The script as `.fdx` text (`exportScriptFdxWith`): the stored rows, read
 * strictly, through the pure `serialiseFinalDraft` and the adapter's
 * `XMLBuilder`. Comments never enter it (AGENTS.md, Export); what the mapping
 * changed is counted back so the panel can say so. Nothing is written, nothing
 * is stored - the file goes straight to the browser's download, so the
 * built-in-SMTP-only constraint on "your export is ready" never comes up. Not
 * an agent-writable surface.
 */
export const exportScriptFdx = async (projectId: string, episode: string): Promise<ExportScriptResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.export)
  if (isRefusal(gate)) return gate
  return exportScriptFdxWith(gate)
}

/**
 * The same export, as Fountain (`exportScriptFountainWith`).
 *
 * `serialiseFountain` is a pure function in `packages/script` and has been
 * since the Fountain pass; nothing called it. The Script route's menu offered
 * `.fdx` alone, and account settings told writers Fountain export lived "in
 * the Outline route's the menu", where what actually lives is a *Markdown*
 * export of the outline - a different document in a different format. This is
 * the action that makes that sentence true, and the sentence is corrected in
 * the same change.
 *
 * ## The comments are stripped here, not by the serialiser
 *
 * AGENTS.md, Export: "Comments never enter an export. Notes never enter an
 * export." `serialiseFountain` writes a `comment` node as a Fountain note,
 * `[[like this]]`, and it is right to - its promise is that parsing its output
 * returns the same nodes, and a serialiser that dropped blocks could not keep
 * it. The rule is about *exports*, so it is applied at the export, and the
 * pure function is left exact. `omitted` is how many went.
 *
 * `forced` is the serialiser's own report: how many blocks it had to write
 * with an explicit marker so that parsing its output returns the same nodes.
 * That is its round-trip promise being kept, not a loss - which is why it is
 * reported under its own name rather than counted as an omission.
 */
export const exportScriptFountain = async (projectId: string, episode: string): Promise<ExportFountainResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.export)
  if (isRefusal(gate)) return gate
  return exportScriptFountainWith(gate)
}

/**
 * The script as PDF (roadmap task 5.3, `exportScriptPdfWith`): the cover, then
 * every page as the measurement record lays it out - the stored one when it is
 * current, one measured now when it is stale - in Courier Prime, with a
 * fallback face for Devanagari. Comments never enter it. The file comes back as
 * base64, since an action answers in JSON; the browser saves it.
 */
export const exportScriptPdf = async (projectId: string, episode: string): Promise<ExportPdfResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.export)
  if (isRefusal(gate)) return gate
  return exportScriptPdfWith(gate)
}

/** The project card's `Export PDF`: every episode with a script, in running order, each on its own cover. */
export const exportProjectPdf = async (projectId: string): Promise<ExportPdfResult> => {
  const gate = await openProject(projectId, ROLE.export)
  if (isRefusal(gate)) return gate
  return exportProjectPdfWith(gate)
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

export const saveTitlePage = async (
  projectId: string,
  episode: string,
  raw: unknown,
): Promise<TitlePageResult> => {
  const problem = titlePageProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.authoredEdit)
  if (isRefusal(gate)) return gate
  return saveTitlePageWith(gate, raw)
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
  const gate = await openEpisode(projectId, episode, ROLE.entityOperation)
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

/**
 * Open a thread on a node (`openThreadOnNodeWith`). From the block's `+`
 * handle - creation did not exist before the redesign. The Script passes
 * `script_node`, the Outline `outline_block` (`ThreadNodeKindSchema`,
 * `@folio/contracts`): both are node ids in the same table, and the anchor
 * kind is what `loadScript` / `loadOutline` filter their threads by, so a kind
 * that lied would draw the card on neither route.
 *
 * `kind` is parsed rather than trusted. A `ThreadNodeKind` parameter is a
 * TypeScript constraint and nothing else: a server action is an endpoint, and
 * an invocation that is not this app's React can put any string there. The
 * default stays `script_node`, so every existing caller reads the same.
 */
export const openThreadOnNode = async (
  projectId: string,
  episode: string,
  nodeId: string,
  body: string,
  kind: ThreadNodeKind = 'script_node',
): Promise<ThreadResult> => {
  const problem = openThreadProblem(nodeId, body, kind)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.comment)
  if (isRefusal(gate)) return gate
  return openThreadOnNodeWith(gate, nodeId, body, kind)
}

/**
 * Reply to a thread (`replyThreadWith`). `nodeId` is parsed for the same
 * reason `kind` is above: it is echoed straight back into the `ThreadView` the
 * client draws the card from, so an unvalidated value crosses the boundary in
 * both directions.
 */
export const replyThread = async (
  projectId: string,
  episode: string,
  threadId: string,
  nodeId: string,
  body: string,
): Promise<ThreadResult> => {
  const problem = replyProblem(threadId, nodeId, body)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.comment)
  if (isRefusal(gate)) return gate
  return replyThreadWith(gate, threadId, nodeId, body)
}

export const resolveThread = async (
  projectId: string,
  episode: string,
  threadId: string,
): Promise<SimpleResult> => {
  const problem = threadIdProblem(threadId)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.comment)
  if (isRefusal(gate)) return gate
  return resolveThreadWith(gate, threadId)
}
