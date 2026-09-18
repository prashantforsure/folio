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
