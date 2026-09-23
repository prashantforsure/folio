import type { AgentProposal, AgentProposalOp, AgentProposalWithOps } from '@folio/contracts'
import { agentProposalId, agentProposalOpId, projectId } from '@folio/contracts'
import { runId } from '@folio/script'

/**
 * An in-memory stand-in for the proposal repositories (`agent-proposals.ts`),
 * for tests that drive `apply.ts` end to end without a database. Not a test
 * file: the vitest include pattern is `*.test.ts`. Each test's `vi.mock` of
 * `@folio/db` spreads `repository` over the real module.
 */

export type Row = { proposal: AgentProposal; ops: AgentProposalOp[] }

export const store = new Map<string, Row>()

const copy = (row: Row): AgentProposalWithOps => structuredClone({ proposal: row.proposal, ops: row.ops })

const PROJECT = projectId('6f1c4a3e-2b7d-4c1e-9a55-0d4f3b2a1c10')

let counter = 0
const uuid = (): string => {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

export const repository = {
  readProposal: (_scope: unknown, id: string) => Promise.resolve(store.has(id) ? copy(store.get(id) as Row) : null),
  listRunProposals: (_scope: unknown, run: string) => Promise.resolve([...store.values()].filter((row) => row.proposal.runId === run).map(copy)),
  claimProposal: (_scope: unknown, id: string, actor: string) => {
    const row = store.get(id)
    if (row === undefined || row.proposal.status !== 'pending' || row.proposal.decidedAt !== null) return Promise.resolve(false)
    row.proposal = { ...row.proposal, decidedAt: '2026-09-23T10:00:00.000Z', decidedBy: actor as AgentProposal['decidedBy'] }
    return Promise.resolve(true)
  },
  settleProposal: (_scope: unknown, id: string, status: AgentProposal['status']) => {
    const row = store.get(id)
    if (row !== undefined) row.proposal = { ...row.proposal, status }
    return Promise.resolve()
  },
  releaseProposal: () => Promise.resolve(),
  markProposalOp: (_scope: unknown, id: string, mark: { status: AgentProposalOp['status']; result?: unknown; undo?: unknown }) => {
    for (const row of store.values()) {
      row.ops = row.ops.map((op) =>
        op.id === id ? { ...op, status: mark.status, ...(mark.result === undefined ? {} : { result: mark.result }), ...(mark.undo === undefined ? {} : { undo: mark.undo }) } : op,
      )
    }
    return Promise.resolve()
  },
  skipPendingOps: (_scope: unknown, id: string) => {
    const row = store.get(id)
    if (row !== undefined) row.ops = row.ops.map((op) => (op.status === 'pending' ? { ...op, status: 'skipped' } : op))
    return Promise.resolve()
  },
  createProposal: (
    _scope: unknown,
    input: { runId: string; episodeId: string | null; summary: string; base: AgentProposal['base']; needsConfirmation: boolean; creditCost: number | null; ops: readonly { tool: string; args: unknown; mode: AgentProposalOp['mode']; idempotencyKey: string }[] },
  ) => {
    const id = uuid()
    const row: Row = {
      proposal: proposalRow(id, { runId: runId(input.runId), summary: input.summary, base: input.base, needsConfirmation: input.needsConfirmation, creditCost: input.creditCost }),
      ops: input.ops.map((op, seq) => opRow(uuid(), id, seq, op.tool, structuredClone(op.args), op.mode, op.idempotencyKey)),
    }
    store.set(id, row)
    return Promise.resolve(copy(row))
  },
  readProposalOpByKey: (_scope: unknown, key: string) => {
    for (const row of store.values()) {
      const op = row.ops.find((entry) => entry.idempotencyKey === key)
      if (op !== undefined) return Promise.resolve(structuredClone(op))
    }
    return Promise.resolve(null)
  },
}

export const RUN = runId('0b8e2d4c-1a3f-4e5d-8c7b-9a6f5e4d3c21')

export function proposalRow(id: string, over: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: agentProposalId(id),
    projectId: PROJECT,
    runId: RUN,
    episodeId: null,
    status: 'pending',
    summary: 'Test proposal',
    base: { documents: [] },
    needsConfirmation: false,
    creditCost: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-09-23T09:00:00.000Z',
    updatedAt: '2026-09-23T09:00:00.000Z',
    ...over,
  }
}

export function opRow(id: string, proposal: string, seq: number, tool: string, args: unknown, mode: AgentProposalOp['mode'] = 'propose', key = `toolu_${id}`): AgentProposalOp {
  return { id: agentProposalOpId(id), projectId: PROJECT, proposalId: agentProposalId(proposal), seq, tool, args, mode, idempotencyKey: key, status: 'pending', result: null, undo: null, appliedAt: null }
}

/** Seed one proposal with the given operations; returns its id. */
export const seedProposal = (ops: readonly { tool: string; args: unknown; mode?: AgentProposalOp['mode'] }[], over: Partial<AgentProposal> = {}): string => {
  const id = uuid()
  store.set(id, { proposal: proposalRow(id, over), ops: ops.map((op, seq) => opRow(uuid(), id, seq, op.tool, op.args, op.mode ?? 'propose')) })
  return id
}
