import type { AgentEvent, AgentRunStatus, AgentStopReason, AssistantChatId } from '@folio/contracts'
import { AskInputSchema, isTerminalRunStatus } from '@folio/contracts'
import {
  addAgentRunTokens,
  appendMessage,
  createAgentRun,
  finishAgentRun,
  listCharacterRecords,
  listMessages,
  readAgentAutonomy,
  readChat,
  readChatRun,
  readMentionLabels,
  startAgentRun,
  tokensTodayFor,
  transactionDatabase,
} from '@folio/db'
import type { RunId } from '@folio/script'
import type Anthropic from '@anthropic-ai/sdk'
import { after } from 'next/server'

import { DAILY_TOKENS_PER_USER } from '../agent/limits'
import { runAgentLoop } from '../agent/loop'
import { proposalSink } from '../agent/proposer'
import { checkRateLimit } from '../agent/rate-limit'
import { replayOf } from '../agent/replay'
import '../agent/tools'
import { ROLE } from '../auth/roles'
import { stillMember } from '../script/actor-gate'
import { isRefusal, openEpisodeWith } from '../script/gate'
import { assistantClient, modelClientOf } from './client'
import { ASSISTANT_MODEL, MAX_OUTPUT_TOKENS } from './model'
import { turnSystem } from './turn-context'

export { assistantClient, assistantConnected } from './client'

/**
 * Asking the assistant. `ask()` is the streaming path
 * `app/api/assistant/route.ts` exposes: gate, limits, read the script beside
 * the gate, then run the agent loop (`lib/agent/loop.ts`, roadmap task 2.3)
 * inside a newline-delimited JSON stream of `AgentEvent`s (ADR 0003 **D7**).
 * The SDK's door is `client.ts`, and what a turn is told is
 * `turn-context.ts` - both out of this file since roadmap task 4.4, because
 * the worker builds a background run's turns from them too.
 *
 * ## The gate is the Script route's
 *
 * `openEpisodeWith` - identity, membership, scope, in one round trip, with
 * the reads a turn needs alongside. A chat that belongs to another episode
 * of the same project is refused as not found; a chat in another project is
 * unreachable by construction, the scope cannot see it. A chat a background
 * run is working in takes no interactive turn until the run is over - the two
 * would write one transcript at once - and is refused with a `409`.
 *
 * ## Tools, and a run per turn
 *
 * Since roadmap task 2.3 a turn is a tool-use loop: the model may call the
 * core toolset and the route's (`lib/agent/registry.ts`); since roadmap
 * Phase 3 the writes among them propose rather than write (AGENTS.md ruling
 * **R8**), and `proposalSink` stores the step's proposals under the
 * writer's autonomy (`users.agent_autonomy`, ADR 0003 D1). Each turn is an `agent_runs` row
 * (`0034`): its tokens are recorded there (D3), and every message of the
 * exchange - the model's tool calls, the results that answer them - is stored
 * with its content blocks, so the next turn replays it (`lib/agent/replay.ts`).
 * Two limits are checked before the stream opens, both as a `429`: the D14
 * hourly request limit and the D3 daily token cap.
 */

export type AskOutcome =
  | { readonly status: 'streaming'; readonly stream: ReadableStream<Uint8Array> }
  | { readonly status: 'refused'; readonly message: string; readonly code: 401 | 404 | 409 }
  | { readonly status: 'error'; readonly message: string; readonly code: 400 | 503 }
  /**
   * 60 requests an hour per user per project (ADR 0003 **D14**). A real `429`
   * with a real `Retry-After`, because that is what the status code is for and
   * the route handler has one to send.
   */
  | { readonly status: 'rate-limited'; readonly message: string; readonly code: 429; readonly retryAfterSeconds: number }

/** Seconds until the next UTC midnight, when the daily token cap turns over. */
export const secondsToMidnightUtc = (now: Date): number => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/** Why a background run's chat takes no question while the run is live. */
export const RUN_CHAT_BUSY = 'A background run is working in this chat. Wait for it to finish, reply to it when it asks, or cancel it.'

