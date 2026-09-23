'use server'

import { AgentProposalIdSchema, RunIdSchema } from '@folio/contracts'
import type { AgentProposalId, EpisodeId } from '@folio/contracts'
import { readAgentRun, readEpisode, readProposal } from '@folio/db'

import { ROLE } from '../auth/roles'
import { isRefusal, openProject } from '../script/gate'
import { DocumentIdSchema } from '@folio/contracts'
import { after } from 'next/server'
import { z } from 'zod'

import type { ApplyOutcome, UndoOutcome } from './apply'
import { applyProposalWith, finishEditorApplyWith, rejectProposalWith, undoRunWith } from './apply'
import type { ProposalCard } from './card'
import type { RunActionResult, RunViewResult } from './runs'
import { approveRunWith, cancelRunWith, continueRunWith, readRunViewWith } from './runs'
import { buildProposalCard } from './card'
import './tools'
import type { ToolGate } from './registry'

/**
 * The panel's buttons on a proposal - roadmap task 3.2 - and on a background
 * run (task 4.4, at the foot). Apply, Reject and
 * Undo run, each behind the project gate and each re-reading the proposal from
 * the gate's own scope, so an id from another project is not found rather than
 * refused (no existence oracle).
 *
 * The gate asks only for membership: what a proposal needs is its operations'
 * business, and `applyProposalWith` checks the role against every one of them
 * (the D2 matrix) - a reader may apply a proposal that only comments (D2
 * gives comment threads to a reader) and nothing else.
 *
 * Importing `./tools` registers the executors beside their tools, which is
 * what makes a stored operation appliable in a request that ran no turn.
 */

const NOT_FOUND = 'That proposal could not be found.'

/** What an operation leaves for after its answer (a script save's measurement and derivation) runs after this request's, as the Script route's own save does. */
const runAfter = (task: () => Promise<void>): void => {
  after(task)
}

/** The tool gate an apply runs as: the project gate, and the episode the proposal was planned in. */
const gateFor = async (projectId: string, episodeId: EpisodeId | null): Promise<ToolGate | { readonly status: 'refused'; readonly message: string }> => {
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  if (episodeId === null) return { status: 'refused', message: 'The episode this was proposed in no longer exists.' }
  const episode = await readEpisode(gate.scope, episodeId)
  if (episode === null) return { status: 'refused', message: 'The episode this was proposed in no longer exists.' }
  return { actor: gate.actor, scope: gate.scope, project: gate.project, episode, role: gate.role }
}

const proposalGate = async (projectId: string, rawProposal: unknown): Promise<{ readonly gate: ToolGate; readonly id: AgentProposalId } | { readonly status: 'refused'; readonly message: string }> => {
  const id = AgentProposalIdSchema.safeParse(rawProposal)
  if (!id.success) return { status: 'refused', message: NOT_FOUND }
  const project = await openProject(projectId, ROLE.read)
  if (isRefusal(project)) return project
  const read = await readProposal(project.scope, id.data)
  if (read === null) return { status: 'refused', message: NOT_FOUND }
  const gate = await gateFor(projectId, read.proposal.episodeId)
  if ('status' in gate) return gate
  return { gate, id: id.data }
}

/**
 * Apply a proposal. `confirmed` is the writer's click on a confirmation step;
 * without it a confirm-mode proposal answers `needs-confirmation`.
 * `openDocuments` are the documents the panel found open in an editor (D10
 * path A): their edits come back as `editor` rather than being saved.
 */
export const applyProposal = async (projectId: string, proposalId: string, confirmed = false, openDocuments: readonly string[] = []): Promise<ApplyOutcome> => {
  const opened = await proposalGate(projectId, proposalId)
  if ('status' in opened) return opened
  const documents = z.array(DocumentIdSchema).max(64).safeParse(openDocuments)
  return applyProposalWith(opened.gate, opened.id, { confirmed: confirmed === true, editorDocuments: new Set(documents.success ? documents.data : []), schedule: runAfter })
}

const ReportsSchema = z
  .array(z.object({ opId: z.uuid(), ok: z.boolean(), message: z.string().max(500).optional(), stale: z.boolean().optional() }))
  .max(64)

/** The open editor's report on the edits `applyProposal` handed it; settles the proposal. */
export const finishEditorApply = async (projectId: string, proposalId: string, rawReports: unknown): Promise<ApplyOutcome> => {
  const opened = await proposalGate(projectId, proposalId)
  if ('status' in opened) return opened
  const reports = ReportsSchema.safeParse(rawReports)
  if (!reports.success) return { status: 'refused', message: 'That report did not read.' }
  return finishEditorApplyWith(opened.gate, opened.id, reports.data)
}

export const rejectProposal = async (
  projectId: string,
  proposalId: string,
): Promise<{ readonly status: 'rejected' } | { readonly status: 'decided' | 'refused'; readonly message: string }> => {
  const opened = await proposalGate(projectId, proposalId)
  if ('status' in opened) return opened
  return rejectProposalWith(opened.gate, opened.id)
}

/** Undo every applied operation of a run, newest first; what changed since becomes a new proposal. */
export const undoRun = async (projectId: string, rawRun: string): Promise<UndoOutcome> => {
  const run = RunIdSchema.safeParse(rawRun)
  if (!run.success) return { status: 'refused', message: 'That run could not be found.' }
  const project = await openProject(projectId, ROLE.read)
  if (isRefusal(project)) return project
  const row = await readAgentRun(project.scope, run.data)
  if (row === null) return { status: 'refused', message: 'That run could not be found.' }
  const gate = await gateFor(projectId, row.episodeId)
  if ('status' in gate) return gate
  return undoRunWith(gate, run.data, { schedule: runAfter })
}

/** The card's content: the proposal, each operation described and previewed, and - when it asks first - the balance. */
export const readProposalCard = async (
  projectId: string,
  proposalId: string,
): Promise<{ readonly status: 'ok'; readonly card: ProposalCard } | { readonly status: 'refused'; readonly message: string }> => {
  const opened = await proposalGate(projectId, proposalId)
  if ('status' in opened) return opened
  const read = await readProposal(opened.gate.scope, opened.id)
  if (read === null) return { status: 'refused', message: NOT_FOUND }
  return { status: 'ok', card: await buildProposalCard(opened.gate, read) }
}

// ---------------------------------------------------------------------------
// Background runs (roadmap task 4.4): the run card's poll and its buttons
// ---------------------------------------------------------------------------

/** The run card's figures, polled every two seconds while the run is live (D7). */
export const readBackgroundRunView = async (projectId: string, runId: string): Promise<RunViewResult> => {
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return readRunViewWith(gate, runId)
}

/** Stop a background run - its starter's, or an owner's. */
export const cancelBackgroundRunAction = async (projectId: string, runId: string): Promise<RunActionResult> => {
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return cancelRunWith(gate, runId)
}

/** Reply to a background run waiting for its starter; the reply queues its next job. */
export const continueBackgroundRunAction = async (projectId: string, runId: string, reply: string): Promise<RunActionResult> => {
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return continueRunWith(gate, runId, reply)
}

/** Approve the story checkpoint a run waits at - its starter's; the only way a checkpoint moves on. */
export const approveBackgroundRunAction = async (projectId: string, runId: string): Promise<RunActionResult> => {
  const gate = await openProject(projectId, ROLE.read)
  if (isRefusal(gate)) return gate
  return approveRunWith(gate, runId)
}
