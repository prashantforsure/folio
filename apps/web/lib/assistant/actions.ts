'use server'

import type { AssistantChatId } from '@folio/contracts'
import { AssistantChatIdSchema } from '@folio/contracts'
import { createChat, deleteChat, listChats, listMessages, readChat } from '@folio/db'

import { isRefusal, openEpisode } from '../script/gate'
import type { ChatResult, ChatsResult, SimpleAssistantResult } from './result'
import { chatRowOf, messageRowOf } from './result'

/**
 * The assistant panel's reads and small writes. The one big write - asking
 * - streams, and a server action cannot stream, so it lives in
 * `app/api/assistant/route.ts` behind the same gate.
 *
 * Episode-scoped: a chat is about one episode's script, so every action
 * takes the episode and refuses a chat that belongs to another.
 */

export const listAssistantChats = async (projectId: string, episode: string): Promise<ChatsResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const chats = await listChats(gate.scope, gate.episode.id)
  return { status: 'ok', chats: chats.map(chatRowOf) }
}

export const startAssistantChat = async (projectId: string, episode: string): Promise<ChatResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const chat = await createChat(gate.scope, gate.episode.id)
  return { status: 'ok', chat: chatRowOf(chat), messages: [] }
}

export const openAssistantChat = async (
  projectId: string,
  episode: string,
  chatId: string,
): Promise<ChatResult> => {
  const id = AssistantChatIdSchema.safeParse(chatId)
  if (!id.success) return { status: 'error', message: 'That chat could not be found.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const chat = await readChat(gate.scope, id.data as AssistantChatId)
  if (chat === null || chat.episodeId !== gate.episode.id) {
    return { status: 'error', message: 'That chat could not be found.' }
  }
  const messages = await listMessages(gate.scope, chat.id)
  return { status: 'ok', chat: chatRowOf(chat), messages: messages.map(messageRowOf) }
}

export const deleteAssistantChat = async (
  projectId: string,
  episode: string,
  chatId: string,
): Promise<SimpleAssistantResult> => {
  const id = AssistantChatIdSchema.safeParse(chatId)
  if (!id.success) return { status: 'error', message: 'That chat could not be found.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await deleteChat(gate.scope, id.data as AssistantChatId)
  return { status: 'done' }
}
