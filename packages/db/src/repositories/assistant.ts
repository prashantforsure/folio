import type {
  AssistantChat,
  AssistantChatId,
  AssistantContent,
  AssistantMessage,
  AssistantRole,
  EpisodeId,
  UserId,
} from '@folio/contracts'
import type { RunId } from '@folio/script'
import { runId as brandRunId } from '@folio/script'
import { assistantChatId, assistantMessageId, episodeId as brandEpisodeId, projectId as brandProjectId } from '@folio/contracts'
import { asc, desc, eq } from 'drizzle-orm'

import { assistantChats, assistantMessages } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The assistant's chats and their turns. See `schema/assistant.ts`.
 *
 * Every read and write is scoped. A chat is created empty and titled by its
 * first user message (`appendMessage` sets the title when the chat has
 * none), so `New chat` costs one insert and an abandoned chat is an empty
 * row the list hides.
 */

const TITLE_MAX = 80

const toChat = (row: typeof assistantChats.$inferSelect): AssistantChat => ({
  id: assistantChatId(row.id),
  projectId: brandProjectId(row.projectId),
  episodeId: brandEpisodeId(row.episodeId),
  title: row.title,
  createdBy: row.createdBy as UserId,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

const toMessage = (row: typeof assistantMessages.$inferSelect): AssistantMessage => ({
  id: assistantMessageId(row.id),
  projectId: brandProjectId(row.projectId),
  chatId: assistantChatId(row.chatId),
  role: row.role,
  body: row.body,
  content: row.content === null ? null : [...row.content],
  runId: row.runId === null ? null : brandRunId(row.runId),
  createdAt: stamp(row.createdAt),
})

/** A title from a message: the first line, cut to a length, ellipsis if cut. */
export const titleFrom = (body: string): string => {
  const line = body.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (line.length <= TITLE_MAX) return line
  return `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

/** The episode's chats, newest activity first. Empty chats are included; the panel decides. */
export const listChats = async (scope: ProjectScope, episodeId: EpisodeId): Promise<readonly AssistantChat[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(assistantChats)
    .where(scoped(scope, assistantChats, eq(assistantChats.episodeId, episodeId)))
    .orderBy(desc(assistantChats.updatedAt))
  return rows.map(toChat)
}

export const readChat = async (scope: ProjectScope, chatId: AssistantChatId): Promise<AssistantChat | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(assistantChats)
    .where(scoped(scope, assistantChats, eq(assistantChats.id, chatId)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toChat(row)
}

export const createChat = async (scope: ProjectScope, episodeId: EpisodeId): Promise<AssistantChat> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: starting a chat needs an actor.')
  const inserted = await dbOf(scope)
    .insert(assistantChats)
    .values({ ...tenant(scope), episodeId, createdBy: actor })
    .returning()
  const row = inserted[0]
  if (row === undefined) throw new Error('Folio: inserting a chat returned no row.')
  return toChat(row)
}

export const listMessages = async (
  scope: ProjectScope,
  chatId: AssistantChatId,
): Promise<readonly AssistantMessage[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(assistantMessages)
    .where(scoped(scope, assistantMessages, eq(assistantMessages.chatId, chatId)))
    .orderBy(asc(assistantMessages.createdAt))
  return rows.map(toMessage)
}

/**
 * What a turn may carry beside its text (roadmap task 2.1): the API's content
 * blocks, replayed on the next turn, and the run that wrote it.
 */
export type MessageExtras = {
  readonly content?: AssistantContent | null
  readonly runId?: RunId | null
}

/**
 * Append a turn. Bumps the chat's `updated_at` so the list orders by
 * activity, and titles an untitled chat from its first user message - a
 * writer's words, never a tool result, which is a `user` turn with no body.
 */
export const appendMessage = async (
  scope: ProjectScope,
  chatId: AssistantChatId,
  role: AssistantRole,
  body: string,
  extras: MessageExtras = {},
): Promise<AssistantMessage> => {
  return dbOf(scope).transaction(async (tx) => {
    const inserted = await tx
      .insert(assistantMessages)
      .values({ ...tenant(scope), chatId, role, body, content: extras.content ?? null, runId: extras.runId ?? null })
      .returning()
    const row = inserted[0]
    if (row === undefined) throw new Error('Folio: inserting a message returned no row.')
    const current = await tx
      .select({ title: assistantChats.title })
      .from(assistantChats)
      .where(scoped(scope, assistantChats, eq(assistantChats.id, chatId)))
      .limit(1)
    const title = current[0]?.title ?? null
    await tx
      .update(assistantChats)
      .set(role === 'user' && title === null && body.trim().length > 0 ? { updatedAt: new Date(), title: titleFrom(body) } : { updatedAt: new Date() })
      .where(scoped(scope, assistantChats, eq(assistantChats.id, chatId)))
    return toMessage(row)
  })
}

export const deleteChat = async (scope: ProjectScope, chatId: AssistantChatId): Promise<void> => {
  await dbOf(scope).delete(assistantChats).where(scoped(scope, assistantChats, eq(assistantChats.id, chatId)))
}
