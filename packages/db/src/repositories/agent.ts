import type { AgentRun, AgentRunMode, AgentRunStatus, AssistantChatId, AssistantMessageId, BackgroundRunInput, EpisodeId, RunCheckpoint, UserId } from '@folio/contracts'
import { assistantChatId, assistantMessageId, episodeId as brandEpisodeId, projectId as brandProjectId } from '@folio/contracts'
import type { RunId } from '@folio/script'
import { runId as brandRunId } from '@folio/script'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { agentRunStages, agentRuns, assistantChats, assistantMessages, jobs } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * `agent_runs` - one row per agent task (roadmap task 2.1, ADR 0003 **D3**).
 *
 * The row is three things at once: the run's status, the D3 token meter, and
 * the id an agent-written node will carry as `provenance_run_id` (D11). Every
 * function here takes a `ProjectScope` except the daily sum, which is the one
 * question that crosses projects - see `tokensTodayFor`.
 *
 * ## Statement count
 *
 * A turn writes this row three times at most: created, started (with the
 * message that started it), finished. Tokens are added with the finish, or
 * once per model step when a caller wants the meter live mid-run; each is one
 * statement, and none is read back before it is written.
 */

const when = (value: Date | null): string | null => (value === null ? null : stamp(value))

const toRun = (row: typeof agentRuns.$inferSelect): AgentRun => ({
  id: brandRunId(row.id),
  projectId: brandProjectId(row.projectId),
  episodeId: row.episodeId === null ? null : brandEpisodeId(row.episodeId),
  chatId: row.chatId === null ? null : assistantChatId(row.chatId),
  messageId: row.messageId === null ? null : assistantMessageId(row.messageId),
  createdBy: row.createdBy as UserId,
  status: row.status,
  mode: row.mode,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  creditBudget: row.creditBudget,
  creditsSpent: row.creditsSpent,
  error: row.error,
  createdAt: stamp(row.createdAt),
  startedAt: when(row.startedAt),
  finishedAt: when(row.finishedAt),
})

export type NewAgentRun = {
  readonly episodeId: EpisodeId | null
  readonly chatId: AssistantChatId | null
  readonly mode: AgentRunMode
}

/** A queued run. The credit budget is the column default, 0 (D3) - nothing here can raise it. */
export const createAgentRun = async (scope: ProjectScope, input: NewAgentRun): Promise<AgentRun> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: an agent run needs an actor.')
  const inserted = await dbOf(scope)
    .insert(agentRuns)
    .values({ ...tenant(scope), episodeId: input.episodeId, chatId: input.chatId, mode: input.mode, createdBy: actor })
    .returning()
  const row = inserted[0]
  if (row === undefined) throw new Error('Folio: inserting an agent run returned no row.')
  return toRun(row)
}

/** `running`, stamped, with the writer's message that started it. */
export const startAgentRun = async (scope: ProjectScope, id: RunId, messageId: AssistantMessageId | null): Promise<void> => {
  await dbOf(scope)
    .update(agentRuns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date(), ...(messageId === null ? {} : { messageId }) })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
}

/**
 * Add one model call's usage. An increment, not a set, so two writers (a step
 * and the finish) cannot overwrite each other's count.
 */
export const addAgentRunTokens = async (scope: ProjectScope, id: RunId, input: number, output: number): Promise<void> => {
  if (input === 0 && output === 0) return
  await dbOf(scope)
    .update(agentRuns)
    .set({
      inputTokens: sql`${agentRuns.inputTokens} + ${Math.max(0, Math.round(input))}`,
      outputTokens: sql`${agentRuns.outputTokens} + ${Math.max(0, Math.round(output))}`,
      updatedAt: new Date(),
    })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
}

// ---------------------------------------------------------------------------
// The credit budget (ADR 0003 D3, roadmap task 5.1)
// ---------------------------------------------------------------------------

/**
 * Grant a run credits - the one way its budget rises, and only from a
 * confirmation a person gave (`apps/web/lib/agent/apply.ts`, when a paid
 * proposal is confirmed): the budget starts at 0 and rises by exactly what the
 * confirmation named. An increment, so two confirmations in one run add up
 * rather than overwrite.
 */
export const grantRunBudget = async (scope: ProjectScope, id: RunId, credits: number): Promise<void> => {
  if (credits <= 0) return
  await dbOf(scope)
    .update(agentRuns)
    .set({ creditBudget: sql`${agentRuns.creditBudget} + ${Math.round(credits)}`, updatedAt: new Date() })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
}

/**
 * Spend from what the run was granted, in one conditional statement: refused
 * (false) when it would take `credits_spent` past `credit_budget` - the same
 * bound `agent_runs_budget` checks, asked first so a refusal is an answer and
 * not a constraint error. A paid operation spends before it starts its work.
 */
