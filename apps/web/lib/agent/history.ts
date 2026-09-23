import type { AgentOpMode, AgentOpStatus, AgentProposalStatus, AgentRunMode, AgentRunStatus, Episode, EpisodeSlug, NavigateTarget } from '@folio/contracts'
import { BackgroundRunInputSchema } from '@folio/contracts'
import { listEpisodes, listProposalsForRuns, listRunActivity, listRunsWithInput, listSceneIndex, readMessageBodies } from '@folio/db'
import type { NodeId, RunId } from '@folio/script'

import type { ProjectGate } from '../script/actor-gate'
import { UNDO_KEY_PREFIX } from './apply'
import type { ActivityTarget } from './executors'
import { executorFor } from './executors'
import type { KnownPlaces, PlaceInput } from './targets'
import { resolveTarget } from './targets'
import './tools'

/**
 * The panel's run history - roadmap task 5.4, ADR 0003 **D11** ("every agent
 * change is attributable and undoable in one step").
 *
 * Every run of the project, newest first: a turn, a background task, a
 * pipeline. For each, what it proposed and what became of each proposal, each
 * operation in code's words (its executor's `describe`) with where it stands,
 * when it landed and when it was undone, where to open what it changed, the
 * tokens it used (D3's meter) and the credits it was granted and spent. Read
 * from `agent_runs`, `agent_proposals` / `agent_proposal_ops` and
 * `activity_log` - five statements in parallel after the runs, however many
 * runs - and resolved against one read of the episodes and the scene index,
 * so a long history is not a read per link.
 *
 * A run is **undoable** while one of its applied operations can be put back
 * (its executor has an inverse and it holds an undo record) - the same test
 * `undoRunWith` applies, so the button is offered exactly when it would do
 * something.
 */

export type HistoryOp = {
  readonly id: string
  readonly tool: string
  readonly description: string
  readonly mode: AgentOpMode
  readonly status: AgentOpStatus
  /** Where the writer opens what it changed; null when it has no page (a run, the project). */
  readonly open: NavigateTarget | null
  /** When it landed, from the operation; when undo put it back, from `activity_log`. */
  readonly appliedAt: string | null
  readonly undoneAt: string | null
}

export type HistoryProposal = {
  readonly id: string
  readonly status: AgentProposalStatus
  readonly summary: string
  readonly creditCost: number | null
  readonly ops: readonly HistoryOp[]
}

export type HistoryRun = {
  readonly id: string
  readonly title: string
  readonly mode: AgentRunMode
  /** What kind of run: a turn, a background task, or one of the two pipelines. */
  readonly kind: 'turn' | 'task' | 'story_to_script' | 'script_to_production'
  readonly status: AgentRunStatus
  /** Why it waits, or why it failed, in the writer's terms. */
  readonly note: string | null
  readonly chatId: string | null
  /** The episode it ran in, by slug - where its chat opens. */
  readonly episode: EpisodeSlug | null
  readonly createdAt: string
  readonly finishedAt: string | null
  readonly tokens: { readonly input: number; readonly output: number }
  readonly credits: { readonly budget: number; readonly spent: number }
  readonly proposals: readonly HistoryProposal[]
  readonly undoable: boolean
}

/** The page an operation's target opens on - its record, its scene, or the route it lives on. Pure. */
export const placeOf = (target: ActivityTarget, episode: number | null): PlaceInput | null => {
  const inEpisode = episode === null ? {} : { episode }
  switch (target.type) {
    case 'character':
      return target.id === null ? { route: 'characters' } : { route: 'characters', recordId: target.id }
    case 'location':
      return target.id === null ? { route: 'locations' } : { route: 'locations', recordId: target.id }
    case 'prop':
      return target.id === null ? { route: 'props' } : { route: 'props', recordId: target.id }
    case 'scene':
      return target.id === null ? { route: 'script', ...inEpisode } : { route: 'script', sceneId: target.id as NodeId }
    case 'document':
    case 'node':
    case 'comment_thread':
    case 'title_page':
    case 'episode':
      return { route: 'script', ...inEpisode }
    case 'reel':
    case 'reel_shot':
    case 'generation':
      return { route: 'production', ...inEpisode }
    case 'shot':
      return { route: 'storyboard', ...inEpisode }
    case 'story_thread':
    case 'timeline_finding':
    case 'timeline':
      return { route: 'timeline' }
    default:
      return null
  }
}

