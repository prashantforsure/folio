import type { AgentProposalId, AgentProposalOp, AgentProposalWithOps, MembershipRole, ProposalDocumentBase, VersionId } from '@folio/contracts'
import { needsConfirmation } from '@folio/contracts'
import {
  claimProposal,
  createProposal,
  listRunProposals,
  logAgentActivity,
  markProposalOp,
  readProposal,
  releaseProposal,
  settleProposal,
  skipPendingOps,
  snapshotVersion,
} from '@folio/db'
import type { DocumentId, RunId } from '@folio/script'

import { ROLE_ORDER, ROLE_REFUSED, meetsRole } from '../auth/roles'
import type { RederiveOutcome } from '../script/derive-batch'
import { withDeferredDerive } from '../script/derive-batch'
import { readDocumentState } from './documents'
import type { ExecContext, Executor, InverseOp } from './executors'
import { executorFor } from './executors'
import type { ToolGate } from './registry'

/**
 * Applying a proposal, and undoing a run - roadmap task 3.2, ADR 0003 **D1**,
 * **D10**, **D11**.
 *
 * ## `applyProposalWith`, in order
 *
 *   1. **Role and status.** The proposal must be this project's and
 *      `pending`; the caller's role must reach every operation's minimum (the
 *      D2 matrix, the same `meetsRole` the gates use); a proposal holding a
 *      `confirm` or `paid` operation needs `confirmed` - no autonomy setting
 *      skips that (D1). Then the decision is **claimed**, one conditional
 *      `UPDATE`, so a double click applies once.
 *   2. **Stale check.** Every document in the proposal's base is read again;
 *      a digest that no longer matches means the writer changed it since the
 *      proposal was planned, and the proposal is `stale` with nothing written
 *      (D10: re-planned, never forced).
 *   3. **Snapshots.** A `before_agent_run` version, carrying the run id, for
 *      every document the proposal can touch - its base, and whatever an
 *      operation says it rewrites (a rename's every script). D11: "every
 *      applied proposal first snapshots".
 *   4. **The operations, in order, inside one batched re-derive** (task 1.5):
 *      for each, the undo record is captured and **stored before it runs**,
 *      then the wrapped action runs with the operation's idempotency key, then
 *      its result and final undo record are stored and an `activity_log` row
 *      is written with the verb `agent:<tool>` (D11).
 *   5. **The first failure stops it.** The rest are marked `skipped`; the
 *      proposal is `failed` if nothing landed and `partially_applied` if
 *      something did - the applied operations are always a prefix.
 *
 * ## `undoRunWith`
 *
 * Every applied operation of the run, newest first - proposals in reverse,
 * operations in reverse within each. An operation with no undo record, or no
 * inverse, is skipped and named (a merge, a hard delete: the card said so
 * before it was applied). One whose target has changed since the run is not
 * overwritten: its executor answers `changed` with the operations that would
 * put it back, and those become **one new pending proposal** the writer
 * reviews - task 3.2's "for documents changed since the run, it creates a new
 * proposal instead of overwriting". The first inverse that fails stops the
 * undo, for the reason apply stops: the rest were planned on top of it.
 */

export type ApplyStatus = 'applied' | 'partially_applied' | 'failed' | 'stale'

/**
 * A document edit handed to the writer's open editor (D10 path A): the
 * operation, the document, the minted operations and the run to stamp them
 * with. The panel applies it as one editor transaction, lets autosave persist
 * it, and reports back through `finishEditorApplyWith`.
 */
export type EditorEdit = {
  readonly opId: string
  readonly documentId: DocumentId
  readonly kind: 'screenplay' | 'outline'
  readonly ops: unknown
  readonly runId: RunId
}

export type ApplyOutcome =
  /** Everything the server could do is done; these edits wait for the open editor. The proposal is still claimed, not settled. */
  | { readonly status: 'editor'; readonly proposal: AgentProposalWithOps; readonly edits: readonly EditorEdit[]; readonly derived: RederiveOutcome | null }
  | {
      readonly status: ApplyStatus
      readonly proposal: AgentProposalWithOps
      /** The first failure's message, in the writer's terms; null when every operation ran. */
      readonly failure: string | null
      /** The one derivation pass, when an operation asked for one. */
      readonly derived: RederiveOutcome | null
    }
  | { readonly status: 'refused'; readonly message: string }
  /** A `confirm` or `paid` operation, and no confirmation came with the call. Nothing was claimed. */
  | { readonly status: 'needs-confirmation'; readonly message: string }
  /** Somebody - or an earlier click - already decided it. */
  | { readonly status: 'decided'; readonly message: string }