export const spendRunBudget = async (scope: ProjectScope, id: RunId, credits: number): Promise<boolean> => {
  if (credits <= 0) return true
  const rows = await dbOf(scope)
    .update(agentRuns)
    .set({ creditsSpent: sql`${agentRuns.creditsSpent} + ${Math.round(credits)}`, updatedAt: new Date() })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id), sql`${agentRuns.creditsSpent} + ${Math.round(credits)} <= ${agentRuns.creditBudget}`))
    .returning({ id: agentRuns.id })
  return rows.length > 0
}

/** Give back a spend whose work never started - refused by the ledger, a limit, or a missing target. Never below zero. */
export const returnRunBudget = async (scope: ProjectScope, id: RunId, credits: number): Promise<void> => {
  if (credits <= 0) return
  await dbOf(scope)
    .update(agentRuns)
    .set({ creditsSpent: sql`greatest(0, ${agentRuns.creditsSpent} - ${Math.round(credits)})`, updatedAt: new Date() })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
}

/** A terminal status (or `waiting_for_user`), stamped. `error` is the reason in the writer's terms. */
export const finishAgentRun = async (
  scope: ProjectScope,
  id: RunId,
  status: Exclude<AgentRunStatus, 'queued' | 'running'>,
  error: string | null,
): Promise<void> => {
  const now = new Date()
  await dbOf(scope)
    .update(agentRuns)
    .set({ status, error, updatedAt: now, ...(status === 'waiting_for_user' ? {} : { finishedAt: now }) })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
}

export const readAgentRun = async (scope: ProjectScope, id: RunId): Promise<AgentRun | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentRuns)
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toRun(row)
}

/** The project's runs, newest first; one chat's when `chatId` is given. */
export const listAgentRuns = async (
  scope: ProjectScope,
  options: { readonly chatId?: AssistantChatId; readonly limit?: number } = {},
): Promise<readonly AgentRun[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentRuns)
    .where(scoped(scope, agentRuns, ...(options.chatId === undefined ? [] : [eq(agentRuns.chatId, options.chatId)])))
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.max(1, Math.min(options.limit ?? 20, 100)))
  return rows.map(toRun)
}

/**
 * Every token this person's runs have used since midnight UTC, across all of
 * their projects - the meter the D3 daily cap reads
 * (`apps/web/lib/agent/limits.ts`, `DAILY_TOKENS_PER_USER`).
 *
 * A raw `FolioDatabase` rather than a `ProjectScope`, on `readCreditsFor`'s
 * reasoning (`users.ts`): the cap is per user, not per project, so a scoped
 * sum would let a writer reset it by opening a second project. It reads only
 * the caller's own rows (`created_by`), which is the whole of its reach. The
 * day is the database's, `date_trunc('day', now())`, so two web processes
 * with different clocks agree on when it turns over.
 */
export const tokensTodayFor = async (db: FolioDatabase, userId: UserId): Promise<number> => {
  const rows = await db
    .select({ used: sql<number>`coalesce(sum(${agentRuns.inputTokens} + ${agentRuns.outputTokens}), 0)::int` })
    .from(agentRuns)
    .where(and(eq(agentRuns.createdBy, userId), gte(agentRuns.createdAt, sql`date_trunc('day', now())`)))
  return rows[0]?.used ?? 0
}

// ---------------------------------------------------------------------------
// Background runs (roadmap task 4.4, ADR 0003 D4/D5/D14)
// ---------------------------------------------------------------------------

/** A background run and what it was asked to do (`agent_runs.input`, `0037`), unparsed - the caller holds the schema. */
export type BackgroundRunRow = { readonly run: AgentRun; readonly input: unknown }

export const readBackgroundRun = async (scope: ProjectScope, id: RunId): Promise<BackgroundRunRow | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentRuns)
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.mode, 'background')))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : { run: toRun(row), input: row.input }
}

/** The background run that works in this chat, if it is one's - the newest, should a chat ever hold two. */
export const readChatRun = async (scope: ProjectScope, chatId: AssistantChatId): Promise<AgentRun | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentRuns)
    .where(scoped(scope, agentRuns, eq(agentRuns.chatId, chatId), eq(agentRuns.mode, 'background')))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toRun(row)
}

/**
 * The statuses D14's concurrency limit counts: a run that is working or about
 * to. A run waiting for the writer holds nothing and is not counted.
 */
const LIVE: readonly AgentRunStatus[] = ['queued', 'running']

type Tx = Parameters<Parameters<FolioDatabase['transaction']>[0]>[0]

/**
 * Serialise the project's run starts for the rest of the transaction, then
 * count its live background runs - the lock is what makes "count, then
 * insert" safe against a second start at the same moment.
 */
