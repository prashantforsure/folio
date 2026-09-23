import type { AgentEvent, AgentStopReason } from '@folio/contracts'
import { BackgroundRunInputSchema, RunIdSchema } from '@folio/contracts'
import type { ClaimedJob, JobOutcome, ProjectScope } from '@folio/db'
import {
  addAgentRunTokens,
  appendMessage,
  beginBackgroundRun,
  listCharacterRecords,
  listMessages,
  openProjectForWorker,
  readAgentAutonomy,
  readAgentRun,
  readBackgroundRun,
  readEpisode,
  readMentionLabels,
  sessionDatabase,
  settleBackgroundRun,
  tokensTodayFor,
} from '@folio/db'
import type { RunId } from '@folio/script'
import { z } from 'zod'

import { BACKGROUND_NOTE } from '../assistant/context'
import { ASSISTANT_MODEL, MAX_OUTPUT_TOKENS } from '../assistant/model'
import { turnSystem } from '../assistant/turn-context'
import { ROLE } from '../auth/roles'
import { isRefusal, openEpisodeAs } from '../script/actor-gate'
import { runDetached } from '../script/server'
import { BACKGROUND_MAX_STEPS, DAILY_TOKENS_PER_USER } from './limits'
import type { ModelClient, StepCheck } from './loop'
import { runAgentLoop } from './loop'
import { proposalSink } from './proposer'
import type { Tool } from './registry'
import { resumeOf } from './replay'
import { runStoryJob } from './story/pipeline'
import './tools'

/**
 * A background run, one job at a time - roadmap task 4.4, ADR 0003 **D4**,
 * **D5**, **D7**.
 *
 * `start_background_task` writes the run, its chat, its brief and an
 * `agent_run` job in one transaction (`startBackgroundRun`); the worker claims
 * the job and calls this. A job runs the run **until it needs the writer or is
 * done**, then settles it and ends; the writer's reply is a new job
 * (`continueBackgroundRun`). So a run is never held in memory between jobs -
 * the transcript is the run:
 *
 *   **Resumed from its transcript.** Every model message and every step's
 *   results are stored before the next step starts (the loop's
 *   `recordMessage`). A job starts by reading the chat back (`resumeOf`): the
 *   brief or the writer's reply is picked up from; calls a dead worker left
 *   unanswered are answered first, with their own ids, so a write already
 *   proposed is found again rather than proposed twice (D13, and the sink's
 *   replay checks); a last word with no call means the run had finished and
 *   only its status was lost.
 *
 *   **The same loop and registry as a turn**, through the actor gates (task
 *   4.2), as the person who started it (D4). Before every step `beforeStep`
 *   re-reads the run - a cancel stops it there - and re-opens the gate, so a
 *   writer removed from the project stops the run and one demoted to reader
 *   stops being able to propose; the step's tools run with the role read then.
 *
 *   **It stops for the writer** (`waiting_for_user`) when a step writes a
 *   proposal only they can confirm, when it reaches `BACKGROUND_MAX_STEPS`
 *   (after a summary), and when the D3 daily token allowance runs out. Their
 *   reply carries it on. A `propose` proposal does not stop it: it waits for
 *   review, as it would in a turn, and a document edit is never applied here -
 *   there is no open editor on the worker, so under `auto` it still waits.
 *
 * ## What the job answers
 *
 * The run's status is the record; the job's is the queue's. Done or waiting is
 * a `finished` job, a cancel a `cancelled` one, a refusal or an error a
 * `failed` one. A **transient** model error (a rate limit, an overload, a lost
 * connection) throws instead, so the runtime retries the job - the run stays
 * `running` and the next claim resumes it; after three attempts the handler's
 * `abandon` fails it as interrupted. A shutdown or a lost lease writes nothing
 * at all: the runtime puts the job back, and the next claim resumes it.
 */

export type BackgroundDeps = {
  /** The model, or null when this worker has no `ANTHROPIC_API_KEY`. */
  readonly client: ModelClient | null
  readonly maxSteps?: number
}

export const NOT_CONNECTED = 'The assistant is not connected on the worker. Set ANTHROPIC_API_KEY there.'

export const INTERRUPTED = 'Interrupted: the run stopped three times without finishing. Nothing it proposed is lost.'

const PayloadSchema = z.object({ runId: RunIdSchema })

/** The tools a run with no panel has no use for: the client tools, and starting another background run (or the story pipeline) from inside one. */
export const offeredInBackground = (tool: Tool): boolean => tool.mode !== 'client' && tool.name !== 'start_background_task' && tool.name !== 'story_to_script'

/** Why the run waits for the writer, as the run card says it. */
const WAITING: Readonly<Partial<Record<AgentStopReason, string>>> = {
  confirmation: 'Waiting for you to confirm a proposal. Confirm or reject it, then reply to carry on.',
  step_cap: `Paused after ${String(BACKGROUND_MAX_STEPS)} steps. Reply to carry on.`,
  time_cap: 'Paused. Reply to carry on.',
  token_cap: "Paused: today's assistant allowance is used. It resets at midnight UTC.",
}

const ignore = (_event: AgentEvent): void => undefined