const NOT_FOUND = 'That proposal could not be found.'

/** The highest minimum role among a proposal's operations. */
const requiredRole = (executors: readonly Executor[]): MembershipRole =>
  executors.reduce<MembershipRole>((highest, executor) => (ROLE_ORDER.indexOf(executor.minimumRole) > ROLE_ORDER.indexOf(highest) ? executor.minimumRole : highest), 'reader')

const executorsOf = (ops: readonly AgentProposalOp[]): readonly Executor[] | string => {
  const found: Executor[] = []
  for (const op of ops) {
    const executor = executorFor(op.tool)
    if (executor === undefined) return `Folio no longer knows how to apply ${op.tool}.`
    found.push(executor)
  }
  return found
}

const NO_SNAPSHOTS: ReadonlyMap<DocumentId, VersionId> = new Map()
const NO_EDITORS: ReadonlySet<DocumentId> = new Set()

const context = (
  gate: ToolGate,
  proposal: AgentProposalWithOps['proposal'],
  op: AgentProposalOp,
  digests: Map<DocumentId, string>,
  snapshots: ReadonlyMap<DocumentId, VersionId> = NO_SNAPSHOTS,
  editorDocuments: ReadonlySet<DocumentId> = NO_EDITORS,
): ExecContext => ({
  gate,
  runId: proposal.runId,
  proposalId: proposal.id,
  idempotencyKey: op.idempotencyKey,
  digests,
  snapshots,
  editorDocuments,
})