const liveBackgroundRuns = async (tx: Tx, scope: ProjectScope): Promise<number> => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent_runs:${scope.projectId as string}`}))`)
  const rows = await tx
    .select({ live: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(scoped(scope, agentRuns, eq(agentRuns.mode, 'background'), inArray(agentRuns.status, [...LIVE])))
  return rows[0]?.live ?? 0
}

const queueRunJob = async (tx: Tx, scope: ProjectScope, runId: string): Promise<void> => {
  await tx.insert(jobs).values({ ...tenant(scope), kind: 'agent_run', status: 'queued', cost: 0, payload: { runId }, createdBy: scope.actor })
}

export type StartBackgroundRunResult =
  | { readonly status: 'started'; readonly runId: RunId; readonly chatId: AssistantChatId }
  /** D14: the project already has `limit` background runs working. */
  | { readonly status: 'busy'; readonly live: number }

/**
 * Start a background run, in one transaction: a chat of its own titled by the
 * task, the brief as that chat's first message, the `agent_runs` row
 * (`background`, `queued`, its input) and the `agent_run` job the worker
 * claims. Refused as `busy` when the project already has `limit` live.
 */
export const startBackgroundRun = async (
  scope: ProjectScope,
  start: { readonly episodeId: EpisodeId; readonly title: string; readonly brief: string; readonly input: BackgroundRunInput; readonly limit: number },
): Promise<StartBackgroundRunResult> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: a background run needs an actor.')
  return dbOf(scope).transaction(async (tx) => {
    const live = await liveBackgroundRuns(tx, scope)
    if (live >= start.limit) return { status: 'busy', live }
    const [chat] = await tx.insert(assistantChats).values({ ...tenant(scope), episodeId: start.episodeId, title: start.title, createdBy: actor }).returning({ id: assistantChats.id })
    if (chat === undefined) throw new Error('Folio: inserting a run chat returned no row.')
    const [run] = await tx
      .insert(agentRuns)
      .values({ ...tenant(scope), episodeId: start.episodeId, chatId: chat.id, mode: 'background', status: 'queued', input: start.input, createdBy: actor })
      .returning({ id: agentRuns.id })
    if (run === undefined) throw new Error('Folio: inserting a background run returned no row.')
    const [message] = await tx
      .insert(assistantMessages)
      .values({ ...tenant(scope), chatId: chat.id, role: 'user', body: start.brief, runId: run.id })
      .returning({ id: assistantMessages.id })
    if (message === undefined) throw new Error('Folio: inserting a run brief returned no row.')
    await tx.update(agentRuns).set({ messageId: message.id }).where(scoped(scope, agentRuns, eq(agentRuns.id, run.id)))
    await queueRunJob(tx, scope, run.id)
    return { status: 'started', runId: brandRunId(run.id), chatId: assistantChatId(chat.id) }
  })
}

export type ContinueBackgroundRunResult =
  | { readonly status: 'queued' }
  | { readonly status: 'busy'; readonly live: number }
  /** Only a run waiting for the writer takes a reply. */
  | { readonly status: 'not-waiting'; readonly current: AgentRunStatus }
  /** An approval, and the stage it names is not waiting at its checkpoint - nothing was written. */
  | { readonly status: 'no-checkpoint' }
  | { readonly status: 'no-run' }

/**
 * The writer's reply to a run waiting for them, in one transaction: the reply
 * appended to the run's chat, the run queued again, and a new `agent_run` job.
 * The worker resumes from the transcript, which now ends with the reply.
 */
export const continueBackgroundRun = async (
  scope: ProjectScope,
  id: RunId,
  reply: string,
  limit: number,
  /** A checkpoint the writer approved - a story's or a production run's: moved from `waiting` to `approved` in this transaction, or nothing is written. */
  approve: RunCheckpoint | null = null,
): Promise<ContinueBackgroundRunResult> =>
  dbOf(scope).transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(agentRuns)
      .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.mode, 'background')))
      .for('update')
      .limit(1)
    const row = rows[0]
    if (row === undefined || row.chatId === null) return { status: 'no-run' }
    if (row.status !== 'waiting_for_user') return { status: 'not-waiting', current: row.status }
    const live = await liveBackgroundRuns(tx, scope)
    if (live >= limit) return { status: 'busy', live }
    // Approved with the job that carries on from it, so an approval that could not queue approves nothing.
    if (approve !== null) {
      const approved = await tx
        .update(agentRunStages)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(scoped(scope, agentRunStages, eq(agentRunStages.runId, row.id), eq(agentRunStages.stage, approve), eq(agentRunStages.status, 'waiting')))
        .returning({ stage: agentRunStages.stage })
      if (approved.length === 0) return { status: 'no-checkpoint' }
    }
    await tx.insert(assistantMessages).values({ ...tenant(scope), chatId: row.chatId, role: 'user', body: reply, runId: row.id })
    await tx.update(assistantChats).set({ updatedAt: new Date() }).where(scoped(scope, assistantChats, eq(assistantChats.id, row.chatId)))
    await tx.update(agentRuns).set({ status: 'queued', error: null, updatedAt: new Date() }).where(scoped(scope, agentRuns, eq(agentRuns.id, row.id)))
    await queueRunJob(tx, scope, row.id)
    return { status: 'queued' }
  })

