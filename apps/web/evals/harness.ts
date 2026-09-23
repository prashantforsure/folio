import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { StoryToScriptInput } from '@folio/contracts'
import { STORY_CHECKPOINTS, StageOutputSchemas } from '@folio/contracts'
import type { JobOutcome } from '@folio/db'
import {
  addAgentRunTokens,
  beginBackgroundRun,
  createAgentRun,
  createChat,
  createProjectFor,
  listBoundCues,
  listRunProposals,
  openProjectForWorker,
  readAgentRun,
  readDocumentByKind,
  readRunStages,
  readScreenplayNodes,
  readUserIdByEmail,
  sessionDatabase,
  setRunStageStatus,
} from '@folio/db'
import type { RunId, ScreenplayNode } from '@folio/script'
import { serialiseFountain } from '@folio/script'

import { applyProposalWith } from '../lib/agent/apply'
import type { ModelClient } from '../lib/agent/loop'
import { runStoryJob } from '../lib/agent/story/pipeline'
import { structured } from '../lib/agent/story/structured'
import { ASSISTANT_MODEL } from '../lib/assistant/model'
import { ROLE } from '../lib/auth/roles'
import { isRefusal, openEpisodeAs } from '../lib/script/actor-gate'
import { runDetached } from '../lib/script/server'
import type { Fixture } from './fixtures'
import type { StoryResult } from './report'
import { JUDGE_SYSTEM, JudgeSchema, craftRules, judgePrompt, verifiedSpots } from './rubric'
import type { CraftRule } from './rubric'
import { scoreStructure } from './structural'

/**
 * The eval harness - roadmap task 5.5, ADR 0003 **D19** (in the repository,
 * run on demand, never in CI: it calls a model, costs money, and is not
 * deterministic).
 *
 * For each fixture story it makes a **scratch project** in the database the
 * environment points at, owned by the eval account (`EVAL_USER_EMAIL`), named
 * `eval · <id> · <time>` so a person can find and open every draft, and runs
 * `story_to_script` there: the real pipeline (`runStoryJob`), the real model,
 * the real proposals. It plays the writer who says yes to everything - at
 * each stop it applies every pending proposal in order (the batches are
 * chained, so order is the plan's) and approves the checkpoint it stopped at
 * - until the run finishes or `MAX_JOBS` jobs have run. It runs the jobs
 * in-process rather than queueing them, so a worker on the same database never
 * picks one up; the run's status is left `running` between jobs for that
 * reason (`settle` only records).
 *
 * Then it scores the script the writer would have: the structural checks
 * (`structural.ts`, code) and the craft rubric (`rubric.ts`, a forced tool
 * call to the assistant's model), and the report (`report.ts`) says both.
 *
 * Scratch projects are kept: deleting user data is on AGENTS.md's ask-first
 * list, and the drafts are what a person reviewing the report reads.
 */

/** Jobs one story may take before the harness gives up on it. A thin story takes about eight. */
export const MAX_JOBS = 40

/** Tokens one story may spend - the daily allowance's size, since the eval account is a person's. */
export const STORY_TOKENS = 2_000_000

export type EvalDeps = {
  readonly client: ModelClient
  readonly userEmail: string
  readonly now?: () => Date
  readonly log?: (line: string) => void
}

const repoRoot = (): string => join(process.cwd(), '..', '..')

/** The craft rules, read from the file the pipeline writes to. */
export const readCraftRules = async (): Promise<readonly CraftRule[]> => craftRules(await readFile(join(repoRoot(), 'docs', 'agents', 'craft.md'), 'utf8'))

const scriptNodes = async (scope: Parameters<typeof readDocumentByKind>[0], episodeId: Parameters<typeof readDocumentByKind>[1]): Promise<readonly ScreenplayNode[]> => {
  const document = await readDocumentByKind(scope, episodeId, 'screenplay')
  if (document === null) return []
  const read = await readScreenplayNodes(scope, document.id)
  return read.ok ? read.value.map((entry) => entry.node) : []
}

