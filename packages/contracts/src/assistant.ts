import { z } from 'zod'

import {
  AssistantChatIdSchema,
  AssistantMessageIdSchema,
  EpisodeIdSchema,
  ProjectIdSchema,
  UserIdSchema,
} from './ids'
import { TimestampSchema } from './primitives'

/**
 * The assistant's chats - the 400px panel the orb opens
 * (`docs/ui design/README.md`, "Assistant").
 *
 * ## What this is, and what it is not yet
 *
 * A chat is a read-only conversation about the current episode's script.
 * The model reads the script and the cast as context and answers; it writes
 * nothing. AGENTS.md's agent - Brief -> Plan -> Run -> Review -> Commit, every
 * write a proposal - is the same panel's later life, and this shape does not
 * prejudge it: a run would be a message with a proposal attached, and the
 * chat is where it would be attached. Ruled 2026-09-16: "real, read-only,
 * persisted" for the Script route's redesign pass.
 *
 * ## Per episode
 *
 * The context is one episode's script, so a chat belongs to an episode and
 * the panel lists the episode's chats. Every row still carries `projectId`
 * (AGENTS.md, Tenancy); `episodeId` is the narrower key.
 *
 * `title` is the first user message, cut to a line, set when the chat gets
 * its first message. Nothing is summarised by a model to name a chat - a
 * report never calls a model, and neither does a list.
 */

export const ASSISTANT_ROLES = ['user', 'assistant'] as const

export type AssistantRole = (typeof ASSISTANT_ROLES)[number]

export const AssistantRoleSchema = z.enum(ASSISTANT_ROLES)

/** The longest message either side may hold. A script question is short; an answer is not a novel. */
export const ASSISTANT_MESSAGE_MAX = 40_000

export const AssistantChatSchema = z.object({
  id: AssistantChatIdSchema,
  projectId: ProjectIdSchema,
  episodeId: EpisodeIdSchema,
  title: z.string().max(200).nullable(),
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type AssistantChat = z.infer<typeof AssistantChatSchema>

export const AssistantMessageSchema = z.object({
  id: AssistantMessageIdSchema,
  projectId: ProjectIdSchema,
  chatId: AssistantChatIdSchema,
  role: AssistantRoleSchema,
  body: z.string().min(1).max(ASSISTANT_MESSAGE_MAX),
  createdAt: TimestampSchema,
})

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>
