import type { ContentInput, Episode, OutlineOpInput, ProposalDocumentBase, ScriptOpInput, VersionId } from '@folio/contracts'
import { InlineContentSchema, OutlineNodeSchema, OutlineOpSchema, ScreenplayNodeSchema, ScriptOpSchema } from '@folio/contracts'
import { listEpisodes, mintNodeIds, readDocumentByKind, readEpisode, readMentionLabels, readVersionSnapshot } from '@folio/db'
import type { DocumentId, InlineContent, NodeId, OutlineNode, OutlineOp, ScreenplayNode, ScriptOp } from '@folio/script'
import {
  applyOutlineOps,
  applyScriptOps,
  byAgent,
  describeNodeOpError,
  diffOutlines,
  diffScreenplays,
  insertedIds,
  mentionTargets,
  restoreOutlineOps,
  restoreScriptOps,
  text,
  typed,
} from '@folio/script'
import { z } from 'zod'

import { saveOutline } from '../outline/actions'
import { saveScript } from '../script/actions'
import { nodeDigest } from '../script/server'
import type { DiffView } from './diff-view'
import { diffViewOf } from './diff-view'
import type { DocumentState } from './documents'
import { readDocumentState } from './documents'
import type { ExecContext, OpPreview, PreviewContext, StoredOp } from './executors'
import { defineExecutor } from './executors'
import type { ToolGate } from './registry'

/**
 * Script and outline edits - roadmap task 3.4, ADR 0003 **D10** and **D11**.
 *
 * ## When the proposal is written: `prepareDocumentEdit`
 *
 * The model's operations (`ScriptOpInput`) become the stored form
 * (`ScriptOp`): every new node gets an id minted **now**, against the
 * project's tombstones (`mintNodeIds`), so the card's diff, the open editor
 * and the server all write the same ids; plain-text content becomes inline
 * runs; a mention must name a record that exists. Then the operations are
 * **run once against the current node list** with the pure core
 * (`applyScriptOps`) - an operation that cannot apply is refused here, with
 * which one and why, rather than proposed and failing on the writer's click.
 * The document's digest at that moment is the proposal's base.
 *
 * ## When it is applied: two paths
 *
 *   **A - the writer has the document open.** The executor does not write: it
 *   hands the operations back (`deferred`), the panel gives them to that
 *   editor, which applies them as one transaction stamped `byAgent(run)`, and
 *   its own autosave persists them. There is only ever one writer to the node
 *   list (D10).
 *
 *   **B - nobody has it open.** The server applies the same operations to the
 *   stored list and saves with `saveScript` / `saveOutline` carrying the
 *   digest this apply expects (`expectedDigest`, task 1.6). A mismatch is the
 *   save's `stale`, and the proposal is `stale` - re-planned, never forced.
 *
 * ## Undo
 *
 * The undo record is the `before_agent_run` snapshot apply took and the
 * digest the edit left. If the document still has that digest, undo writes
 * the snapshot back under the same compare-and-swap. If it moved - the writer
 * typed since - undo writes nothing: it proposes `restoreScriptOps`, the
 * operations that take back only what the agent did.
 */

const DocumentKindSchema = z.enum(['screenplay', 'outline'])

const ScriptEditArgsSchema = z.object({
  documentId: z.uuid(),
  episodeId: z.uuid(),
  ops: z.array(ScriptOpSchema).min(1).max(200),
})

const OutlineEditArgsSchema = z.object({
  documentId: z.uuid(),
  episodeId: z.uuid(),
  ops: z.array(OutlineOpSchema).min(1).max(200),
})

export type ScriptEditArgs = z.infer<typeof ScriptEditArgsSchema>

export type OutlineEditArgs = z.infer<typeof OutlineEditArgsSchema>

const UndoSchema = z.object({ documentId: z.uuid(), versionId: z.uuid().nullable(), afterDigest: z.string() })

type Undo = z.infer<typeof UndoSchema>

// ---------------------------------------------------------------------------
// Preparing an edit
// ---------------------------------------------------------------------------

