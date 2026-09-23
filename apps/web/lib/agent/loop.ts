import type { AgentEvent, AgentRoute, AgentStopReason, AssistantContent } from '@folio/contracts'
import type { RunId } from '@folio/script'
import Anthropic from '@anthropic-ai/sdk'

import type { DirectOutcome, ProposedOp, Proposing, Tool, ToolContext, Toolset } from './registry'
import { labelOf, runTool, toolDefinitions, toolsFor } from './registry'

/**
 * The agent loop - roadmap task 2.3, ADR 0003 **D5**.
 *
 * One interactive turn: send the conversation and the tools, run whatever the
 * model calls, append the results, and go round until the model answers
 * without calling anything - or a limit is reached:
 *
 *   **12 model steps** and **60 seconds** (D5). Either ends the loop with one
 *   more call that may not use a tool, asking the model to sum up for the
 *   writer what it found and what is left - a turn that stops mid-thought
 *   with nothing said is worse than one that says where it stopped. The time
 *   cap is checked between steps; a step already running is allowed to end.
 *
 *   **The daily token cap** (D3, `DAILY_TOKENS_PER_USER`). The caller works out
 *   what is left of today's allowance before the turn; the loop stops when the
 *   turn has spent it, **without** a summary call - a summary would spend past
 *   the cap it is reporting.
 *
 * ## Injected, so it can be tested without a network
 *
 * The model client, the clock and the two writes (tokens, messages) are
 * arguments. `lib/assistant/server.ts` passes the SDK and the repositories;
 * `tests/agent-loop.test.ts` passes a scripted client and arrays.
 *
 * ## What is kept of today's behaviour
 *
 * Prompt caching on the system block (the caller builds it) and now on the
 * last tool definition too (`toolDefinitions`); a refusal appends the same
 * note it always did; an abort keeps what was already said. Every model
 * message is stored with its content blocks, every tool result as the user
 * turn that answers it, so the next turn replays the whole exchange
 * (`replay.ts`).
 */

export const MAX_STEPS = 12

export const MAX_TURN_MS = 60_000

export const REFUSAL_NOTE = '\n\n[The assistant declined to answer this one.]'

/**
 * The operations one step queued, grouped as they become proposals: every
 * `propose` operation of the step together - related changes are one
 * proposal, one review - and each `confirm` or `paid` operation alone, so each
 * destructive or spending act is confirmed by itself (ADR 0003 D1).
 */
export type ProposalGroup = { readonly ops: readonly { readonly key: string; readonly op: ProposedOp }[] }

/** A proposal the sink wrote, as the panel's `proposal` event carries it. */
export type ProposalMade = {
  readonly proposalId: string
  readonly runId: RunId
  readonly summary: string
  readonly needsConfirmation: boolean
  /** The writer's autonomy lets the panel apply it at once (never with `needsConfirmation`). */
  readonly auto: boolean
  /** Already applied by the sink under `auto` - a record-only proposal (roadmap task 3.7). */
  readonly applied?: boolean
}

/** Where a turn's proposals are written - `lib/agent/proposer.ts`; a test passes arrays. */
export type ProposalSink = {
  readonly create: (groups: readonly ProposalGroup[]) => Promise<readonly ProposalMade[]>
  readonly applyNow: (op: ProposedOp, key: string) => Promise<DirectOutcome>
}

/** Group a step's queued operations into proposals. */
export const groupsOf = (queued: readonly { readonly key: string; readonly op: ProposedOp }[]): readonly ProposalGroup[] => {
  const together = queued.filter((entry) => entry.op.mode === 'propose')
  const alone = queued.filter((entry) => entry.op.mode === 'confirm' || entry.op.mode === 'paid')
  return [...(together.length === 0 ? [] : [{ ops: together }]), ...alone.map((entry) => ({ ops: [entry] }))]
}

/** A model message, narrowed to the fields the loop reads. */
export type ModelMessage = Pick<Anthropic.Message, 'content' | 'stop_reason'> & {
  readonly usage: Pick<Anthropic.Usage, 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens'>
}

/** The SDK's stream, narrowed to what the loop reads, so a test can script one. */
export type ModelStream = AsyncIterable<Anthropic.MessageStreamEvent> & {
  readonly finalMessage: () => Promise<ModelMessage>
}

export type ModelClient = {
  readonly stream: (params: Anthropic.MessageStreamParams, options: { readonly signal: AbortSignal }) => ModelStream
}

export type LoopInput = {
  readonly client: ModelClient
  readonly model: string
  readonly maxTokens: number
  readonly system: readonly Anthropic.TextBlockParam[]
  /** The chat so far, replayed, ending with the writer's new question. */
  readonly messages: readonly Anthropic.MessageParam[]
  readonly route: AgentRoute | null
  /** What a tool runs as, minus the per-call fields the loop fills in. */
  readonly context: Omit<ToolContext, 'idempotencyKey' | 'loaded' | 'proposals'>
  /** Where proposals go. Absent: a write tool's operation is queued and dropped (a read-only caller, a test). */
  readonly proposals?: ProposalSink
  readonly emit: (event: AgentEvent) => void
  readonly signal: AbortSignal
  /** Tokens left of today's allowance when the turn began. */
  readonly tokenBudget: number
  readonly now?: () => number
  readonly maxSteps?: number
  readonly maxMs?: number
  /** Add one call's usage to the run's row. */
  readonly recordTokens: (input: number, output: number) => Promise<void>
  /** Store one message of the exchange: the model's, or the tool results that answer it. */
  readonly recordMessage: (role: 'user' | 'assistant', body: string, content: AssistantContent | null) => Promise<void>
}