export type CancelBackgroundRunResult = { readonly status: 'cancelled' } | { readonly status: 'already-over' } | { readonly status: 'no-run' }

/**
 * Stop a background run, in one transaction. The run is `cancelled` at once,
 * whatever it was doing - the worker reads the status before every step and
 * never settles a run that is no longer `running` - and its job is cancelled
 * if it is still queued, or asked to stop if it is running, which the worker
 * hears on its next heartbeat and aborts the model call in flight.
 */
export const cancelBackgroundRun = async (scope: ProjectScope, id: RunId): Promise<CancelBackgroundRunResult> =>
  dbOf(scope).transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(agentRuns)
      .set({ status: 'cancelled', finishedAt: now, updatedAt: now })
      .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.mode, 'background'), inArray(agentRuns.status, ['queued', 'running', 'waiting_for_user'])))
      .returning({ id: agentRuns.id })
    if (row === undefined) {
      const exists = await tx
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.mode, 'background')))
        .limit(1)
      return { status: exists.length === 0 ? 'no-run' : 'already-over' }
    }
    await tx.execute(sql`
      update ${jobs}
      set cancel_requested_at = coalesce(${jobs.cancelRequestedAt}, now()),
          status = case when ${jobs.status} = 'queued' then 'cancelled'::job_status else ${jobs.status} end,
          finished_at = case when ${jobs.status} = 'queued' then now() else ${jobs.finishedAt} end
      where ${jobs.projectId} = ${scope.projectId as string} and ${jobs.kind} = 'agent_run'
        and ${jobs.payload} ->> 'runId' = ${id as string} and ${jobs.status} in ('queued', 'running')
    `)
    return { status: 'cancelled' }
  })

/**
 * Take a background run's job: `running`, stamped the first time. False when
 * the run is no longer queued or running - cancelled, or already settled - and
 * the job has nothing to do.
 */
export const beginBackgroundRun = async (scope: ProjectScope, id: RunId): Promise<boolean> => {
  const now = new Date()
  const rows = await dbOf(scope)
    .update(agentRuns)
    .set({ status: 'running', startedAt: sql`coalesce(${agentRuns.startedAt}, now())`, updatedAt: now })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.mode, 'background'), inArray(agentRuns.status, [...LIVE])))
    .returning({ id: agentRuns.id })
  return rows.length > 0
}

/**
 * Where a job left its run: finished, failed, or waiting for the writer. Only
 * a run still `running` is settled, so a cancel that landed mid-step is never
 * overwritten by the step's own ending. False when nothing was written.
 */
export const settleBackgroundRun = async (
  scope: ProjectScope,
  id: RunId,
  status: 'succeeded' | 'failed' | 'waiting_for_user' | 'cancelled',
  error: string | null,
): Promise<boolean> => {
  const now = new Date()
  const rows = await dbOf(scope)
    .update(agentRuns)
    .set({ status, error, updatedAt: now, ...(status === 'waiting_for_user' ? {} : { finishedAt: now }) })
    .where(scoped(scope, agentRuns, eq(agentRuns.id, id), eq(agentRuns.status, 'running')))
    .returning({ id: agentRuns.id })
  return rows.length > 0
}

/** How far a background run has got: its model steps so far (one stored model message each), for the run card. */
export const countRunSteps = async (scope: ProjectScope, id: RunId): Promise<number> => {
  const rows = await dbOf(scope)
    .select({ steps: sql<number>`count(*)::int` })
    .from(assistantMessages)
    .where(scoped(scope, assistantMessages, eq(assistantMessages.runId, id), eq(assistantMessages.role, 'assistant')))
  return rows[0]?.steps ?? 0
}

/**
 * The project's runs, newest first, each with its input - the panel's run
 * history (roadmap task 5.4): a background run's title is in its input, a
 * turn's is the message that started it. One statement.
 */
export const listRunsWithInput = async (scope: ProjectScope, limit = 30): Promise<readonly BackgroundRunRow[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(agentRuns)
    .where(scoped(scope, agentRuns))
    .orderBy(desc(agentRuns.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)))
  return rows.map((row) => ({ run: toRun(row), input: row.input }))
}
