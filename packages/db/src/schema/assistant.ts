import { ASSISTANT_ROLES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn, updatedAtColumn } from './columns'
import { episodes, projects, users } from './tenancy'

/**
 * The assistant's chats. AUTHORED - by a person and by the model, in turns.
 *
 * `docs/ui design/README.md`, "Assistant": a 400px panel with `New chat`, a
 * composer and the conversation. Ruled 2026-09-16 for the Script route's
 * redesign pass: real, read-only, persisted. The model reads the episode's
 * script and answers; it writes nothing to the script. AGENTS.md's agent
 * lifecycle (Brief -> Plan -> Run -> Review -> Commit) is this panel's later
 * life and would attach to a message here, not replace the table.
 *
 * ## Per episode, tenant-scoped
 *
 * A chat is about one episode's script, so it carries `episode_id`; every
 * row still carries `project_id` (AGENTS.md, Tenancy) and the scope
 * machinery keys on that. Deleting an episode deletes its chats - the
 * context they were about is gone.
 *
 * ## Not the ledger
 *
 * No cost column. Whether a message costs credits is undecided (AGENTS.md
 * open decision 13, added with this table); a chat writes no ledger row and
 * reserves nothing. When it does, the entry links here by `chat_id` the way a
 * generation links to its job.
 */

export const assistantRoleEnum = pgEnum('assistant_role', ASSISTANT_ROLES)

export const assistantChats = pgTable(
  'assistant_chats',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    /** The first user message, cut to a line. Null until there is one. */
    title: text('title'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('assistant_chats_project_idx').on(table.projectId),
    index('assistant_chats_episode_idx').on(table.episodeId, table.updatedAt),
  ],
)

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => assistantChats.id, { onDelete: 'cascade' }),
    role: assistantRoleEnum('role').notNull(),
    body: text('body').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('assistant_messages_chat_idx').on(table.chatId, table.createdAt),
    index('assistant_messages_project_idx').on(table.projectId),
    check('assistant_messages_body_not_empty', sql`length(btrim(${table.body})) > 0`),
  ],
)