/**
 * The record an operation made, when its target could not name it before it
 * ran - a create's target is `{ id: null }`, and its result is `{ id }`. Read
 * back through a check, never trusted: a result is data.
 */
const createdId = (result: unknown): string | null =>
  typeof result === 'object' && result !== null && 'id' in result && typeof result.id === 'string' && /^[0-9a-f-]{36}$/u.test(result.id) ? result.id : null

/** A turn's title: the first line of what the writer asked, cut to a line. */
const titleOfTurn = (body: string | undefined): string => {
  const first = (body ?? '').split('\n')[0]?.trim() ?? ''
  if (first === '') return 'A turn'
  return first.length <= 80 ? first : `${first.slice(0, 77)}...`
}

export const readRunHistoryWith = async (gate: ProjectGate, limit = 20): Promise<readonly HistoryRun[]> => {
  const { scope } = gate
  const rows = await listRunsWithInput(scope, limit)
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.run.id as RunId)
  const [proposals, activity, bodies, episodes, index] = await Promise.all([
    listProposalsForRuns(scope, ids),
    listRunActivity(scope, ids),
    readMessageBodies(scope, rows.flatMap((row) => (row.run.messageId === null ? [] : [row.run.messageId]))),
    listEpisodes(scope),
    listSceneIndex(scope),
  ])
  const known: KnownPlaces = { episodes, index }
  const episodeOf = new Map<string, Episode>(episodes.map((episode) => [episode.id as string, episode]))
  const undoneAt = new Map(activity.filter((row) => row.verb === 'agent:undo_run' && row.opId !== null).map((row) => [row.opId ?? '', row.at]))
  const fallback = [...episodes].sort((a, b) => a.ordinal - b.ordinal)[0]

  const out: HistoryRun[] = []
  for (const { run, input } of rows) {
    const parsed = BackgroundRunInputSchema.safeParse(input)
    const runEpisode = run.episodeId === null ? undefined : episodeOf.get(run.episodeId)
    const made: HistoryProposal[] = []
    let undoable = false
    for (const { proposal, ops } of proposals.filter((entry) => entry.proposal.runId === run.id)) {
      const episode = (proposal.episodeId === null ? undefined : episodeOf.get(proposal.episodeId)) ?? runEpisode ?? fallback
      const lines: HistoryOp[] = []
      for (const op of ops) {
        const executor = executorFor(op.tool)
        const target = executor?.target(op.args)
        const place = target === undefined ? null : placeOf({ type: target.type, id: target.id ?? (op.status === 'applied' ? createdId(op.result) : null) }, episode?.ordinal ?? null)
        const resolved = place === null || episode === undefined ? null : await resolveTarget({ ...gate, episode }, place, known)
        if (executor !== undefined && op.status === 'applied' && op.undo !== null && op.undo !== undefined && !op.idempotencyKey.startsWith(UNDO_KEY_PREFIX) && executor.reversible(op.args)) undoable = true
        lines.push({
          id: op.id,
          tool: op.tool,
          description: executor?.describe(op.args) ?? op.tool,
          mode: op.mode,
          status: op.status,
          open: resolved !== null && resolved.ok ? resolved.target : null,
          appliedAt: op.appliedAt,
          undoneAt: undoneAt.get(op.id) ?? null,
        })
      }
      made.push({ id: proposal.id, status: proposal.status, summary: proposal.summary, creditCost: proposal.creditCost, ops: lines })
    }
    out.push({
      id: run.id,
      title: parsed.success ? parsed.data.title : titleOfTurn(run.messageId === null ? undefined : bodies.get(run.messageId)),
      mode: run.mode,
      kind: parsed.success ? parsed.data.kind : 'turn',
      status: run.status,
      note: run.error,
      chatId: run.chatId,
      episode: runEpisode?.slug ?? null,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      tokens: { input: run.inputTokens, output: run.outputTokens },
      credits: { budget: run.creditBudget, spent: run.creditsSpent },
      proposals: made,
      undoable,
    })
  }
  return out
}