/** Apply a proposal as the gate's person. Never throws for a refusal or a failed operation - those are outcomes. */
export const applyProposalWith = async (
  gate: ToolGate,
  proposalId: AgentProposalId,
  options: {
    readonly confirmed: boolean
    /** Documents the writer has open (path A): their edits are handed back rather than saved. */
    readonly editorDocuments?: ReadonlySet<DocumentId>
  },
): Promise<ApplyOutcome> => {
  const { scope } = gate
  const editorDocuments = options.editorDocuments ?? NO_EDITORS
  const read = await readProposal(scope, proposalId)
  if (read === null) return { status: 'refused', message: NOT_FOUND }
  const { proposal, ops } = read
  if (proposal.status !== 'pending' || proposal.decidedAt !== null) return { status: 'decided', message: 'That proposal has already been decided.' }

  const executors = executorsOf(ops)
  if (typeof executors === 'string') return { status: 'refused', message: executors }
  if (!meetsRole(gate.role, requiredRole(executors))) return { status: 'refused', message: ROLE_REFUSED }
  const asks = proposal.needsConfirmation || ops.some((op) => needsConfirmation(op.mode))
  if (asks && !options.confirmed) return { status: 'needs-confirmation', message: 'This proposal needs your confirmation before it runs.' }

  if (!(await claimProposal(scope, proposal.id, gate.actor))) return { status: 'decided', message: 'That proposal has already been decided.' }

  // D10: a document the proposal was planned against has moved - stale, nothing written.
  const states = await Promise.all(proposal.base.documents.map((document) => readDocumentState(scope, document.documentId)))
  const moved = proposal.base.documents.some((document, index) => states[index]?.digest !== document.digest)
  if (moved) {
    await settleProposal(scope, proposal.id, 'stale', gate.actor)
    return settled(gate, proposal.id, 'stale', 'The script changed since this was proposed. Ask again and it will be planned against the new version.', null)
  }
  const digests = new Map<DocumentId, string>(proposal.base.documents.map((document) => [document.documentId, document.digest]))

  // D11: snapshot every document the proposal can touch, before anything runs.
  const touched = new Set<DocumentId>(proposal.base.documents.map((document) => document.documentId))
  for (const [index, op] of ops.entries()) {
    const executor = executors[index]
    if (executor === undefined) continue
    for (const id of await executor.documents(context(gate, proposal, op, digests), op.args)) touched.add(id)
  }
  const snapshots = new Map<DocumentId, VersionId>()
  for (const id of touched) {
    const state = await readDocumentState(scope, id)
    if (state === null) continue
    const version = await snapshotVersion(scope, id, 'before_agent_run', state.nodes, state.nodes.length, proposal.runId)
    snapshots.set(id, version.id)
  }

  const edits: EditorEdit[] = []
  let applied = 0
  const { value: failure, derived } = await withDeferredDerive(scope, async (): Promise<{ readonly at: number; readonly message: string; readonly stale: boolean } | null> => {
    for (const [index, op] of ops.entries()) {
      const executor = executors[index]
      if (executor === undefined) return { at: index, message: `${op.tool} could not run.`, stale: false }
      const ctx = context(gate, proposal, op, digests, snapshots, editorDocuments)
      let outcome
      try {
        // The undo record goes to the row before the action runs, so a crash
        // mid-operation still leaves the prior values where undo will look.
        const captured = await executor.capture(ctx, op.args)
        await markProposalOp(scope, op.id, { status: 'pending', undo: captured })
        outcome = await executor.run(ctx, op.args, captured)
        if (outcome.ok && outcome.deferred !== undefined) {
          // Path A: the open editor writes it. Pending, with its undo record, until the panel reports.
          await markProposalOp(scope, op.id, { status: 'pending', undo: outcome.undo === undefined ? captured : outcome.undo })
          edits.push({ opId: op.id, documentId: outcome.deferred.documentId, kind: outcome.deferred.kind, ops: outcome.deferred.ops, runId: proposal.runId })
          continue
        }
        if (outcome.ok) {
          applied += 1
          const undo = outcome.undo === undefined ? captured : outcome.undo
          await markProposalOp(scope, op.id, { status: 'applied', result: outcome.result, undo: executor.reversible ? undo : null })
          const target = executor.target(op.args)
          await logAgentActivity(scope, {
            verb: `agent:${op.tool}`,
            targetType: target.type,
            targetId: target.id,
            diff: { runId: proposal.runId, proposalId: proposal.id, opId: op.id, args: op.args, result: outcome.result },
          })
          continue
        }
      } catch (cause) {
        console.error({ event: 'folio.agent.op_threw', tool: op.tool, message: cause instanceof Error ? cause.message : String(cause) })
        outcome = { ok: false as const, message: `${op.tool} could not run.` }
      }
      await markProposalOp(scope, op.id, { status: 'failed', result: { message: outcome.message } })
      return { at: index, message: outcome.message, stale: outcome.stale === true }
    }
    return null
  })

  if (failure === null && edits.length > 0) {
    const current = await readProposal(scope, proposal.id)
    if (current === null) return { status: 'refused', message: NOT_FOUND }
    return { status: 'editor', proposal: current, edits, derived }
  }
  if (failure === null) {
    await settleProposal(scope, proposal.id, 'applied', gate.actor)
    return settled(gate, proposal.id, 'applied', null, derived)
  }
  await skipPendingOps(scope, proposal.id)
  const status: ApplyStatus = applied > 0 ? 'partially_applied' : failure.stale ? 'stale' : 'failed'
  await settleProposal(scope, proposal.id, status, gate.actor)
  return settled(gate, proposal.id, status, failure.message, derived)
}

const settled = async (gate: ToolGate, id: AgentProposalId, status: ApplyStatus, failure: string | null, derived: RederiveOutcome | null): Promise<ApplyOutcome> => {
  const proposal = await readProposal(gate.scope, id)
  if (proposal === null) return { status: 'refused', message: NOT_FOUND }
  return { status, proposal, failure, derived }
}

/** Say no. Only a pending, undecided proposal; nothing runs. */
export const rejectProposalWith = async (gate: ToolGate, proposalId: AgentProposalId): Promise<{ readonly status: 'rejected' } | { readonly status: 'decided' | 'refused'; readonly message: string }> => {
  const read = await readProposal(gate.scope, proposalId)
  if (read === null) return { status: 'refused', message: NOT_FOUND }
  if (!(await claimProposal(gate.scope, proposalId, gate.actor))) return { status: 'decided', message: 'That proposal has already been decided.' }
  await settleProposal(gate.scope, proposalId, 'rejected', gate.actor)
  return { status: 'rejected' }
}

