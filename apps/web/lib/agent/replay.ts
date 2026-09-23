import type { AssistantMessage } from '@folio/contracts'
import type Anthropic from '@anthropic-ai/sdk'

import type { ToolCall } from './loop'

/**
 * A chat's stored turns, as the API is replayed them (roadmap task 2.3).
 *
 * Since `0034` a turn may carry the API's own content blocks
 * (`assistant_messages.content`): the model's `text` and `tool_use`, and the
 * `tool_result`s the loop answered them with. The next turn sends them back,
 * because the model's earlier reads are part of what it knows. A turn written
 * before the loop has only a body, and replays as text, as it always did.
 *
 * ## What is repaired, and why
 *
 * The API refuses a conversation that does not hold together, and a stored
 * chat can come apart in three ways this function mends rather than lets a
 * writer's next question fail on:
 *
 *   - **A tool call with no answer.** An aborted turn (a closed tab, a lost
 *     connection) can store the model's `tool_use` without the `tool_result`
 *     the loop never got to write. Every `tool_use` must be answered in the
 *     very next message, so an unanswered one is dropped, and a
 *     `tool_result` whose call is gone is dropped with it.
 *   - **Two turns from the same side in a row.** A dropped message can leave
 *     two user turns adjacent; they are merged into one.
 *   - **Fields the API does not take back.** A stored block is the SDK's
 *     response shape (`citations: null` and the like); only the fields a
 *     request carries are replayed.
 *
 * Pure: rows in, messages out. `tests/agent-replay.test.ts`.
 */

type Block = Readonly<Record<string, unknown>>

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** One stored block as a request block, or null for a kind a request cannot carry. */
const requestBlock = (block: Block): Anthropic.ContentBlockParam | null => {
  switch (block['type']) {
    case 'text': {
      const text = asText(block['text'])
      return text.length === 0 ? null : { type: 'text', text }
    }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: asText(block['id']),
        name: asText(block['name']),
        input: (block['input'] ?? {}) as Record<string, unknown>,
      }
    case 'tool_result': {
      const content = block['content']
      return {
        type: 'tool_result',
        tool_use_id: asText(block['tool_use_id']),
        content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
        ...(block['is_error'] === true ? { is_error: true } : {}),
      }
    }
    default:
      return null
  }
}

type Draft = { role: 'user' | 'assistant'; blocks: Anthropic.ContentBlockParam[] }

const blocksOf = (message: AssistantMessage): Anthropic.ContentBlockParam[] => {
  if (message.content === null) return message.body.trim().length === 0 ? [] : [{ type: 'text', text: message.body }]
  return message.content.flatMap((block) => {
    const request = requestBlock(block)
    return request === null ? [] : [request]
  })
}

/**
 * A background run's transcript, ready to go on - roadmap task 4.4.
 *
 * A worker that dies mid-step leaves one of three endings, and each is read
 * here rather than repaired away:
 *
 *   - **the model's calls, unanswered** - it died between the model's answer
 *     and the results. `replayOf` would drop them; a resumed run answers them
 *     instead, with their own ids (`pending`), so a write already proposed is
 *     found again rather than proposed twice (D13).
 *   - **the model's last word, with no call** - the run had finished and only
 *     its status was lost. `finished`: nothing to go on with.
 *   - **a user turn** - the brief, a step's results, or the writer's reply.
 *     The next model call picks up from it.
 */
export type Resume = {
  readonly messages: Anthropic.MessageParam[]
  readonly pending: readonly ToolCall[]
  readonly finished: boolean
}

export const resumeOf = (stored: readonly AssistantMessage[]): Resume => {
  const lastIndex = stored.findLastIndex((message) => blocksOf(message).length > 0)
  const last = stored[lastIndex]
  if (last === undefined || last.role === 'user') return { messages: replayOf(stored), pending: [], finished: false }
  const blocks = blocksOf(last)
  const pending = blocks.flatMap((block): ToolCall[] => (block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []))
  if (pending.length === 0) return { messages: replayOf(stored), pending: [], finished: true }
  const messages = replayOf(stored.slice(0, lastIndex))
  const previous = messages.at(-1)
  if (previous?.role === 'assistant') {
    // Two model turns in a row (a step cut off before its results): one message, as the API takes it.
    const earlier = typeof previous.content === 'string' ? [{ type: 'text' as const, text: previous.content }] : previous.content
    messages[messages.length - 1] = { role: 'assistant', content: [...earlier, ...blocks] }
  } else {
    messages.push({ role: 'assistant', content: blocks })
  }
  return { messages, pending, finished: false }
}

export const replayOf = (messages: readonly AssistantMessage[]): Anthropic.MessageParam[] => {
  const drafts: Draft[] = messages.map((message) => ({ role: message.role, blocks: blocksOf(message) }))

  // Answer every tool call in the message after it, or drop it; drop results whose call is gone.
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    if (draft === undefined) continue
    if (draft.role === 'assistant') {
      const next = drafts[index + 1]
      const answered = new Set(
        next?.role === 'user'
          ? next.blocks.flatMap((block) => (block.type === 'tool_result' ? [block.tool_use_id] : []))
          : [],
      )
      draft.blocks = draft.blocks.filter((block) => block.type !== 'tool_use' || answered.has(block.id))
    } else {
      const previous = drafts[index - 1]
      const asked = new Set(
        previous?.role === 'assistant' ? previous.blocks.flatMap((block) => (block.type === 'tool_use' ? [block.id] : [])) : [],
      )
      draft.blocks = draft.blocks.filter((block) => block.type !== 'tool_result' || asked.has(block.tool_use_id))
    }
  }

  // Drop the empty, merge neighbours from the same side.
  const merged: Draft[] = []
  for (const draft of drafts) {
    if (draft.blocks.length === 0) continue
    const last = merged.at(-1)
    if (last !== undefined && last.role === draft.role) last.blocks.push(...draft.blocks)
    else merged.push({ role: draft.role, blocks: [...draft.blocks] })
  }
  // A conversation opens with the writer.
  while (merged[0]?.role === 'assistant') merged.shift()

  return merged.map((draft) => {
    const only = draft.blocks[0]
    // A lone text block replays as a plain string - the pre-loop shape, byte for byte.
    if (draft.blocks.length === 1 && only?.type === 'text') return { role: draft.role, content: only.text }
    return { role: draft.role, content: draft.blocks }
  })
}