export const runBackgroundJob = async (job: ClaimedJob, signal: AbortSignal, deps: BackgroundDeps): Promise<JobOutcome> => {
  const payload = PayloadSchema.safeParse(job.payload)
  if (!payload.success) return { status: 'failed', error: 'The job names no run.' }
  const runId = payload.data.runId
  const scope = await openProjectForWorker(job.projectId, job.createdBy)
  const row = await readBackgroundRun(scope, runId)
  if (row === null) return { status: 'failed', error: 'The run is gone.' }
  if (row.run.status === 'cancelled') return { status: 'cancelled' }
  // Settled or waiting: an old job with nothing to do.
  if (!(await beginBackgroundRun(scope, runId))) {
    const now = await readAgentRun(scope, runId)
    return now?.status === 'cancelled' ? { status: 'cancelled' } : { status: 'finished' }
  }

  const settle = async (status: 'succeeded' | 'failed' | 'waiting_for_user' | 'cancelled', message: string | null): Promise<JobOutcome> => {
    await settleBackgroundRun(scope, runId, status, message)
    if (status === 'failed') return { status: 'failed', error: message ?? 'The run failed.' }
    return status === 'cancelled' ? { status: 'cancelled' } : { status: 'finished' }
  }

  const { run } = row
  const input = BackgroundRunInputSchema.safeParse(row.input)
  if (!input.success) return settle('failed', 'The run’s task did not read.')
  const chatId = run.chatId
  const episode = run.episodeId === null ? null : await readEpisode(scope, run.episodeId)
  if (chatId === null || episode === null) return settle('failed', 'The run’s chat or episode is gone.')

  const open = () => openEpisodeAs(run.createdBy, job.projectId, episode.slug, ROLE.assistant, 'session')
  const first = await open()
  if (isRefusal(first)) return settle('failed', first.message)
  if (deps.client === null) return settle('failed', NOT_CONNECTED)

  const accountDb = await sessionDatabase()
  const [used, autonomy] = await Promise.all([tokensTodayFor(accountDb, run.createdBy), readAgentAutonomy(accountDb, run.createdBy)])
  const tokenBudget = DAILY_TOKENS_PER_USER - used
  const say = async (body: string): Promise<void> => {
    await appendMessage(scope, chatId, 'assistant', body, { runId })
  }
  if (tokenBudget <= 0) return settle('waiting_for_user', WAITING.token_cap ?? null)

  // The story pipeline (roadmap task 4.5) runs its stages; a task runs the loop.
  if (input.data.kind === 'story_to_script') {
    return runStoryJob({ scope, runId, chatId, episode, open, client: deps.client, signal, autonomy, tokenBudget, say, settle }, input.data)
  }
  const task = input.data

  const resume = resumeOf(await listMessages(scope, chatId))
  if (resume.finished) return settle('succeeded', null)

  const [labels, records] = await Promise.all([readMentionLabels(scope), listCharacterRecords(scope)])
  const system = [
    ...(await turnSystem(first, { labels, records }, {
      scope: task.scope,
      route: task.route,
      ...(task.route === 'locations' ? { places: true } : {}),
      ...(task.route === 'timeline' ? { timeline: true } : {}),
    })),
    { type: 'text' as const, text: BACKGROUND_NOTE },
  ]

  const beforeStep = async (): Promise<StepCheck> => {
    const now = await readAgentRun(scope, runId)
    if (now === null || now.status !== 'running') return { ok: false, reason: 'cancelled', message: 'The run was cancelled.' }
    const gate = await open()
    if (isRefusal(gate)) return { ok: false, reason: 'refused', message: gate.message }
    return { ok: true, gate, proposals: proposalSink(gate, runId, autonomy, runDetached) }
  }

  const outcome = await runAgentLoop({
    client: deps.client,
    model: ASSISTANT_MODEL,
    maxTokens: MAX_OUTPUT_TOKENS,
    system,
    messages: resume.messages,
    pending: resume.pending,
    route: task.route,
    context: { gate: first, runId, emit: ignore },
    beforeStep,
    pauseOnConfirmation: true,
    offer: offeredInBackground,
    emit: ignore,
    signal,
    tokenBudget,
    maxSteps: deps.maxSteps ?? BACKGROUND_MAX_STEPS,
    maxMs: Number.POSITIVE_INFINITY,
    recordTokens: (input, output) => addAgentRunTokens(scope, runId, input, output),
    recordMessage: async (role, body, content) => {
      await appendMessage(scope, chatId, role, body, { content, runId })
    },
  })

  switch (outcome.stopReason) {
    case 'aborted':
      // A shutdown or a lost lease: write nothing - the runtime puts the job back and the next claim resumes it.
      if (signal.aborted && signal.reason !== 'cancel') return { status: 'failed', error: 'Stopped by the worker.' }
      return settle('cancelled', null)
    case 'error':
      if (outcome.transient === true) throw new Error(outcome.unsaved.trim() || 'The model could not be reached.')
      if (outcome.unsaved.trim().length > 0) await say(outcome.unsaved.trim())
      return settle('failed', outcome.stopMessage ?? 'The run could not go on.')
    case 'end_turn':
    case 'refusal':
      if (outcome.unsaved.trim().length > 0) await say(outcome.unsaved.trim())
      return settle('succeeded', null)
    case 'confirmation':
    case 'step_cap':
    case 'time_cap':
    case 'token_cap':
      return settle('waiting_for_user', WAITING[outcome.stopReason] ?? null)
  }
}

/** Failed without finishing (the stale sweep's third attempt, or three throws): the run is interrupted. */
export const abandonBackgroundJob = async (job: ClaimedJob): Promise<void> => {
  const payload = PayloadSchema.safeParse(job.payload)
  if (!payload.success) return
  const scope: ProjectScope = await openProjectForWorker(job.projectId, job.createdBy)
  await settleBackgroundRun(scope, payload.data.runId as RunId, 'failed', INTERRUPTED)
}
