import type {
  AgentOpMode,
  AgentOpStatus,
  AgentProposal,
  AgentProposalId,
  AgentProposalOp,
  AgentProposalOpId,
  AgentProposalStatus,
  AgentProposalWithOps,
  EpisodeId,
  ProposalBase,
  UserId,
} from '@folio/contracts'
import { ProposalBaseSchema, agentProposalId, agentProposalOpId, episodeId as brandEpisodeId, projectId as brandProjectId } from '@folio/contracts'
import type { RunId } from '@folio/script'
import { runId as brandRunId } from '@folio/script'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { activityLog, agentProposalOps, agentProposals } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'
import { stamp } from './mapping'

/**
 * `agent_proposals` and `agent_proposal_ops` - roadmap task 3.1, ADR 0003
 * **D1**, **D11**. Every function takes a `ProjectScope`.
 *
 * A proposal and its operations are written in one transaction, so there is
 * never a proposal the card could draw with half its operations. After that
 * the rows change in three ways only: a decision is **claimed** (one writer
 * wins a double click), each operation is **marked** as it runs, and the
 * proposal's status is **settled** when apply stops.
 *
 * ## Never read as the script
 *
 * Nothing in here answers what a document says. A proposal is a pending
 * intention, readable only as itself (ADR 0003's closing section).
 */

const when = (value: Date | null): string | null => (value === null ? null : stamp(value))

/** The stored base, read back through its schema; a row that does not parse is an empty base rather than a throw. */
const baseOf = (value: unknown): ProposalBase => {
  const parsed = ProposalBaseSchema.safeParse(value)
  return parsed.success ? parsed.data : { documents: [] }
}

const toProposal = (row: typeof agentProposals.$inferSelect): AgentProposal => ({
  id: agentProposalId(row.id),
  projectId: brandProjectId(row.projectId),
  runId: brandRunId(row.runId),
  episodeId: row.episodeId === null ? null : brandEpisodeId(row.episodeId),
  status: row.status,
  summary: row.summary,
  base: baseOf(row.base),
  needsConfirmation: row.needsConfirmation,
  creditCost: row.creditCost,
  decidedBy: row.decidedBy === null ? null : (row.decidedBy as UserId),
  decidedAt: when(row.decidedAt),
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

const toOp = (row: typeof agentProposalOps.$inferSelect): AgentProposalOp => ({
  id: agentProposalOpId(row.id),
  projectId: brandProjectId(row.projectId),
  proposalId: agentProposalId(row.proposalId),
  seq: row.seq,
  tool: row.tool,
  args: row.args,
  mode: row.mode,
  idempotencyKey: row.idempotencyKey,
  status: row.status,
  result: row.result,
  undo: row.undo,
  appliedAt: when(row.appliedAt),
})

export type NewProposalOp = {
  readonly tool: string
  readonly args: unknown
  readonly mode: AgentOpMode
  readonly idempotencyKey: string
}

export type NewProposal = {
  readonly runId: RunId
  readonly episodeId: EpisodeId | null
  readonly summary: string
  readonly base: ProposalBase
  readonly needsConfirmation: boolean
  readonly creditCost: number | null
  readonly ops: readonly NewProposalOp[]
}

/** A proposal and its operations, in one transaction. The operations take `seq` from their order here. */
export const createProposal = async (scope: ProjectScope, input: NewProposal): Promise<AgentProposalWithOps> => {
  if (input.ops.length === 0) throw new Error('Folio: a proposal needs at least one operation.')
  return dbOf(scope).transaction(async (tx) => {
    const inserted = await tx
      .insert(agentProposals)
      .values({
        ...tenant(scope),
        runId: input.runId,
        episodeId: input.episodeId,
        summary: input.summary,
        base: input.base,
        needsConfirmation: input.needsConfirmation,
        creditCost: input.creditCost,
      })
      .returning()
    const proposal = inserted[0]
    if (proposal === undefined) throw new Error('Folio: inserting a proposal returned no row.')
    const ops = await tx
      .insert(agentProposalOps)
      .values(
        input.ops.map((op, seq) => ({
          ...tenant(scope),
          proposalId: proposal.id,
          seq,
          tool: op.tool,
          args: jsonb(op.args),
          mode: op.mode,
          idempotencyKey: op.idempotencyKey,
        })),
      )
      .returning()
    return { proposal: toProposal(proposal), ops: ops.map(toOp).sort((a, b) => a.seq - b.seq) }
  })
}

const opsOf = async (scope: ProjectScope, ids: readonly string[]): Promise<ReadonlyMap<string, AgentProposalOp[]>> => {
  const byProposal = new Map<string, AgentProposalOp[]>()
  if (ids.length === 0) return byProposal
  const rows = await dbOf(scope)
    .select()
    .from(agentProposalOps)
    .where(scoped(scope, agentProposalOps, inArray(agentProposalOps.proposalId, [...ids])))
    .orderBy(asc(agentProposalOps.seq))
  for (const row of rows) {
    const list = byProposal.get(row.proposalId) ?? []
    list.push(toOp(row))
    byProposal.set(row.proposalId, list)
  }
  return byProposal
}

/** One proposal with its operations, or null - including for another project's id. */
export const readProposal = async (scope: ProjectScope, id: AgentProposalId): Promise<AgentProposalWithOps | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentProposals)
    .where(scoped(scope, agentProposals, eq(agentProposals.id, id)))
    .limit(1)
  const row = rows[0]
  if (row === undefined) return null
  const ops = await opsOf(scope, [row.id])
  return { proposal: toProposal(row), ops: ops.get(row.id) ?? [] }
}

