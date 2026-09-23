import type { AgentProposal, AgentRun, AgentRunStatus } from '@folio/contracts'
import { BackgroundRunInputSchema, RunIdSchema } from '@folio/contracts'
import { cancelBackgroundRun, continueBackgroundRun, countRunSteps, listRunProposals, readBackgroundRun } from '@folio/db'
import type { RunId } from '@folio/script'

import { meetsRole } from '../auth/roles'
import type { GateRefusal, ProjectGate } from '../script/actor-gate'
import { CONCURRENT_RUNS_PER_PROJECT } from './limits'
import { checkRateLimit } from './rate-limit'
import type { RateLimited } from './rate-limit'

/**
 * A background run as the panel sees it - roadmap task 4.4, ADR 0003 **D7**:
 * the card polls `readRunViewWith` every two seconds while the run is live,
 * and its two buttons are `cancelRunWith` and `continueRunWith`. Core
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
export const runViewOf = (run: AgentRun, input: unknown, proposals: readonly ProposalFacts[], steps: number, viewer: ProjectGate['actor']): RunView => ({
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
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
})

const readRun = async (gate: ProjectGate, rawRun: unknown): Promise<{ readonly id: RunId; readonly view: RunView } | null> => {
  const id = RunIdSchema.safeParse(rawRun)
  if (!id.success) return null
  const row = await readBackgroundRun(gate.scope, id.data)
  if (row === null) return null
  const [proposals, steps] = await Promise.all([listRunProposals(gate.scope, id.data), countRunSteps(gate.scope, id.data)])
  return { id: id.data, view: runViewOf(row.run, row.input, proposals, steps, gate.actor) }
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
  const limited = await checkRateLimit(gate.scope, gate.actor, 'assistant')
  if (limited !== null) return limited
  const words = typeof rawReply === 'string' && rawReply.trim().length > 0 ? rawReply.trim().slice(0, 4_000) : DEFAULT_REPLY
  const note = continuationNote(await listRunProposals(gate.scope, read.id))
  const continued = await continueBackgroundRun(gate.scope, read.id, note === null ? words : `${note}\n\n${words}`, CONCURRENT_RUNS_PER_PROJECT)
  if (continued.status === 'busy') {
    return { status: 'refused', message: `This project already has ${String(continued.live)} background runs working, which is the limit. Wait for one to finish, or cancel one.` }
  }
  if (continued.status !== 'queued') return { status: 'refused', message: 'This run is not waiting for a reply.' }
  const after = await readRun(gate, read.id)
  return after === null ? NOT_FOUND : { status: 'ok', run: after.view }
}
