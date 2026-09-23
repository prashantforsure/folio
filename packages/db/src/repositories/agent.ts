import type { AgentRun, AgentRunMode, AgentRunStatus, AssistantChatId, AssistantMessageId, EpisodeId, UserId } from '@folio/contracts'
import { assistantChatId, assistantMessageId, episodeId as brandEpisodeId, projectId as brandProjectId } from '@folio/contracts'
import type { RunId } from '@folio/script'
import { runId as brandRunId } from '@folio/script'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { agentRuns } from '../schema'
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
