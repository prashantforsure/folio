import { z } from 'zod'

import {
  AssistantChatIdSchema,
  AssistantMessageIdSchema,
  EpisodeIdSchema,
  EpisodeSlugSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  UserIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * The agent copilot's wire shapes - ADR 0003, roadmap Phase 2.
 *
 * Three things live here because both sides of a boundary read them: the
 * event stream `POST /api/assistant` writes and the panel reads (**D7**:
 * "interactive turns stream newline-delimited JSON events"), the status of a
 * run as `agent_runs` stores it, and the mode a run executes in.
 *
 * ## An event is a line, and a line is one of eleven shapes
 *
 * The panel has to tell a sentence from a navigation from a download without
 * parsing prose, which is why the stream is typed at all (D7's rationale).
 * `proposal` and `confirm_required` were declared in Phase 2 and are emitted
 * from Phase 3, when the assistant started writing through proposals
 * (AGENTS.md ruling **R8**).
 */

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Where a run is. `waiting_for_user` is a run stopped on a confirmation (D1's
 * confirm and paid modes); the three after it are terminal.
 */
export const AGENT_RUN_STATUSES = ['queued', 'running', 'waiting_for_user', 'succeeded', 'failed', 'cancelled'] as const

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUSES)

export const isTerminalRunStatus = (status: AgentRunStatus): boolean =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled'

/**
 * **D5.** `interactive` runs inside the request that started it, capped at 12
 * steps and 60 seconds; `background` runs on the worker (roadmap Phase 4).
 */
export const AGENT_RUN_MODES = ['interactive', 'background'] as const

export type AgentRunMode = (typeof AGENT_RUN_MODES)[number]

export const AgentRunModeSchema = z.enum(AGENT_RUN_MODES)

/**
 * Why a turn ended. `step_cap`, `time_cap` and `token_cap` are the three
 * limits a run can reach. `confirmation` is a background run stopping on a
 * proposal only the writer can confirm (roadmap task 4.4) - an interactive
 * turn carries on past one, because the writer is there to click it.
 */
export const AGENT_STOP_REASONS = ['end_turn', 'step_cap', 'time_cap', 'token_cap', 'refusal', 'aborted', 'error', 'confirmation'] as const

export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number]

export const AgentStopReasonSchema = z.enum(AGENT_STOP_REASONS)

/** One `agent_runs` row. The id is the `provenance_run_id` an agent-written node will carry (D11). */
export const AgentRunSchema = z.object({
  id: RunIdSchema,
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema.nullable(),
  chatId: AssistantChatIdSchema.nullable(),
  messageId: AssistantMessageIdSchema.nullable(),
  createdBy: UserIdSchema,
  status: AgentRunStatusSchema,
  mode: AgentRunModeSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  creditBudget: z.number().int().nonnegative(),
  creditsSpent: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
})

export type AgentRun = z.infer<typeof AgentRunSchema>

// ---------------------------------------------------------------------------
// Where the agent may send the writer
// ---------------------------------------------------------------------------

/**
 * The ten workspace routes, by name. `apps/web/lib/workspace/routes.ts` is the
 * route tree and checks at compile time that this tuple names the same ten;
 * contracts cannot import from the app, so the names are written here once
 * more and the app proves they agree.
 */
export const AGENT_EPISODE_ROUTES = ['script', 'outline', 'storyboard', 'scenes', 'production'] as const

export const AGENT_PROJECT_ROUTES = ['characters', 'locations', 'props', 'timeline', 'research'] as const

export const AgentEpisodeRouteSchema = z.enum(AGENT_EPISODE_ROUTES)

export const AgentProjectRouteSchema = z.enum(AGENT_PROJECT_ROUTES)

export const AgentRouteSchema = z.enum([...AGENT_EPISODE_ROUTES, ...AGENT_PROJECT_ROUTES])

export type AgentRoute = z.infer<typeof AgentRouteSchema>

/**
 * A place in the app, as data. The panel turns it into a URL with
 * `lib/workspace/hrefs.ts` and nothing else (integration plan, *The side
 * panel* 5: "URLs are never concatenated by hand"). The server resolves the
 * shape and the episode before it sends one - the panel cannot run
 * `enterEpisodeRoute`, which is a server function - so every field the URL
 * builders need is already here.
 */