const contentOf = (input: ContentInput): InlineContent | null => {
  if (typeof input === 'string') return input.length === 0 ? [] : [text(input)]
  const parsed = InlineContentSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

type Prepared<Op> =
  | { readonly ok: true; readonly args: { readonly documentId: DocumentId; readonly episodeId: string; readonly ops: readonly Op[] }; readonly base: ProposalDocumentBase; readonly episode: Episode }
  | { readonly ok: false; readonly message: string }

/** The episode a tool means: the one named by number, else the one the turn is about. */
export const episodeNumbered = async (gate: ToolGate, ordinal: number | undefined): Promise<Episode | null> => {
  if (ordinal === undefined || ordinal === gate.episode.ordinal) return gate.episode
  return (await listEpisodes(gate.scope)).find((entry) => entry.ordinal === ordinal) ?? null
}

type InputOp = ScriptOpInput | OutlineOpInput

/**
 * Mint, normalise, check mentions and run the operations once against the
 * current list. `prior` is operations already proposed on this document in
 * the same step: the new ones are checked on top of them.
 */
const prepare = async <Op extends ScriptOp | OutlineOp>(
  gate: ToolGate,
  kind: 'screenplay' | 'outline',
  ordinal: number | undefined,
  input: readonly InputOp[],
  prior: readonly Op[],
  schema: z.ZodType<readonly Op[]>,
  check: (state: DocumentState, ops: readonly Op[]) => string | null,
): Promise<Prepared<Op>> => {
  const episode = await episodeNumbered(gate, ordinal)
  if (episode === null) return { ok: false, message: `There is no episode ${String(ordinal)}.` }
  const document = await readDocumentByKind(gate.scope, episode.id, kind)
  if (document === null) {
    return { ok: false, message: kind === 'screenplay' ? 'This episode has no script yet. The writer starts it from the Script page.' : 'This episode has no outline yet. The writer starts it from the Outline page.' }
  }
  const [state, labels, ids] = await Promise.all([
    readDocumentState(gate.scope, document.id),
    readMentionLabels(gate.scope),
    mintNodeIds(gate.scope, input.reduce((count, op) => count + (op.op === 'insert_after' ? op.nodes.length : 0), 0)),
  ])
  if (state === null) return { ok: false, message: 'The document would not read.' }
  const known = new Set(labels.map((label) => `${label.entity}:${label.id}`))
  const fresh = [...ids]

  const minted: unknown[] = []
  for (const [at, op] of input.entries()) {
    const where = `Operation ${String(at + 1)}`
    if (op.op === 'insert_after') {
      const nodes = []
      for (const node of op.nodes) {
        const content = contentOf(node.content)
        if (content === null) return { ok: false, message: `${where}: that content did not read.` }
        const id = fresh.shift()
        if (id === undefined) return { ok: false, message: `${where}: no id could be minted.` }
        nodes.push({ id, type: node.type, content, modifiers: node.modifiers ?? [] })
      }
      minted.push({ op: 'insert_after', anchor: op.anchor, nodes })
    } else if (op.op === 'replace_content') {
      const content = contentOf(op.content)
      if (content === null) return { ok: false, message: `${where}: that content did not read.` }
      minted.push({ op: 'replace_content', id: op.id, content, modifiers: op.modifiers ?? null })
    } else {
      minted.push(op)
    }
  }
  const parsed = schema.safeParse(minted)
  if (!parsed.success) return { ok: false, message: `The operations did not read (${parsed.error.issues[0]?.message ?? 'shape'}).` }
  const ops = parsed.data

  for (const op of ops) {
    const contents = op.op === 'insert_after' ? op.nodes.map((node) => node.content) : op.op === 'replace_content' ? [op.content] : []
    for (const content of contents) {
      for (const target of mentionTargets(content)) {
        if (!known.has(`${target.entity}:${target.id}`)) return { ok: false, message: `There is no ${target.entity} ${target.id}. Mention only records a tool returned - create it first if it is new.` }
      }
    }
  }
  const all = [...prior, ...ops]
  const refused = check(state, all)
  if (refused !== null) return { ok: false, message: refused }
  return {
    ok: true,
    args: { documentId: state.documentId, episodeId: episode.id, ops: all },
    base: { documentId: state.documentId, kind, episodeId: episode.id, digest: state.digest },
    episode,
  }
}

/** A script edit, ready to be an operation of a proposal - or why it cannot be. */
export const prepareScriptEdit = (gate: ToolGate, ordinal: number | undefined, input: readonly ScriptOpInput[], prior: readonly ScriptOp[] = []): Promise<Prepared<ScriptOp>> =>
  prepare<ScriptOp>(gate, 'screenplay', ordinal, input, prior, z.array(ScriptOpSchema), (state, ops) => {
    if (state.kind !== 'screenplay') return 'That is not a script.'
    // Provenance does not decide whether an operation applies; the run stamps it at apply.
    const result = applyScriptOps(state.nodes, ops, typed())
    return result.ok ? null : describeNodeOpError(result.error)
  })

/** An outline edit, the same way. */
export const prepareOutlineEdit = (gate: ToolGate, ordinal: number | undefined, input: readonly OutlineOpInput[], prior: readonly OutlineOp[] = []): Promise<Prepared<OutlineOp>> =>
  prepare<OutlineOp>(gate, 'outline', ordinal, input, prior, z.array(OutlineOpSchema), (state, ops) => {
    if (state.kind !== 'outline') return 'That is not an outline.'
    const result = applyOutlineOps(state.nodes, ops, typed())
    return result.ok ? null : describeNodeOpError(result.error)
  })

// ---------------------------------------------------------------------------
// Describing an edit
// ---------------------------------------------------------------------------

const count = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`

/** "Script, episode 2: add 3 lines, rewrite 1, delete 1." - code's words, from the operations. */
export const describeEdit = (label: string, ops: readonly (ScriptOp | OutlineOp)[], unit: string): string => {
  const added = ops.reduce((total, op) => total + (op.op === 'insert_after' ? op.nodes.length : 0), 0)
  const rewritten = ops.filter((op) => op.op === 'replace_content').length
  const retyped = ops.filter((op) => op.op === 'change_type').length
  const deleted = ops.reduce((total, op) => total + (op.op === 'delete' ? op.ids.length : 0), 0)
  const moved = ops.filter((op) => op.op === 'move').length
  const parts = [
    added > 0 ? `add ${count(added, unit)}` : null,
    rewritten > 0 ? `rewrite ${String(rewritten)}` : null,
    retyped > 0 ? `retype ${String(retyped)}` : null,
    deleted > 0 ? `delete ${String(deleted)}` : null,
    moved > 0 ? `move ${String(moved)}` : null,
  ].filter((part) => part !== null)
  return `${label}: ${parts.join(', ')}`
}

// ---------------------------------------------------------------------------
// Applying, undoing and previewing
// ---------------------------------------------------------------------------

const snapshotNodes = async <T>(ctx: { readonly gate: ToolGate }, versionId: string | null, schema: z.ZodType<T>): Promise<readonly T[] | null> => {
  if (versionId === null) return null
  const snapshot = await readVersionSnapshot(ctx.gate.scope, versionId as VersionId)
  const parsed = z.array(schema).safeParse(snapshot)
  return parsed.success ? parsed.data : null
}

/** Write a whole node list over `from` with the save's compare-and-swap. `stale` when the stored list is not `from`. */
const writeList = async (
  ctx: { readonly gate: ToolGate },
  state: DocumentState,
  next: readonly (ScreenplayNode | OutlineNode)[],
  expectedDigest: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string; readonly stale: boolean }> => {
  const episode = await readEpisode(ctx.gate.scope, state.episodeId as Episode['id'])
  if (episode === null) return { ok: false, message: 'That episode no longer exists.', stale: false }
  const nextIds = new Set(next.map((node) => node.id as string))
  const retirements = state.nodes.filter((node) => !nextIds.has(node.id)).map((node) => ({ nodeId: node.id, mergedInto: null }))
  if (state.kind === 'screenplay') {
    const held = new Map<string, string>(state.nodes.map((node) => [node.id, JSON.stringify(node)]))
    const upserts = next.filter((node) => held.get(node.id) !== JSON.stringify(node))
    const sameOrder = next.length === state.nodes.length && next.every((node, index) => state.nodes[index]?.id === node.id)
    const saved = await saveScript({
      projectId: ctx.gate.project.id,
      episode: episode.slug,
      documentId: state.documentId,
      baseUpdatedAt: state.updatedAt,
      upserts: upserts as ScreenplayNode[],
      order: sameOrder ? null : next.map((node) => node.id),
      retirements,
      snapshot: false,
      derive: true,
      recordDigest: null,
      expectedDigest,
    })
    if (saved.status === 'saved') return { ok: true }
    if (saved.status === 'stale') return { ok: false, message: 'The script changed since this was proposed.', stale: true }
    return { ok: false, message: 'message' in saved ? saved.message : 'The script could not be saved.', stale: false }
  }
  const saved = await saveOutline({
    projectId: ctx.gate.project.id,
    episode: episode.slug,
    documentId: state.documentId,
    baseUpdatedAt: state.updatedAt,
    nodes: next as OutlineNode[],
    retirements,
    snapshot: false,
    expectedDigest,
  })
  if (saved.status === 'saved') return { ok: true }
  if (saved.status === 'stale') return { ok: false, message: 'The outline changed since this was proposed.', stale: true }
  return { ok: false, message: 'message' in saved ? saved.message : 'The outline could not be saved.', stale: false }
}

/** The pieces the two document kinds differ in. */
type Flavour<Op, N> = {
  readonly tool: 'propose_script_edit' | 'propose_outline_edit'
  readonly kind: 'screenplay' | 'outline'
  readonly label: string
  readonly unit: string
  readonly args: z.ZodType<{ readonly documentId: string; readonly episodeId: string; readonly ops: readonly Op[] }>
  readonly node: z.ZodType<N>
  readonly apply: (nodes: readonly N[], ops: readonly Op[], ctx: { readonly runId: ExecContext['runId'] }) => ReturnType<typeof applyScriptOps> | ReturnType<typeof applyOutlineOps>
  readonly restore: (current: readonly N[], before: readonly N[], after: readonly N[]) => readonly Op[]
  readonly diff: (before: readonly N[], after: readonly N[], gate: ToolGate) => Promise<DiffView | null>
  readonly nodesOf: (state: DocumentState) => readonly N[] | null
}

const documentExecutor = <Op extends ScriptOp | OutlineOp, N extends ScreenplayNode | OutlineNode>(flavour: Flavour<Op, N>) =>
  defineExecutor({
    tool: flavour.tool,
    args: flavour.args,
    minimumRole: 'writer',
    describe: (args) => describeEdit(flavour.label, args.ops, flavour.unit),
    target: (args) => ({ type: 'document', id: args.documentId }),
    capture: () => Promise.resolve(null),
    run: async (ctx, args) => {
      const documentId = args.documentId as DocumentId
      const expected = ctx.digests.get(documentId)
      const state = await readDocumentState(ctx.gate.scope, documentId)
      if (state === null) return { ok: false, message: 'That document no longer exists.' }
      if (expected === undefined || state.digest !== expected) return { ok: false, message: `The ${flavour.label.toLowerCase()} changed since this was proposed.`, stale: true }
      const nodes = flavour.nodesOf(state)
      if (nodes === null) return { ok: false, message: 'That is the wrong kind of document.' }
      const next = flavour.apply(nodes, args.ops, ctx)
      if (!next.ok) return { ok: false, message: describeNodeOpError(next.error), stale: true }
      const afterDigest = nodeDigest(next.value)
      const undo: Undo = { documentId, versionId: ctx.snapshots.get(documentId) ?? null, afterDigest }
      if (ctx.editorDocuments.has(documentId)) {
        ctx.digests.set(documentId, afterDigest)
        return { ok: true, result: { appliedIn: 'editor', nodes: next.value.length }, undo, deferred: { documentId, kind: flavour.kind, ops: args.ops } }
      }
      const written = await writeList(ctx, state, next.value, expected)
      if (!written.ok) return { ok: false, message: written.message, stale: written.stale }
      ctx.digests.set(documentId, afterDigest)
      return { ok: true, result: { appliedIn: 'server', nodes: next.value.length, inserted: insertedIds(args.ops) }, undo }
    },
    invert: async (ctx, args, rawUndo) => {
      const undo = UndoSchema.safeParse(rawUndo)
      if (!undo.success) return { kind: 'failed', message: 'The undo record did not read.' }
      const state = await readDocumentState(ctx.gate.scope, args.documentId as DocumentId)
      if (state === null) return { kind: 'failed', message: 'That document no longer exists.' }
      const before = await snapshotNodes(ctx, undo.data.versionId, flavour.node)
      if (before === null) return { kind: 'failed', message: 'The snapshot taken before the run could not be read.' }
      const current = flavour.nodesOf(state)
      if (current === null) return { kind: 'failed', message: 'That is the wrong kind of document.' }
      if (state.digest === undo.data.afterDigest) {
        const written = await writeList(ctx, state, before, state.digest)
        return written.ok ? { kind: 'undone' } : { kind: 'failed', message: written.message }
      }
      // The writer changed it since: take back only what the agent did, as a proposal.
      const after = flavour.apply(before, args.ops, ctx)
      if (!after.ok) return { kind: 'failed', message: 'The edit could not be replayed to see what it changed.' }
      const ops = flavour.restore(current, before, after.value as readonly N[])
      if (ops.length === 0) return { kind: 'undone', note: `Nothing the run wrote is left in the ${flavour.label.toLowerCase()}.` }
      return {
        kind: 'changed',
        ops: [{ tool: flavour.tool, args: { documentId: args.documentId, episodeId: args.episodeId, ops }, mode: 'propose' }],
        note: `The ${flavour.label.toLowerCase()} was edited after the run, so only what the run wrote is offered back.`,
      }
    },
    preview: async (ctx, args, op) => {
      const key = `doc:${args.documentId}`
      const state = await readDocumentState(ctx.gate.scope, args.documentId as DocumentId)
      const episode = await readEpisode(ctx.gate.scope, args.episodeId as Episode['id'])
      const open = { route: flavour.kind === 'screenplay' ? ('script' as const) : ('outline' as const), ...(episode === null ? {} : { episode: episode.ordinal }) }
      const scratch = ctx.scratch.get(key)
      const undo = UndoSchema.safeParse(op.undo)
      const before: readonly N[] | null =
        op.status === 'pending'
          ? Array.isArray(scratch)
            ? (scratch as N[])
            : state === null
              ? null
              : flavour.nodesOf(state)
          : undo.success
            ? await snapshotNodes(ctx, undo.data.versionId, flavour.node)
            : null
      if (before === null) return { open }
      const after = flavour.apply(before, args.ops, ctx)
      if (!after.ok) return { open }
      ctx.scratch.set(key, after.value)
      const diff = await flavour.diff(before, after.value as readonly N[], ctx.gate)
      const sceneId = flavour.kind === 'screenplay' ? firstSceneTouched(before as readonly ScreenplayNode[], after.value as readonly ScreenplayNode[]) : null
      const preview: OpPreview = { open: { ...open, ...(sceneId === null ? {} : { sceneId }) }, ...(diff === null ? {} : { diff }) }
      return preview
    },
  })

/** The heading of the first scene the edit touches, for Open. */
const firstSceneTouched = (before: readonly ScreenplayNode[], after: readonly ScreenplayNode[]): NodeId | null => {
  const was = new Map(before.map((node) => [node.id, JSON.stringify(node)]))
  let heading: NodeId | null = null
  for (const node of after) {
    if (node.type === 'scene') heading = node.id
    if (was.get(node.id) !== JSON.stringify(node)) return heading
  }
  return null
}

const labelsOf = async (gate: ToolGate) => readMentionLabels(gate.scope)

export const scriptEditExecutor = documentExecutor<ScriptOp, ScreenplayNode>({
  tool: 'propose_script_edit',
  kind: 'screenplay',
  label: 'Script',
  unit: 'line',
  args: ScriptEditArgsSchema as z.ZodType<{ readonly documentId: string; readonly episodeId: string; readonly ops: readonly ScriptOp[] }>,
  node: ScreenplayNodeSchema,
  apply: (nodes, ops, ctx) => applyScriptOps(nodes, ops, byAgent(ctx.runId)),
  restore: restoreScriptOps,
  diff: async (before, after, gate) => {
    const result = diffScreenplays(before, after, { format: gate.project.format, mentionLabels: await labelsOf(gate) })
    if (!result.ok) return null
    return diffViewOf(
      'screenplay',
      result.value.entries.map((entry) => ({ ...entry, id: entry.id as string, section: entry.scene })),
    )
  },
  nodesOf: (state) => (state.kind === 'screenplay' ? state.nodes : null),
})

export const outlineEditExecutor = documentExecutor<OutlineOp, OutlineNode>({
  tool: 'propose_outline_edit',
  kind: 'outline',
  label: 'Outline',
  unit: 'block',
  args: OutlineEditArgsSchema as z.ZodType<{ readonly documentId: string; readonly episodeId: string; readonly ops: readonly OutlineOp[] }>,
  node: OutlineNodeSchema,
  apply: (nodes, ops, ctx) => applyOutlineOps(nodes, ops, byAgent(ctx.runId)),
  restore: restoreOutlineOps,
  diff: async (before, after, gate) => {
    const result = diffOutlines(before, after, await labelsOf(gate))
    return diffViewOf(
      'outline',
      result.entries.map((entry) => ({ ...entry, id: entry.id as string })),
    )
  },
  nodesOf: (state) => (state.kind === 'outline' ? state.nodes : null),
})

export const DOCUMENT_EXECUTORS = [scriptEditExecutor, outlineEditExecutor]

export { DocumentKindSchema }

export type { PreviewContext, StoredOp }
