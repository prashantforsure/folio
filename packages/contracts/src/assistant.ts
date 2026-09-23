import { z } from 'zod'

import { AgentRouteSchema } from './agent'
import {
  AssistantChatIdSchema,
  AssistantMessageIdSchema,
  CharacterIdSchema,
  EpisodeIdSchema,
  LocationIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  RunIdSchema,
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

/**
 * The API's content blocks for one message, stored as they were sent or
 * received (roadmap task 2.1): `text`, `tool_use` and `tool_result`. The next
 * turn replays them, because the API refuses a conversation whose tool call
 * has lost its result. Opaque here on purpose - the shape is the SDK's, and
 * `apps/web/lib/agent/replay.ts` is the one reader that interprets it.
 */
export const AssistantContentSchema = z.array(z.record(z.string(), z.unknown()))

export type AssistantContent = z.infer<typeof AssistantContentSchema>

/**
 * A turn. `body` is what the panel prints; `content` is what the API is
 * replayed. A message that is only a tool call or only a tool result has an
 * empty body and a content list - never neither (migration `0034`'s check).
 * `runId` is the agent run that wrote it; a writer's question carries it too,
 * because the run is started by it.
 */
export const AssistantMessageSchema = z
  .object({
    id: AssistantMessageIdSchema,
    projectId: ProjectIdSchema,
    chatId: AssistantChatIdSchema,
    role: AssistantRoleSchema,
    body: z.string().max(ASSISTANT_MESSAGE_MAX),
    content: AssistantContentSchema.nullable(),
    runId: RunIdSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .refine((message) => message.body.trim().length > 0 || message.content !== null, {
    message: 'A message has a body, a content list, or both.',
  })

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>

/**
 * What a turn reads. `episode` is the panel's standing since 2026-09-16 -
 * one episode's script. `project` is every episode, in order, with
 * `[E2 Sc 9]` markers so an answer can cite across them; the Characters
 * route sends it (ruled 2026-09-17: the assistant may read the whole
 * project on `/characters`) and the Locations route since 2026-09-18 (the
 * same ruling, with the location records beside the cast); only those two,
 * because the widening is per route and AGENTS.md puts every widening
 * behind a question.
 */
export const ASK_SCOPES = ['episode', 'project'] as const

export type AskScope = (typeof ASK_SCOPES)[number]

export const AskScopeSchema = z.enum(ASK_SCOPES)

/**
 * What the writer has open: the Characters drawer's record, or - since the
 * Locations rebuild (ruled 2026-09-18: the assistant reads the location
 * records on `/locations`) - the Locations drawer's. The server builds the
 * Focus block from the id (name, spellings, the record as written, the
 * counts) so the model knows which person "she" or which place "there"
 * is; a stale id is no block and no error.
 */
export const AskFocusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), id: CharacterIdSchema }),
  z.object({ kind: z.literal('location'), id: LocationIdSchema }),
  /** The Timeline drawer's scene (the Timeline rebuild, phase 5): its story time, neighbours and findings. */
  z.object({ kind: z.literal('scene'), id: NodeIdSchema }),
])

export type AskFocus = z.infer<typeof AskFocusSchema>

/** The most node ids a selection carries. A selection past this is a whole act; the first ones say where it is. */
export const ASK_SELECTION_MAX = 200

/**
 * What the writer has selected in an editor (roadmap task 2.6): the ids of the
 * blocks the selection touches, in document order - the caret's block when
 * nothing is selected. Ids, never text: the server reads the text from the
 * stored document, so a selection cannot smuggle in words the script does not
 * hold. `script` from the Script editor, `outline` from the Outline's.
 */
export const AskSelectionSchema = z.object({
  kind: z.enum(['script', 'outline']),
  nodeIds: z.array(NodeIdSchema).max(ASK_SELECTION_MAX),
})

export type AskSelection = z.infer<typeof AskSelectionSchema>

/** The request body the streaming route reads (`POST /api/assistant`). */
export const AskInputSchema = z.object({
  projectId: z.string(),
  episode: z.string(),
  chatId: AssistantChatIdSchema,
  message: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX),
  scope: AskScopeSchema.default('episode'),
  focus: AskFocusSchema.optional(),
  /** The Locations route's turn: the location records go into the system block beside the cast (ruled 2026-09-18). Project scope only. */
  places: z.boolean().optional(),
  /** The Timeline route's turn: every scene's story time and threads go into the system block (the Timeline rebuild, phase 5). Project scope only. */
  timeline: z.boolean().optional(),
  /**
   * The workspace route the writer is on (roadmap task 2.3). The agent loop
   * offers the core toolset and this route's (`apps/web/lib/agent/registry.ts`,
   * `toolsetForRoute`). Absent: the core toolset alone.
   */
  route: AgentRouteSchema.optional(),
  /** The editor selection, on the Script and Outline routes (roadmap task 2.6). */
  selection: AskSelectionSchema.optional(),
})

export type AskRequest = z.input<typeof AskInputSchema>