/** What the open editor made of one handed-back edit. */
export type EditorReport = { readonly opId: string; readonly ok: boolean; readonly message?: string | undefined; readonly stale?: boolean | undefined }

/**
 * Settle a proposal whose document edits the open editor applied (D10 path
 * A). Only the person who claimed it, and only while it is still pending: the
 * operations the editor wrote become `applied` with the undo record apply
 * stored for them, an `agent:<tool>` activity row each; the first it could not
 * write stops the rest, as on the server.
 */
export const finishEditorApplyWith = async (gate: ToolGate, proposalId: AgentProposalId, reports: readonly EditorReport[]): Promise<ApplyOutcome> => {
  const { scope } = gate
  const read = await readProposal(scope, proposalId)
  if (read === null) return { status: 'refused', message: NOT_FOUND }
  const { proposal, ops } = read
  if (proposal.status !== 'pending' || proposal.decidedBy !== gate.actor) return { status: 'decided', message: 'That proposal has already been decided.' }
  const byOp = new Map(reports.map((report) => [report.opId, report]))
  let failure: EditorReport | null = null
  for (const op of ops) {
    if (op.status !== 'pending') continue
    const report = byOp.get(op.id)
    if (report === undefined) continue
    if (!report.ok) {
      failure = report
      await markProposalOp(scope, op.id, { status: 'failed', result: { message: report.message ?? 'The editor could not apply it.' } })
      break
    }
    await markProposalOp(scope, op.id, { status: 'applied', result: { appliedIn: 'editor' } })
    const executor = executorFor(op.tool)
    const target = executor?.target(op.args) ?? { type: op.tool, id: null }
    await logAgentActivity(scope, {
      verb: `agent:${op.tool}`,
      targetType: target.type,
      targetId: target.id,
      diff: { runId: proposal.runId, proposalId: proposal.id, opId: op.id, args: op.args, result: { appliedIn: 'editor' } },
    })
  }
  if (failure === null) {
    await settleProposal(scope, proposal.id, 'applied', gate.actor)
    return settled(gate, proposal.id, 'applied', null, null)
  }
  await skipPendingOps(scope, proposal.id)
  const after = await readProposal(scope, proposal.id)
  const landed = after?.ops.some((op) => op.status === 'applied') === true
  const status: ApplyStatus = landed ? 'partially_applied' : failure.stale === true ? 'stale' : 'failed'
  await settleProposal(scope, proposal.id, status, gate.actor)
  return settled(gate, proposal.id, status, failure.message ?? 'The editor could not apply it.', null)
}

/**
 * Give a claimed proposal back - apply stopped before any operation ran, for
 * a reason that is not the proposal's. Used by the editor path when the open
 * editor refuses the operations after the server said yes.
 */
export const releaseProposalWith = async (gate: ToolGate, proposalId: AgentProposalId): Promise<void> => {
  await releaseProposal(gate.scope, proposalId)
}

// ---------------------------------------------------------------------------
// Undo a run
// ---------------------------------------------------------------------------

/** The prefix undo's own inverse operations carry, so a second undo of the run never reverses its own undo. */
export const UNDO_KEY_PREFIX = 'undo:'

export type UndoSkip = { readonly tool: string; readonly description: string; readonly reason: string }

export type UndoOutcome =
  | {
      readonly status: 'undone' | 'partly-undone' | 'nothing-to-undo'
      /** How many operations were put back. */
      readonly undone: number
      /** Operations left as they are, and why - no inverse, or already undone. */
      readonly skipped: readonly UndoSkip[]
      /** The first inverse that failed, which stopped the undo. */
      readonly failure: { readonly tool: string; readonly message: string } | null
      /** A new pending proposal for targets that changed since the run. */
      readonly proposal: AgentProposalWithOps | null
      /** Why each of those targets was not simply put back. */
      readonly notes: readonly string[]
      readonly derived: RederiveOutcome | null
    }
  | { readonly status: 'refused'; readonly message: string }

const CANNOT = 'This cannot be undone.'

/**
 * Undo every applied operation of a run, newest first. `gate` is who is
 * undoing it; the run's own proposals are read from the gate's project, so a
 * run id from another project finds nothing.
 */
