'use server'

import type { AssistantChatId } from '@folio/contracts'
import { AssistantChatIdSchema } from '@folio/contracts'
import { countRunSteps, createChat, deleteChat, listChats, listMessages, listRunProposals, readBackgroundRun, readChat, readChatRun } from '@folio/db'

import { checkpointOf, runViewOf } from '../agent/runs'
import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode } from '../script/gate'
import type { ChatResult, ChatsResult, SimpleAssistantResult } from './result'
import { chatRowOf, visibleMessages } from './result'

/**
 * The assistant panel's reads and small writes. The one big write - asking
 * - streams, and a server action cannot stream, so it lives in
 * `app/api/assistant/route.ts` behind the same gate.
 *
 * Episode-scoped: a chat is about one episode's script, so every action
 * takes the episode and refuses a chat that belongs to another.
 */

export const listAssistantChats = async (projectId: string, episode: string): Promise<ChatsResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.assistant)
  if (isRefusal(gate)) return gate
  const chats = await listChats(gate.scope, gate.episode.id)
  return { status: 'ok', chats: chats.map(chatRowOf) }
}

export const startAssistantChat = async (projectId: string, episode: string): Promise<ChatResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.assistant)
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
  const gate = await openEpisode(projectId, episode, ROLE.assistant)
  if (isRefusal(gate)) return gate
  const chat = await readChat(gate.scope, id.data as AssistantChatId)
  if (chat === null || chat.episodeId !== gate.episode.id) {
    return { status: 'error', message: 'That chat could not be found.' }
  }
  const [messages, chatRun] = await Promise.all([listMessages(gate.scope, chat.id), readChatRun(gate.scope, chat.id)])
  // A background run's own chat (roadmap task 4.4): the panel polls it while the run is live, and routes the composer to it.
  const run = chatRun === null ? null : await readBackgroundRun(gate.scope, chatRun.id)
  const view =
    run === null
      ? null
      : runViewOf(
          run.run,
          run.input,
          await listRunProposals(gate.scope, run.run.id),
          await countRunSteps(gate.scope, run.run.id),
          gate.actor,
          await checkpointOf(gate.scope, run.run, run.input),
        )
  return { status: 'ok', chat: chatRowOf(chat), messages: visibleMessages(messages), run: view }
}

/**
 * Delete a chat of **this** episode.
 *
 * The scope alone is not enough here. It proves the row is this project's,
 * which the header's promise is not - a chat is about one episode's script,
 * and a project has many episodes. `openAssistantChat` has always read the
 * row back and compared `episodeId`; this did not, so a member could delete a
 * chat belonging to a sibling episode by passing its id (the id is in no page
 * that draws another episode, but an id is not a secret and a server action is
 * a public endpoint). Same check, same refusal, same words.
 */
export const deleteAssistantChat = async (
  projectId: string,
  episode: string,
  chatId: string,
): Promise<SimpleAssistantResult> => {
  const id = AssistantChatIdSchema.safeParse(chatId)
  if (!id.success) return { status: 'error', message: 'That chat could not be found.' }
  const gate = await openEpisode(projectId, episode, ROLE.assistant)
  if (isRefusal(gate)) return gate
  const chat = await readChat(gate.scope, id.data as AssistantChatId)
  if (chat === null || chat.episodeId !== gate.episode.id) {
    return { status: 'error', message: 'That chat could not be found.' }
  }
  await deleteChat(gate.scope, chat.id)
  return { status: 'done' }
}
