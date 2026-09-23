import type { StoryStage, StoryStageStatus } from '@folio/contracts'
import type { RunId } from '@folio/script'
import { eq, sql } from 'drizzle-orm'

import { agentRunStages } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * `agent_run_stages` - a story-to-script run's output, a row per stage
 * (roadmap task 4.5, migration `0038`). The caller parses each output with its
 * contract (`StageOutputSchemas`) before it writes one and after it reads one;
 * here it is jsonb in and `unknown` out, as `agent_runs.input` is.
 */

export type RunStage = { readonly stage: StoryStage; readonly status: StoryStageStatus; readonly output: unknown }

/** Every stage the run has reached, by stage. */
export const readRunStages = async (scope: ProjectScope, runId: RunId): Promise<ReadonlyMap<StoryStage, RunStage>> => {
  const rows = await dbOf(scope)
    .select({ stage: agentRunStages.stage, status: agentRunStages.status, output: agentRunStages.output })
    .from(agentRunStages)
    .where(scoped(scope, agentRunStages, eq(agentRunStages.runId, runId)))
  return new Map(rows.map((row) => [row.stage, row]))
}

/** Store a stage's output and where it stands - one statement, the row made or replaced. */
export const saveRunStage = async (scope: ProjectScope, runId: RunId, stage: StoryStage, status: StoryStageStatus, output: unknown): Promise<void> => {
  await dbOf(scope)
    .insert(agentRunStages)
    .values({ ...tenant(scope), runId, stage, status, output })
    .onConflictDoUpdate({
      target: [agentRunStages.runId, agentRunStages.stage],
      set: { status, output, updatedAt: sql`now()` },
    })
}

/** Move a stage's status without touching its output - a checkpoint approved. */
export const setRunStageStatus = async (scope: ProjectScope, runId: RunId, stage: StoryStage, status: StoryStageStatus): Promise<void> => {
  await dbOf(scope)
    .update(agentRunStages)
    .set({ status, updatedAt: new Date() })
    .where(scoped(scope, agentRunStages, eq(agentRunStages.runId, runId), eq(agentRunStages.stage, stage)))
}
