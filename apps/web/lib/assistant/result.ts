import type { AssistantChat, AssistantMessage } from '@folio/contracts'

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
}

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
  for (const message of messages) {
    if (message.body.trim().length === 0) continue
    const last = rows.at(-1)
    if (message.role === 'assistant' && last?.role === 'assistant') {
      rows[rows.length - 1] = { ...last, body: `${last.body}\n\n${message.body}` }
      continue
    }
    rows.push(messageRowOf(message))
  }
  return rows
}

export type ChatsResult =
  | { readonly status: 'ok'; readonly chats: readonly ChatRow[] }
  | { readonly status: 'refused'; readonly message: string }

export type ChatResult =
  | { readonly status: 'ok'; readonly chat: ChatRow; readonly messages: readonly MessageRow[] }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }

export type SimpleAssistantResult =
  | { readonly status: 'done' }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