export const runStoryEval = async (fixture: Fixture, rules: readonly CraftRule[], deps: EvalDeps): Promise<StoryResult> => {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => undefined)
  const started = now()
  const db = await sessionDatabase()
  const user = await readUserIdByEmail(db, deps.userEmail)
  if (user === null) throw new Error(`No Folio account for ${deps.userEmail}. Sign up in the app first, then run the evals as it.`)

  const { project, episode } = await createProjectFor(db, user, {
    title: `eval · ${fixture.id} · ${started.toISOString().slice(0, 16)}`,
    kind: 'screenwriting',
    projectType: fixture.projectType,
    format: 'hollywood',
    logline: null,
  })
  const scope = await openProjectForWorker(project.id, user)
  const chat = await createChat(scope, episode.id)
  const run = await createAgentRun(scope, { episodeId: episode.id, chatId: chat.id, mode: 'background' })
  const runId = run.id as RunId
  await beginBackgroundRun(scope, runId)
  const open = () => openEpisodeAs(user, project.id, episode.slug, ROLE.assistant, 'session')
  const input: StoryToScriptInput = { kind: 'story_to_script', title: fixture.title, story: fixture.story }
  const signal = new AbortController().signal

  let outcome: 'done' | 'stopped' = 'stopped'
  let message: string | null = `It did not finish in ${String(MAX_JOBS)} jobs.`
  let jobs = 0
  for (; jobs < MAX_JOBS; ) {
    jobs += 1
    // A box, not a let: TypeScript would narrow a let assigned in the callback to its initial null.
    const settled: { value: { readonly status: string; readonly message: string | null } | null } = { value: null }
    const used = (await readAgentRun(scope, runId)) ?? run
    await runStoryJob(
      {
        scope,
        runId,
        chatId: chat.id,
        episode,
        open,
        client: deps.client,
        signal,
        autonomy: 'review',
        tokenBudget: STORY_TOKENS - (used.inputTokens + used.outputTokens),
        say: (body) => {
          log(`  ${fixture.id}: ${body.split('\n')[0] ?? ''}`)
          return Promise.resolve()
        },
        // Recorded, not written: the run stays `running`, so no worker is ever handed it.
        settle: (status, why): Promise<JobOutcome> => {
          settled.value = { status, message: why }
          return Promise.resolve(status === 'failed' ? { status: 'failed', error: why ?? '' } : { status: 'finished' })
        },
      },
      input,
    )
    const last = settled.value
    if (last === null) {
      message = 'The job ended without settling the run.'
      break
    }
    if (last.status === 'succeeded') {
      outcome = 'done'
      message = null
      break
    }
    if (last.status !== 'waiting_for_user') {
      message = last.message ?? `The run ${last.status}.`
      break
    }
    // The writer who says yes: every pending proposal applied in order, the checkpoint approved.
    const gate = await open()
    if (isRefusal(gate)) {
      message = gate.message
      break
    }
    for (const { proposal } of await listRunProposals(scope, runId)) {
      if (proposal.status !== 'pending') continue
      const applied = await applyProposalWith(gate, proposal.id, { confirmed: true, schedule: runDetached })
      log(`  ${fixture.id}: applied "${proposal.summary.slice(0, 60)}" - ${applied.status}`)
    }
    const stages = await readRunStages(scope, runId)
    for (const stage of STORY_CHECKPOINTS) if (stages.get(stage)?.status === 'waiting') await setRunStageStatus(scope, runId, stage, 'approved')
  }

  const [nodes, cues, stages, meter] = await Promise.all([scriptNodes(scope, episode.id), listBoundCues(scope), readRunStages(scope, runId), readAgentRun(scope, runId)])
  const planned = StageOutputSchemas.scenes.safeParse(stages.get('scenes')?.output)
  const brief = StageOutputSchemas.expand.safeParse(stages.get('expand')?.output)
  const structural = nodes.length === 0 ? null : scoreStructure(nodes, cues.map((entry) => entry.cue), planned.success ? planned.data.list.scenes.length : null)

  let judgement: StoryResult['judgement'] = null
  let dropped = 0
  if (nodes.length > 0) {
    const script = serialiseFountain(nodes.filter((node) => node.type !== 'comment')).text
    let judged = 0
    const spend = {
      record: async (tokensIn: number, tokensOut: number) => {
        judged += tokensIn + tokensOut
        await addAgentRunTokens(scope, runId, tokensIn, tokensOut)
      },
      left: () => STORY_TOKENS - judged,
    }
    const scored = await structured(deps.client, signal, spend, { name: 'submit_scores', description: 'The draft scored against the craft rules.', schema: JudgeSchema, system: JUDGE_SYSTEM, prompt: judgePrompt(rules, fixture.story, script) })
    if (scored.ok) {
      const spots = verifiedSpots(scored.value.weakSpots, script)
      judgement = { ...scored.value, weakSpots: spots.kept }
      dropped = spots.dropped
    } else {
      message = `${message === null ? '' : `${message} `}The judge could not score it: ${scored.message}`
    }
  }

  return {
    fixture,
    outcome,
    message,
    jobs,
    tokens: (meter?.inputTokens ?? 0) + (meter?.outputTokens ?? 0),
    seconds: (now().getTime() - started.getTime()) / 1000,
    logline: brief.success ? brief.data.brief.logline : null,
    assumptions: brief.success ? brief.data.brief.assumptions : [],
    structural,
    judgement,
    droppedQuotes: dropped,
    projectId: project.id,
  }
}

export { ASSISTANT_MODEL }
