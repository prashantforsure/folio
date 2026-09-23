import type { AgentProposal, AgentRun, AgentRunStatus, StoryCheckpoint } from '@folio/contracts'
import { BackgroundRunInputSchema, RunIdSchema, STORY_CHECKPOINTS } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { cancelBackgroundRun, continueBackgroundRun, countRunSteps, listRunProposals, readBackgroundRun, readRunStages } from '@folio/db'
import type { RunId } from '@folio/script'

import { meetsRole } from '../auth/roles'
import type { GateRefusal, ProjectGate } from '../script/actor-gate'
import { CONCURRENT_RUNS_PER_PROJECT } from './limits'
import { checkRateLimit } from './rate-limit'
import type { RateLimited } from './rate-limit'

/**
 * A background run as the panel sees it - roadmap task 4.4, ADR 0003 **D7**:
 * the card polls `readRunViewWith` every two seconds while the run is live,
 * and its buttons are `cancelRunWith` and, at a story checkpoint,
 * `approveRunWith`; the composer replies through `continueRunWith`. Core
 * functions over a project gate, as every other (task 4.2); the actions in
 * `actions.ts` are their cookie-gated doors.
 *
 * **Who may do what.** A run acts as the person who started it (D4), so only
 * they may reply to it - a reply is an instruction it carries out as them. A
 * cancel only stops it, so an owner may cancel anyone's too. Anyone who can
 * read the project can watch it.
 */

export type RunView = {
  readonly id: string
  readonly chatId: string | null
  readonly title: string
  readonly status: AgentRunStatus
  /** Why it waits, or why it failed, in the writer's terms. */
  readonly note: string | null
  /** Model steps so far. */
  readonly steps: number
  readonly proposals: {
    readonly pending: number
    readonly applied: number
    /** Pending proposals only the writer can confirm - what a paused run waits on. */
    readonly toConfirm: number
  }
  readonly mine: boolean
  /**
   * The story checkpoint the run waits at (A, C or D of `story_to_script`), or
   * null. Only the card's **Approve** moves a checkpoint on: a reply with words
   * asks the stage again, and an empty one does nothing.
   */
  readonly checkpoint: StoryCheckpoint | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
}

export type RunViewResult = { readonly status: 'ok'; readonly run: RunView } | GateRefusal

/** What the card and the reply note read of a proposal - nothing more. */
export type ProposalFacts = { readonly proposal: Pick<AgentProposal, 'status' | 'needsConfirmation' | 'summary'> }

const NOT_FOUND: GateRefusal = { status: 'refused', message: 'That run could not be found.' }

const titleOf = (input: unknown): string => {
  const parsed = BackgroundRunInputSchema.safeParse(input)
  return parsed.success ? parsed.data.title : 'Background run'
}

/** The card's figures, from the run, its proposals and its step count. */
export const runViewOf = (
  run: AgentRun,
  input: unknown,
  proposals: readonly ProposalFacts[],
  steps: number,
  viewer: ProjectGate['actor'],
  checkpoint: StoryCheckpoint | null = null,
): RunView => ({
  id: run.id,
  chatId: run.chatId,
  title: titleOf(input),
  status: run.status,
  note: run.error,
  steps,
  proposals: {
    pending: proposals.filter((entry) => entry.proposal.status === 'pending').length,
    applied: proposals.filter((entry) => entry.proposal.status === 'applied' || entry.proposal.status === 'partially_applied').length,
    toConfirm: proposals.filter((entry) => entry.proposal.status === 'pending' && entry.proposal.needsConfirmation).length,
  },
  mine: run.createdBy === viewer,
  checkpoint,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
})

/** The story checkpoint a waiting `story_to_script` run stopped at - the one of A, C, D whose stage is `waiting` - or null. */
export const storyCheckpointOf = async (scope: ProjectScope, run: Pick<AgentRun, 'id' | 'status'>, input: unknown): Promise<StoryCheckpoint | null> => {
  if (run.status !== 'waiting_for_user') return null
  const parsed = BackgroundRunInputSchema.safeParse(input)
  if (!parsed.success || parsed.data.kind !== 'story_to_script') return null
  const stages = await readRunStages(scope, run.id as RunId)
  return STORY_CHECKPOINTS.find((stage) => stages.get(stage)?.status === 'waiting') ?? null
}

const readRun = async (gate: ProjectGate, rawRun: unknown): Promise<{ readonly id: RunId; readonly view: RunView } | null> => {
  const id = RunIdSchema.safeParse(rawRun)
  if (!id.success) return null
  const row = await readBackgroundRun(gate.scope, id.data)
  if (row === null) return null
  const [proposals, steps, checkpoint] = await Promise.all([
    listRunProposals(gate.scope, id.data),
    countRunSteps(gate.scope, id.data),
    storyCheckpointOf(gate.scope, row.run, row.input),
  ])
  return { id: id.data, view: runViewOf(row.run, row.input, proposals, steps, gate.actor, checkpoint) }
}

export const readRunViewWith = async (gate: ProjectGate, rawRun: unknown): Promise<RunViewResult> => {
  const read = await readRun(gate, rawRun)
  return read === null ? NOT_FOUND : { status: 'ok', run: read.view }
}