export const undoRunWith = async (gate: ToolGate, run: RunId): Promise<UndoOutcome> => {
  const { scope } = gate
  const proposals = await listRunProposals(scope, run)
  if (proposals.length === 0) return { status: 'refused', message: 'That run made no changes in this project.' }

  const applied = [...proposals]
    .reverse()
    .flatMap(({ proposal, ops }) => [...ops].reverse().map((op) => ({ proposal, op })))
    .filter(({ op }) => op.status === 'applied' && !op.idempotencyKey.startsWith(UNDO_KEY_PREFIX))

  const executors = applied.map(({ op }) => executorFor(op.tool))
  const required = requiredRole(executors.flatMap((executor) => (executor === undefined ? [] : [executor])))
  if (!meetsRole(gate.role, required)) return { status: 'refused', message: ROLE_REFUSED }

  const skipped: UndoSkip[] = []
  const inverse: { readonly op: InverseOp; readonly key: string }[] = []
  const bases = new Map<DocumentId, ProposalDocumentBase>()
  const notes: string[] = []
  let undone = 0

  const { value: failure, derived } = await withDeferredDerive(scope, async (): Promise<{ readonly tool: string; readonly message: string } | null> => {
    for (const [index, { proposal, op }] of applied.entries()) {
      const executor = executors[index]
      const description = executor?.describe(op.args) ?? op.tool
      if (executor === undefined || executor.invert === null || op.undo === null || op.undo === undefined) {
        skipped.push({ tool: op.tool, description, reason: CANNOT })
        continue
      }
      let outcome
      try {
        outcome = await executor.invert(context(gate, proposal, op, new Map()), op.args, op.undo, op.result)
      } catch (cause) {
        console.error({ event: 'folio.agent.undo_threw', tool: op.tool, message: cause instanceof Error ? cause.message : String(cause) })
        outcome = { kind: 'failed' as const, message: `${op.tool} could not be undone.` }
      }
      if (outcome.kind === 'failed') return { tool: op.tool, message: outcome.message }
      if (outcome.kind === 'changed') {
        notes.push(outcome.note)
        for (const [position, next] of outcome.ops.entries()) inverse.push({ op: next, key: `${UNDO_KEY_PREFIX}${op.id}:${String(position)}` })
        for (const document of proposal.base.documents) bases.set(document.documentId, document)
        continue
      }
      undone += 1
      await markProposalOp(scope, op.id, { status: 'undone' })
      const target = executor.target(op.args)
      await logAgentActivity(scope, {
        verb: 'agent:undo_run',
        targetType: target.type,
        targetId: target.id,
        diff: { runId: run, proposalId: proposal.id, opId: op.id, tool: op.tool, note: outcome.note ?? null },
      })
    }
    return null
  })

  let proposal: AgentProposalWithOps | null = null
  if (inverse.length > 0) {
    // The inverse operations were planned against the documents as they are
    // now, so the new proposal's base is their current digest, not the run's.
    const documents: ProposalDocumentBase[] = []
    for (const base of bases.values()) {
      const state = await readDocumentState(scope, base.documentId)
      if (state !== null) documents.push({ ...base, digest: state.digest })
    }
    const describe = (op: InverseOp): string => executorFor(op.tool)?.describe(op.args) ?? op.tool
    proposal = await createProposal(scope, {
      runId: run,
      episodeId: gate.episode.id,
      summary: summaryOf(`Put back what changed since the run: ${inverse.map(({ op }) => describe(op)).join('; ')}`),
      base: { documents },
      needsConfirmation: inverse.some(({ op }) => needsConfirmation(op.mode)),
      creditCost: null,
      ops: inverse.map(({ op, key }) => ({ tool: op.tool, args: op.args, mode: op.mode, idempotencyKey: key })),
    })
  }

  const status = failure !== null || proposal !== null ? 'partly-undone' : undone === 0 ? 'nothing-to-undo' : 'undone'
  return { status, undone, skipped, failure, proposal, notes, derived }
}

/** A summary line cut to the column's 500 characters. Written by code, never the model. */
export const summaryOf = (text: string): string => (text.length <= 500 ? text : `${text.slice(0, 497)}...`)