export type LoopOutcome = {
  readonly stopReason: AgentStopReason
  /** Every word the writer was shown, in order. */
  readonly text: string
  /**
   * What the writer was shown that no stored message holds yet: the part of a
   * step cut off by an abort or an error, and the error's note. The caller
   * stores it as a plain assistant turn - a half answer the writer saw is
   * better than a question with no answer in the log.
   */
  readonly unsaved: string
  readonly steps: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** A call's tokens as the D3 meter counts them: every input token read, cached or not, and every output token. */
export const tokensOf = (usage: ModelMessage['usage']): { readonly input: number; readonly output: number } => ({
  input: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
  output: usage.output_tokens,
})

const SUMMARY_ASK: Readonly<Record<'step_cap' | 'time_cap', string>> = {
  step_cap: `[Folio: this turn has reached its limit of ${String(MAX_STEPS)} steps. Do not call another tool. Tell the writer, briefly, what you found and what is left to do.]`,
  time_cap: `[Folio: this turn has reached its time limit. Do not call another tool. Tell the writer, briefly, what you found and what is left to do.]`,
}

const TOKEN_CAP_MESSAGE = "You have used today's assistant allowance. It resets at midnight UTC."

/** The stored form of a block: the SDK's response shape, as plain JSON. */
const stored = (blocks: readonly unknown[]): AssistantContent => JSON.parse(JSON.stringify(blocks)) as AssistantContent

const textOf = (message: ModelMessage): string =>
  message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')

/**
 * Write a step's queued operations as proposals, tell the panel, and put each
 * proposal's id into the results of the calls that made it - the model can
 * refer to it, and a reloaded chat finds its cards (`proposalIdsIn`). If the
 * write fails, those calls become errors: the model must not say it proposed
 * something that was never stored.
 */
const writeProposals = async (
  sink: ProposalSink,
  queued: readonly { readonly key: string; readonly op: ProposedOp }[],
  foldedInto: ReadonlyMap<string, string>,
  results: Anthropic.ToolResultBlockParam[],
  emit: (event: AgentEvent) => void,
): Promise<void> => {
  const groups = groupsOf(queued)
  const proposalOf = new Map<string, string>()
  const appliedNow = new Set<string>()
  try {
    const made = await sink.create(groups)
    for (const [index, group] of groups.entries()) {
      const proposal = made[index]
      if (proposal === undefined) continue
      for (const entry of group.ops) proposalOf.set(entry.key, proposal.proposalId)
      if (proposal.applied === true) appliedNow.add(proposal.proposalId)
      emit({ type: 'proposal', proposalId: proposal.proposalId, runId: proposal.runId, summary: proposal.summary, needsConfirmation: proposal.needsConfirmation, auto: proposal.auto })
      if (proposal.needsConfirmation) emit({ type: 'confirm_required', id: proposal.proposalId, name: group.ops[0]?.op.tool ?? 'proposal', summary: proposal.summary, cost: null })
    }
  } catch (cause) {
    console.error({ event: 'folio.agent.proposal_failed', message: cause instanceof Error ? cause.message : String(cause) })
  }
  for (const [index, block] of results.entries()) {
    const key = foldedInto.get(block.tool_use_id) ?? block.tool_use_id
    if (!queued.some((entry) => entry.key === key) || block.is_error === true) continue
    const proposalId = proposalOf.get(key)
    if (proposalId === undefined) {
      results[index] = { type: 'tool_result', tool_use_id: block.tool_use_id, content: 'The proposal could not be saved. Nothing was proposed.', is_error: true }
      continue
    }
    const content = typeof block.content === 'string' ? (JSON.parse(block.content) as Record<string, unknown>) : {}
    // Under `auto` a record-only proposal is already applied: the model must not tell the writer it waits.
    const status = appliedNow.has(proposalId) ? { status: 'Applied at once: the writer has automatic apply on. They can undo the run.' } : {}
    results[index] = { ...block, content: JSON.stringify({ ...content, ...status, proposalId }) }
  }
}

export const runAgentLoop = async (input: LoopInput): Promise<LoopOutcome> => {
  const now = input.now ?? Date.now
  const maxSteps = input.maxSteps ?? MAX_STEPS
  const maxMs = input.maxMs ?? MAX_TURN_MS
  const started = now()
  const messages: Anthropic.MessageParam[] = [...input.messages]
  const loaded = new Set<Toolset>()
  let shown = ''
  let unsaved = ''
  let steps = 0
  let inputTokens = 0
  let outputTokens = 0

  const say = (text: string): void => {
    if (text.length === 0) return
    shown += text
    unsaved += text
    input.emit({ type: 'text', text })
  }

  /** One model call, its text streamed to the writer as it arrives. */
  const call = async (tools: readonly Tool[], mayUseTools: boolean): Promise<ModelMessage> => {
    steps += 1
    // A second step's words start a new paragraph rather than running on.
    let needsBreak = shown.length > 0
    const stream = input.client.stream(
      {
        model: input.model,
        max_tokens: input.maxTokens,
        system: [...input.system],
        messages,
        ...(tools.length === 0 ? {} : { tools: toolDefinitions(tools), ...(mayUseTools ? {} : { tool_choice: { type: 'none' as const } }) }),
      },
      { signal: input.signal },
    )
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (needsBreak) {
          say('\n\n')
          needsBreak = false
        }
        say(event.delta.text)
      }
    }
    const message = await stream.finalMessage()
    const used = tokensOf(message.usage)
    inputTokens += used.input
    outputTokens += used.output
    await input.recordTokens(used.input, used.output)
    await input.recordMessage('assistant', textOf(message), stored(message.content))
    unsaved = ''
    return message
  }

  const outcome = (stopReason: AgentStopReason): LoopOutcome => ({ stopReason, text: shown, unsaved, steps, inputTokens, outputTokens })

  try {
    for (;;) {
      const tools = toolsFor(input.route, loaded)
      const message = await call(tools, true)
      messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] })

      if (message.stop_reason === 'refusal') {
        say(REFUSAL_NOTE)
        return outcome('refusal')
      }
      const calls = message.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      if (message.stop_reason !== 'tool_use' || calls.length === 0) return outcome('end_turn')

      const results: Anthropic.ToolResultBlockParam[] = []
      // The step's writes: queued by the tools, written as proposals below.
      const queued: { key: string; op: ProposedOp }[] = []
      const foldedInto = new Map<string, string>()
      const proposing = (key: string): Proposing => ({
        propose: (op) => {
          const earlier = op.mergeKey === undefined ? undefined : queued.find((entry) => entry.op.mergeKey === op.mergeKey)
          if (earlier !== undefined) {
            earlier.op = op
            foldedInto.set(key, earlier.key)
            return
          }
          queued.push({ key, op })
        },
        earlier: (mergeKey) => queued.find((entry) => entry.op.mergeKey === mergeKey)?.op.args,
        applyNow: async (op) => {
          if (input.proposals === undefined) return { ok: false, message: 'Changes cannot be made from here.' }
          const done = await input.proposals.applyNow(op, key)
          // A direct operation is already applied; its card is how the writer sees it, and undoes the run.
          if (done.ok) input.emit({ type: 'proposal', proposalId: done.proposalId, runId: input.context.runId, summary: op.description, needsConfirmation: false, auto: false })
          return done
        },
      })
      for (const use of calls) {
        input.emit({ type: 'tool_started', id: use.id, name: use.name, label: labelOf(use.name, use.input, tools) })
        const result = await runTool(use.name, use.input, { ...input.context, idempotencyKey: use.id, loaded, proposals: proposing(use.id) }, tools)
        input.emit({
          type: 'tool_finished',
          id: use.id,
          name: use.name,
          ok: result.ok,
          summary: result.ok ? result.summary : result.message,
        })
        results.push(
          result.ok
            ? { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result.content) }
            : { type: 'tool_result', tool_use_id: use.id, content: result.message, is_error: true },
        )
      }
      if (queued.length > 0 && input.proposals !== undefined) await writeProposals(input.proposals, queued, foldedInto, results, input.emit)

      if (inputTokens + outputTokens >= input.tokenBudget) {
        messages.push({ role: 'user', content: results })
        await input.recordMessage('user', '', stored(results))
        input.emit({ type: 'error', message: TOKEN_CAP_MESSAGE })
        return outcome('token_cap')
      }
      const cap = steps >= maxSteps ? 'step_cap' : now() - started >= maxMs ? 'time_cap' : null
      if (cap === null) {
        messages.push({ role: 'user', content: results })
        await input.recordMessage('user', '', stored(results))
        continue
      }

      // A limit: answer the calls, ask for a summary, and allow no more tools.
      const closing: Anthropic.ContentBlockParam[] = [...results, { type: 'text', text: SUMMARY_ASK[cap] }]
      messages.push({ role: 'user', content: closing })
      await input.recordMessage('user', '', stored(closing))
      const summary = await call(tools, false)
      if (summary.stop_reason === 'refusal') say(REFUSAL_NOTE)
      return outcome(cap)
    }
  } catch (cause) {
    // A closed tab aborts the fetch; the SDK surfaces it as an error. What was
    // already said stays said - the caller keeps it in the log.
    if (cause instanceof Anthropic.APIUserAbortError || input.signal.aborted) return outcome('aborted')
    const message = cause instanceof Anthropic.APIError ? `The assistant could not answer (${String(cause.status)}).` : 'The assistant could not answer.'
    input.emit({ type: 'error', message })
    const note = shown.length === 0 ? message : `\n\n[${message}]`
    return { ...outcome('error'), text: shown + note, unsaved: unsaved + note }
  }
}
