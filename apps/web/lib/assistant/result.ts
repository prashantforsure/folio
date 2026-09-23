import type { AssistantChat, AssistantMessage } from '@folio/contracts'

import type { RunView } from '../agent/runs'

/**
 * What the assistant's actions hand back, and what the panel holds.
 * Discriminated, never a throw across the boundary.
 */

/** A chat as the panel lists it. */
export type ChatRow = {
  readonly id: string
  readonly title: string | null
  readonly updatedAt: string
}

export type MessageRow = {
  readonly id: string
  readonly role: AssistantMessage['role']
  readonly body: string
  readonly createdAt: string
  /** The proposals this answer made, by id - read back from the stored tool results (roadmap task 3.3). */
  readonly proposals?: readonly string[]
  /** The background runs this answer started (roadmap task 4.4), read back the same way. */
  readonly runs?: readonly RunStarted[]
}

/** A background run as the answer that started it names it: the run card's handle. */
export type RunStarted = { readonly runId: string; readonly chatId: string; readonly title: string }

export const chatRowOf = (chat: AssistantChat): ChatRow => ({
  id: chat.id,
  title: chat.title,
  updatedAt: chat.updatedAt,
})

export const messageRowOf = (message: AssistantMessage): MessageRow => ({
  id: message.id,
  role: message.role,
  body: message.body,
  createdAt: message.createdAt,
})

/**
 * A chat's stored turns as the panel prints them (roadmap task 2.3).
 *
 * Since the agent loop, one answer can be several stored messages: the
 * model's text before a tool call, the tool results (a `user` turn with no
 * body - the API's shape, not the writer's words), the text after. The panel
 * shows what the writer saw: their questions, and each answer as one turn, its
 * pieces joined as the stream joined them. A message with no text is not
 * shown; the transcript the API replays is `lib/agent/replay.ts`'s business.
 */
export const visibleMessages = (messages: readonly AssistantMessage[]): readonly MessageRow[] => {
  const rows: MessageRow[] = []
  // Proposal ids live in the tool results - a `user` turn with no body - and
  // belong to the answer they were made in: the next assistant row, or the
  // last one when the turn ended on the call.
  let waiting: string[] = []
  let started: RunStarted[] = []
  const attach = (index: number): void => {
    const row = rows[index]
    if (row === undefined) return
    if (waiting.length > 0) rows[index] = { ...row, proposals: [...new Set([...(row.proposals ?? []), ...waiting])] }
    if (started.length > 0) {
      const current = rows[index]
      if (current !== undefined) rows[index] = { ...current, runs: [...(current.runs ?? []), ...started.filter((run) => !(current.runs ?? []).some((known) => known.runId === run.runId))] }
    }
    waiting = []
    started = []
  }
  for (const message of messages) {
    waiting.push(...proposalIdsIn(message.content))
    started.push(...runsIn(message.content))
    if (message.body.trim().length === 0) continue
    const last = rows.at(-1)
    if (message.role === 'assistant' && last?.role === 'assistant') {
      rows[rows.length - 1] = { ...last, body: `${last.body}

${message.body}` }
      attach(rows.length - 1)
      continue
    }
    rows.push(messageRowOf(message))
    if (message.role === 'assistant') attach(rows.length - 1)
  }
  const lastAssistant = rows.findLastIndex((row) => row.role === 'assistant')
  if (lastAssistant !== -1) attach(lastAssistant)
  return rows
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The `proposalId`s a stored message's tool results carry. A result that is not JSON, or names none, carries none. */
export const proposalIdsIn = (content: AssistantMessage['content']): readonly string[] => {
  if (content === null) return []
  const ids: string[] = []
  for (const block of content) {
    if (block['type'] !== 'tool_result' || typeof block['content'] !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(block['content'])
      if (typeof parsed === 'object' && parsed !== null && 'proposalId' in parsed && typeof parsed.proposalId === 'string' && UUID.test(parsed.proposalId)) {
        if (!ids.includes(parsed.proposalId)) ids.push(parsed.proposalId)
      }
    } catch {
      // Not JSON - an error message, not a proposal.
    }
  }
  return ids
}

/** The background runs a stored message's tool results started - `start_background_task`'s `result` (roadmap task 4.4). */
export const runsIn = (content: AssistantMessage['content']): readonly RunStarted[] => {
  if (content === null) return []
  const runs: RunStarted[] = []
  for (const block of content) {
    if (block['type'] !== 'tool_result' || typeof block['content'] !== 'string') continue
    try {
      const parsed: unknown = JSON.parse(block['content'])
      if (typeof parsed !== 'object' || parsed === null || !('result' in parsed)) continue
      const result = parsed.result
      if (typeof result !== 'object' || result === null || !('runId' in result) || !('chatId' in result) || !('title' in result)) continue
      const { runId, chatId, title } = result
      if (typeof runId === 'string' && UUID.test(runId) && typeof chatId === 'string' && UUID.test(chatId) && typeof title === 'string' && !runs.some((run) => run.runId === runId)) {
        runs.push({ runId, chatId, title })
      }
    } catch {
      // Not JSON - an error message, not a run.
    }
  }
  return runs
}

export type ChatsResult =
  | { readonly status: 'ok'; readonly chats: readonly ChatRow[] }
  | { readonly status: 'refused'; readonly message: string }

export type ChatResult =
  /** `run`: the background run that works in this chat, when it is one's (roadmap task 4.4). */
  | { readonly status: 'ok'; readonly chat: ChatRow; readonly messages: readonly MessageRow[]; readonly run?: RunView | null }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type SimpleAssistantResult =
  | { readonly status: 'done' }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