export const NavigateTargetSchema = z.discriminatedUnion('kind', [
  /** A project's front door; it redirects to the right episode's script. `open_project` sends this. */
  z.object({ kind: z.literal('project'), projectId: ProjectIdSchema }),
  z.object({
    kind: z.literal('episode'),
    projectId: ProjectIdSchema,
    shape: z.enum(['episodic', 'collapsed']),
    episode: EpisodeSlugSchema,
    route: AgentEpisodeRouteSchema,
    /** A scene heading in the script: the `#n-<node id>` fragment. Script route only. */
    sceneNodeId: NodeIdSchema.optional(),
  }),
  z.object({ kind: z.literal('route'), projectId: ProjectIdSchema, route: AgentProjectRouteSchema }),
  z.object({
    kind: z.literal('record'),
    projectId: ProjectIdSchema,
    entity: z.enum(['character', 'location', 'prop', 'research']),
    id: z.uuid(),
  }),
])

export type NavigateTarget = z.infer<typeof NavigateTargetSchema>

/**
 * What a background run was asked to do - `agent_runs.input` (migration
 * `0037`, roadmap task 4.4). The worker rebuilds the run's context from it on
 * every job: the route decides the toolset, `scope` whether the script is the
 * episode's or the project's. `task` is the model's own brief, written when it
 * called `start_background_task`, and is also the run chat's first message.
 */
export const BackgroundTaskInputSchema = z.object({
  kind: z.literal('task'),
  title: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(4_000),
  route: AgentRouteSchema.nullable(),
  scope: z.enum(['episode', 'project']),
})

export type BackgroundTaskInput = z.infer<typeof BackgroundTaskInputSchema>

/** The kinds of background run: a task the model handed itself. The story pipeline (task 4.5) adds its own. */
export const BackgroundRunInputSchema = z.discriminatedUnion('kind', [BackgroundTaskInputSchema])

export type BackgroundRunInput = z.infer<typeof BackgroundRunInputSchema>

// ---------------------------------------------------------------------------
// The event stream
// ---------------------------------------------------------------------------

/** The longest file an agent export hands the browser in one event. A feature's Fountain is ~200 KB. */
export const AGENT_DOWNLOAD_MAX = 5_000_000

export const AgentEventSchema = z.discriminatedUnion('type', [
  /** A piece of the answer, appended as it arrives. */
  z.object({ type: z.literal('text'), text: z.string() }),
  /** A tool call began. `id` is the API's `tool_use` id - the idempotency key (D13). */
  z.object({ type: z.literal('tool_started'), id: z.string(), name: z.string(), label: z.string() }),
  /** A tool call ended; `summary` is a short line the panel prints, never the model's words. */
  z.object({ type: z.literal('tool_finished'), id: z.string(), name: z.string(), ok: z.boolean(), summary: z.string() }),
  /**
   * A stored proposal the writer reviews (roadmap task 3.3). `auto` is the
   * writer's autonomy saying the panel may apply it at once - never when
   * `needsConfirmation`, which no setting skips (ADR 0003 D1).
   */
  z.object({
    type: z.literal('proposal'),
    proposalId: z.uuid(),
    runId: RunIdSchema,
    summary: z.string(),
    needsConfirmation: z.boolean(),
    auto: z.boolean(),
  }),
  /**
   * A background run started from this turn (roadmap task 4.4): it works in a
   * chat of its own, `chatId`, and the panel polls it every two seconds (D7).
   */
  z.object({ type: z.literal('background_run'), runId: RunIdSchema, chatId: AssistantChatIdSchema, title: z.string() }),
  /** Phase 3. A confirm- or paid-mode action waiting for the writer; `cost` in credits when it spends. */
  z.object({ type: z.literal('confirm_required'), id: z.string(), name: z.string(), summary: z.string(), cost: z.number().int().nonnegative().nullable() }),
  z.object({ type: z.literal('navigate'), target: NavigateTargetSchema }),
  /** Re-read the server components under the panel (`router.refresh()`). */
  z.object({ type: z.literal('refresh') }),
  /** A file the writer could have clicked for themselves (ruling R2), saved by the panel as a Blob. */
  z.object({ type: z.literal('download'), filename: z.string().min(1).max(200), mime: z.string().min(1), text: z.string().max(AGENT_DOWNLOAD_MAX) }),
  /** Something the writer should read; the turn may still end normally after it. */
  z.object({ type: z.literal('error'), message: z.string() }),
  /** The last line of every stream. `runId` is null only when the run row could not be written. */
  z.object({ type: z.literal('done'), runId: RunIdSchema.nullable(), status: AgentRunStatusSchema, stopReason: AgentStopReasonSchema }),
])

export type AgentEvent = z.infer<typeof AgentEventSchema>

export type AgentEventType = AgentEvent['type']

/** The response's media type (D7). One JSON object per line. */
export const AGENT_STREAM_MEDIA_TYPE = 'application/x-ndjson'
