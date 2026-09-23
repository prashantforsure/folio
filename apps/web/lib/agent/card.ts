import type { AgentOpMode, AgentOpStatus, AgentProposalStatus, AgentProposalWithOps, NavigateTarget } from '@folio/contracts'
import { needsConfirmation } from '@folio/contracts'
import { readBalance } from '@folio/db'

import type { DiffView, RecordChange } from './diff-view'
import { executorFor } from './executors'
import type { ToolGate } from './registry'
import { resolveTarget } from './targets'

/**
 * A proposal as the panel's card draws it (roadmap task 3.3): the summary,
 * each operation in plain language, record changes as before and after,
 * document changes as hunks, where Open goes, and - for a proposal that asks
 * first - the reason, the cost and the balance the cost would come out of.
 *
 * Built on the server, from the executors' own `describe` and `preview`, so
 * the words on the card are code's and every number is read, never the
 * model's (AGENTS.md ruling R4).
 */

export type ProposalCardOp = {
  readonly id: string
  readonly tool: string
  readonly description: string
  readonly status: AgentOpStatus
  readonly mode: AgentOpMode
  /** Whether "undo this run" can put it back. Said before it is applied, so nobody learns it afterwards. */
  readonly reversible: boolean
  /** Why it failed, in the writer's terms. */
  readonly failure: string | null
  readonly changes: readonly RecordChange[]
  readonly diff: DiffView | null
  readonly open: NavigateTarget | null
}

export type ProposalCard = {
  readonly id: string
  readonly runId: string
  readonly status: AgentProposalStatus
  readonly summary: string
  readonly needsConfirmation: boolean
  /** Credits it would spend; null when it spends none. */
  readonly creditCost: number | null
  /** Credits available now - read only when the card asks for a confirmation. */
  readonly balance: number | null
  /** Why it asks first: each confirm or paid operation's description. */
  readonly confirmReasons: readonly string[]
  readonly ops: readonly ProposalCardOp[]
  /** The documents it edits - the panel checks which are open in an editor (D10 path A). */
  readonly documents: readonly string[]
}

const failureOf = (result: unknown): string | null =>
  typeof result === 'object' && result !== null && 'message' in result && typeof result.message === 'string' ? result.message : null

export const buildProposalCard = async (gate: ToolGate, { proposal, ops }: AgentProposalWithOps): Promise<ProposalCard> => {
  const scratch = new Map<string, unknown>()
  const rows: ProposalCardOp[] = []
  // In order: a preview may read what the previous one left in `scratch`.
  for (const op of ops) {
    const executor = executorFor(op.tool)
    const preview = executor === undefined ? {} : await executor.preview({ gate, runId: proposal.runId, scratch }, op.args, op)
    const open = preview.open === undefined ? null : await resolveTarget(gate, preview.open)
    rows.push({
      id: op.id,
      tool: op.tool,
      description: executor?.describe(op.args) ?? op.tool,
      status: op.status,
      mode: op.mode,
      reversible: executor !== undefined && executor.reversible(op.args) && (op.status === 'pending' || (op.undo !== null && op.undo !== undefined)),
      failure: op.status === 'failed' ? (failureOf(op.result) ?? 'It could not run.') : null,
      changes: preview.changes ?? [],
      diff: preview.diff ?? null,
      open: open !== null && open.ok ? open.target : null,
    })
  }
  const asks = proposal.needsConfirmation || ops.some((op) => needsConfirmation(op.mode))
  const balance = asks && proposal.status === 'pending' ? (await readBalance(gate.scope)).available : null
  return {
    id: proposal.id,
    runId: proposal.runId,
    status: proposal.status,
    summary: proposal.summary,
    needsConfirmation: asks,
    creditCost: proposal.creditCost,
    balance,
    confirmReasons: rows.filter((row) => needsConfirmation(row.mode)).map((row) => row.description),
    ops: rows,
    documents: proposal.base.documents.map((document) => document.documentId),
  }
}