/** Every proposal a run made, oldest first, each with its operations. What "undo this run" walks. */
export const listRunProposals = async (scope: ProjectScope, run: RunId): Promise<readonly AgentProposalWithOps[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentProposals)
    .where(scoped(scope, agentProposals, eq(agentProposals.runId, run)))
    .orderBy(asc(agentProposals.createdAt))
  const ops = await opsOf(
    scope,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({ proposal: toProposal(row), ops: ops.get(row.id) ?? [] }))
}

/** The operation a tool call already made, by its key - a replayed call finds it rather than proposing twice. */
export const readProposalOpByKey = async (scope: ProjectScope, key: string): Promise<AgentProposalOp | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentProposalOps)
    .where(scoped(scope, agentProposalOps, eq(agentProposalOps.idempotencyKey, key)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toOp(row)
}

/**
 * Claim the decision on a pending proposal: stamp who decided and when, only
 * if nobody has. One statement, so of two clicks exactly one gets `true` - the
 * second finds `decided_at` already set. The status stays `pending` until
 * `settleProposal`; the stamp is the lock.
 */
export const claimProposal = async (scope: ProjectScope, id: AgentProposalId, actor: UserId): Promise<boolean> => {
  const now = new Date()
  const rows = await dbOf(scope)
    .update(agentProposals)
    .set({ decidedBy: actor, decidedAt: now, updatedAt: now })
    .where(scoped(scope, agentProposals, eq(agentProposals.id, id), eq(agentProposals.status, 'pending'), isNull(agentProposals.decidedAt)))
    .returning({ id: agentProposals.id })
  return rows.length === 1
}

/** A proposal's final status - applied, rejected, stale, failed, partially applied. */
export const settleProposal = async (scope: ProjectScope, id: AgentProposalId, status: AgentProposalStatus, actor: UserId | null): Promise<void> => {
  const now = new Date()
  await dbOf(scope)
    .update(agentProposals)
    .set({ status, updatedAt: now, ...(actor === null ? {} : { decidedBy: actor, decidedAt: now }) })
    .where(scoped(scope, agentProposals, eq(agentProposals.id, id)))
}

/**
 * Release a claim without deciding - apply stopped before any operation ran
 * for a reason that is not the proposal's (the gate refused, the network went).
 * The proposal is pending and undecided again.
 */
export const releaseProposal = async (scope: ProjectScope, id: AgentProposalId): Promise<void> => {
  await dbOf(scope)
    .update(agentProposals)
    .set({ decidedBy: null, decidedAt: null, updatedAt: new Date() })
    .where(scoped(scope, agentProposals, eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
}

export type OpMark = {
  readonly status: AgentOpStatus
  readonly result?: unknown
  readonly undo?: unknown
}

/** Record where one operation got to: its status and, when given, its result and undo record. */
export const markProposalOp = async (scope: ProjectScope, id: AgentProposalOpId, mark: OpMark): Promise<void> => {
  await dbOf(scope)
    .update(agentProposalOps)
    .set({
      status: mark.status,
      ...(mark.result === undefined ? {} : { result: jsonb(mark.result) }),
      ...(mark.undo === undefined ? {} : { undo: jsonb(mark.undo) }),
      ...(mark.status === 'applied' ? { appliedAt: new Date() } : {}),
    })
    .where(scoped(scope, agentProposalOps, eq(agentProposalOps.id, id)))
}

/** Mark every operation of a proposal still `pending` as `skipped` - what apply does after the first failure. */
export const skipPendingOps = async (scope: ProjectScope, proposal: AgentProposalId): Promise<void> => {
  await dbOf(scope)
    .update(agentProposalOps)
    .set({ status: 'skipped' })
    .where(scoped(scope, agentProposalOps, and(eq(agentProposalOps.proposalId, proposal), eq(agentProposalOps.status, 'pending'))))
}

export type AgentActivity = {
  readonly verb: string
  readonly targetType: string
  readonly targetId: string | null
  readonly diff: unknown
}

/**
 * One `activity_log` row for one applied agent operation (ADR 0003 **D11**).
 * The verb is `agent:<tool>`; the diff names the run, the proposal and what
 * changed. The actor is the scope's - the person the run acts as (D4).
 */
export const logAgentActivity = async (scope: ProjectScope, entry: AgentActivity): Promise<void> => {
  await dbOf(scope)
    .insert(activityLog)
    .values({ ...tenant(scope), actorId: scope.actor, verb: entry.verb, targetType: entry.targetType, targetId: entry.targetId, diff: jsonb(entry.diff) })
}