export const ask = async (raw: unknown, signal: AbortSignal): Promise<AskOutcome> => {
  const anthropic = assistantClient()
  if (anthropic === null) {
    return { status: 'error', code: 503, message: 'The assistant is not connected. Set ANTHROPIC_API_KEY on the server.' }
  }
  const parsed = AskInputSchema.safeParse(raw)
  if (!parsed.success) return { status: 'error', code: 400, message: 'Write a question first.' }
  const input = parsed.data

  const gate = await openEpisodeWith(input.projectId, input.episode, async (scope) => {
    const [chat, labels, records] = await Promise.all([
      readChat(scope, input.chatId as AssistantChatId),
      readMentionLabels(scope),
      listCharacterRecords(scope),
    ])
    return { chat, labels, records }
  }, ROLE.assistant)
  if (isRefusal(gate)) return { status: 'refused', code: gate.message.startsWith('Sign in') ? 401 : 404, message: gate.message }
  const { scope, project, episode, extra } = gate

  // After the gate, because the counter is per user per project and neither is
  // known before it; before the model call, because a limit that counts what
  // already happened is a report.
  const limited = await checkRateLimit(scope, gate.actor, 'assistant')
  if (limited !== null) return { ...limited, code: 429 }
  // D3: the per-user daily token cap, summed across every project the writer
  // works in. Refused before a token is spent; a turn that crosses it midway
  // is stopped by the loop.
  const accountDb = await transactionDatabase()
  const [used, autonomy] = await Promise.all([tokensTodayFor(accountDb, gate.actor), readAgentAutonomy(accountDb, gate.actor)])
  const tokenBudget = DAILY_TOKENS_PER_USER - used
  if (tokenBudget <= 0) {
    return {
      status: 'rate-limited',
      code: 429,
      message: "You have used today's assistant allowance. It resets at midnight UTC.",
      retryAfterSeconds: secondsToMidnightUtc(new Date()),
    }
  }
  if (extra.chat === null || extra.chat.episodeId !== episode.id) {
    return { status: 'refused', code: 404, message: 'That chat could not be found.' }
  }
  const chatId = extra.chat.id
  // A background run's own chat (roadmap task 4.4): its transcript is the run's until the run is over.
  const chatRun = await readChatRun(scope, chatId)
  if (chatRun !== null && !isTerminalRunStatus(chatRun.status)) return { status: 'refused', code: 409, message: RUN_CHAT_BUSY }

  const history = await listMessages(scope, chatId)
  const system = await turnSystem(
    { actor: gate.actor, scope, project, episode, role: gate.role },
    { labels: extra.labels, records: extra.records },
    {
      scope: input.scope,
      route: input.route ?? null,
      ...(input.focus === undefined ? {} : { focus: input.focus }),
      ...(input.places === true ? { places: true } : {}),
      ...(input.timeline === true ? { timeline: true } : {}),
      ...(input.selection === undefined ? {} : { selection: input.selection }),
    },
  )
  const messages: Anthropic.MessageParam[] = [...replayOf(history), { role: 'user', content: input.message }]

  const encoder = new TextEncoder()
  const client = modelClientOf(anthropic)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The client has gone; the run still finishes and is still recorded.
        }
      }
      let runId: RunId | null = null
      let status: FinishedStatus = 'failed'
      let stopReason: AgentStopReason = 'error'
      try {
        // The run first, so the writer's question can carry its id (`0034`).
        const run = await createAgentRun(scope, { episodeId: episode.id, chatId, mode: 'interactive' })
        runId = run.id
        const question = await appendMessage(scope, chatId, 'user', input.message, { runId: run.id })
        await startAgentRun(scope, run.id, question.id)

        const toolGate = { actor: gate.actor, scope, project, episode, role: gate.role }
        const outcome = await runAgentLoop({
          client,
          model: ASSISTANT_MODEL,
          maxTokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          route: input.route ?? null,
          context: { gate: toolGate, runId: run.id, emit, route: input.route ?? null },
          checkMembership: () => stillMember(toolGate),
          // Phase 3: what a write tool proposes is written here, one proposal per step,
          // and under the writer's `auto` applied at once where D1 allows (task 3.7).
          proposals: proposalSink(toolGate, run.id, autonomy, (task) => {
            after(task)
          }),
          emit,
          signal,
          tokenBudget,
          recordTokens: (used, produced) => addAgentRunTokens(scope, run.id, used, produced),
          recordMessage: async (role, body, content) => {
            await appendMessage(scope, chatId, role, body, { content, runId: run.id })
          },
        })
        stopReason = outcome.stopReason
        status = RUN_STATUS[outcome.stopReason]
        // Whatever the writer saw that no stored message holds - a step cut
        // off by an abort, an error's note - is still worth keeping: a half
        // answer is better than a question with no answer in the log.
        if (outcome.unsaved.trim().length > 0) {
          await appendMessage(scope, chatId, 'assistant', outcome.unsaved, { runId: run.id }).catch(() => undefined)
        }
      } catch (cause) {
        console.error({ event: 'folio.agent.turn_failed', message: cause instanceof Error ? cause.message : String(cause) })
        emit({ type: 'error', message: 'The assistant could not answer.' })
      } finally {
        if (runId !== null) {
          await finishAgentRun(scope, runId, status, status === 'failed' ? 'The assistant could not answer.' : null).catch(() => undefined)
        }
        emit({ type: 'done', runId, status, stopReason })
        try {
          controller.close()
        } catch {
          // Already closed by the cancel path.
        }
      }
    },
  })

  return { status: 'streaming', stream }
}

/** How a turn's end is recorded on its run. A limit reached is still a turn that answered. */
type FinishedStatus = Exclude<AgentRunStatus, 'queued' | 'running'>

const RUN_STATUS: Readonly<Record<AgentStopReason, FinishedStatus>> = {
  end_turn: 'succeeded',
  step_cap: 'succeeded',
  time_cap: 'succeeded',
  token_cap: 'succeeded',
  refusal: 'succeeded',
  aborted: 'cancelled',
  error: 'failed',
  // An interactive turn carries on past a confirmation (the writer is there to click it); only a background run stops on one.
  confirmation: 'succeeded',
}