export type RunActionResult = { readonly status: 'ok'; readonly run: RunView } | GateRefusal | RateLimited

/** Stop a run. Its starter's, or an owner's. */
export const cancelRunWith = async (gate: ProjectGate, rawRun: unknown): Promise<RunActionResult> => {
  const read = await readRun(gate, rawRun)
  if (read === null) return NOT_FOUND
  if (!read.view.mine && !meetsRole(gate.role, 'owner')) return { status: 'refused', message: 'Only the person who started this run, or the project’s owner, can stop it.' }
  await cancelBackgroundRun(gate.scope, read.id)
  const after = await readRun(gate, read.id)
  return after === null ? NOT_FOUND : { status: 'ok', run: after.view }
}

/** What a paused run is told about its proposals, in code's words, before the writer's own. */
export const continuationNote = (proposals: readonly ProposalFacts[]): string | null => {
  const asked = proposals.filter((entry) => entry.proposal.needsConfirmation)
  if (asked.length === 0) return null
  const said = asked.map((entry) => {
    const status = entry.proposal.status === 'pending' ? 'is still waiting' : entry.proposal.status === 'rejected' ? 'was rejected' : `was ${entry.proposal.status.replace('_', ' ')}`
    return `"${entry.proposal.summary}" ${status}`
  })
  return `[Folio: since the run paused, ${said.join('; ')}.]`
}

export const DEFAULT_REPLY = 'Carry on.'

/** What the run's chat records when the writer presses Approve at a checkpoint. */
export const APPROVE_REPLY = 'Approved.'

/** An empty reply at a checkpoint: it does nothing, and says what would. */
export const CHECKPOINT_NEEDS_WORDS = 'Write what to change, or press Approve to carry on.'

const busyMessage = (live: number): string => `This project already has ${String(live)} background runs working, which is the limit. Wait for one to finish, or cancel one.`

/**
 * Reply to a run waiting for the writer: their words, after a note of what
 * became of the proposals it paused on, and a new job. Its starter's only -
 * the run carries the reply out as them.
 */
export const continueRunWith = async (gate: ProjectGate, rawRun: unknown, rawReply: unknown): Promise<RunActionResult> => {
  const read = await readRun(gate, rawRun)
  if (read === null) return NOT_FOUND
  if (!read.view.mine) return { status: 'refused', message: 'Only the person who started this run can reply to it. It acts as them.' }
  if (read.view.status !== 'waiting_for_user') return { status: 'refused', message: 'This run is not waiting for a reply.' }
  const typed = typeof rawReply === 'string' && rawReply.trim().length > 0 ? rawReply.trim().slice(0, 4_000) : null
  // At a checkpoint an empty reply is not an approval (pre-deploy fixes, 2026-09-24): nothing is queued.
  if (typed === null && read.view.checkpoint !== null) return { status: 'refused', message: CHECKPOINT_NEEDS_WORDS }
  const limited = await checkRateLimit(gate.scope, gate.actor, 'assistant')
  if (limited !== null) return limited
  const words = typed ?? DEFAULT_REPLY
  const note = continuationNote(await listRunProposals(gate.scope, read.id))
  const continued = await continueBackgroundRun(gate.scope, read.id, note === null ? words : `${note}\n\n${words}`, CONCURRENT_RUNS_PER_PROJECT)
  if (continued.status === 'busy') return { status: 'refused', message: busyMessage(continued.live) }
  if (continued.status !== 'queued') return { status: 'refused', message: 'This run is not waiting for a reply.' }
  const after = await readRun(gate, read.id)
  return after === null ? NOT_FOUND : { status: 'ok', run: after.view }
}

/**
 * Approve the story checkpoint a run waits at, and carry on. The starter's
 * alone, as a reply is. The stage is marked `approved` in the transaction that
 * queues the next job (`continueBackgroundRun`), so the pipeline reads the
 * approval from the stage and never from the words in the chat.
 */
export const approveRunWith = async (gate: ProjectGate, rawRun: unknown): Promise<RunActionResult> => {
  const read = await readRun(gate, rawRun)
  if (read === null) return NOT_FOUND
  if (!read.view.mine) return { status: 'refused', message: 'Only the person who started this run can approve it. It acts as them.' }
  if (read.view.status !== 'waiting_for_user' || read.view.checkpoint === null) return { status: 'refused', message: 'This run is not waiting at a checkpoint.' }
  const limited = await checkRateLimit(gate.scope, gate.actor, 'assistant')
  if (limited !== null) return limited
  const note = continuationNote(await listRunProposals(gate.scope, read.id))
  const body = note === null ? APPROVE_REPLY : `${note}\n\n${APPROVE_REPLY}`
  const continued = await continueBackgroundRun(gate.scope, read.id, body, CONCURRENT_RUNS_PER_PROJECT, read.view.checkpoint)
  if (continued.status === 'busy') return { status: 'refused', message: busyMessage(continued.live) }
  if (continued.status !== 'queued') return { status: 'refused', message: 'This run is not waiting at a checkpoint.' }
  const after = await readRun(gate, read.id)
  return after === null ? NOT_FOUND : { status: 'ok', run: after.view }
}
