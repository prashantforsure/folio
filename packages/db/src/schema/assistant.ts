import { AGENT_RUN_MODES, AGENT_RUN_STATUSES, ASSISTANT_ROLES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn, timestampColumn, updatedAtColumn } from './columns'
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
 * No cost column, and now by ruling rather than by omission: ADR 0003 **D3**
 * (2026-09-23) closed AGENTS.md open decision 13 - conversation turns are
 * **not charged** at launch, and what is recorded per run is tokens, on
 * `agent_runs`. A chat writes no ledger row and reserves nothing. If turns
 * are ever priced, the entry links here by `chat_id` the way a generation
 * links to its job, and the token counts to price them with are already
 * there.
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
    /** What the panel prints. Empty only when `content` carries the turn - a tool call or its result. */
    body: text('body').notNull(),
    /**
     * The API's content blocks, verbatim (roadmap task 2.1, `0034`): `text`,
     * `tool_use`, `tool_result`. Replayed on the next turn, because the API
     * refuses a tool call whose result has gone missing. Null on every turn
     * written before the agent loop, which replays from `body` as it always did.
     */
    content: jsonb('content').$type<readonly Readonly<Record<string, unknown>>[]>(),
    /** The run that wrote it. `set null`: a run row outliving its chat is the token meter, not the transcript. */
    runId: uuid('run_id').references((): AnyPgColumn => agentRuns.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index('assistant_messages_chat_idx').on(table.chatId, table.createdAt),
    index('assistant_messages_project_idx').on(table.projectId),
    check('assistant_messages_body_or_content', sql`length(btrim(${table.body})) > 0 or ${table.content} is not null`),
  ],
)

/**
 * `agent_runs` - one row per agent task. AUTHORED by the system on a request
 * (roadmap task 2.1, migration `0034`).
 *
 * ADR 0003 **D3**: conversation turns are free, and their tokens are
 * **recorded per run** here so the per-user daily cap has a meter and a later
 * pricing decision has data. D3 also says every run starts with a **credit
 * budget of 0**, granted by a human in a confirmation - the default below is
 * that rule, and `credits_spent <= credit_budget` is its check. Its id is the
 * `provenance_run_id` an agent-written node will carry (D11, Phase 3).
 *
 * ## Why the links are `set null`, not `cascade`
 *
 * The chat, the message and the episode are what the run was *about*; the row
 * is also the token meter. Deleting a chat must not hand its writer a fresh
 * daily allowance, so the run outlives it with its counts. Deleting the
 * project deletes the run - every row here carries `project_id` (AGENTS.md,
 * Tenancy), which is also why a launcher turn outside a project has no row.
 */
export const agentRunStatusEnum = pgEnum('agent_run_status', AGENT_RUN_STATUSES)

export const agentRunModeEnum = pgEnum('agent_run_mode', AGENT_RUN_MODES)

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    chatId: uuid('chat_id').references(() => assistantChats.id, { onDelete: 'set null' }),
    /** The writer's message that started the run. */
    messageId: uuid('message_id').references((): AnyPgColumn => assistantMessages.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: agentRunStatusEnum('status').notNull().default('queued'),
    mode: agentRunModeEnum('mode').notNull().default('interactive'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    creditBudget: integer('credit_budget').notNull().default(0),
    creditsSpent: integer('credits_spent').notNull().default(0),
    /** The reason in the writer's terms when `status` is `failed`. */
    error: text('error'),
    createdAt: createdAtColumn(),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('agent_runs_project_idx').on(table.projectId, table.status),
    index('agent_runs_creator_day_idx').on(table.createdBy, table.createdAt),
    index('agent_runs_chat_idx').on(table.chatId),
    check('agent_runs_tokens_nonnegative', sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`),
    check('agent_runs_budget', sql`${table.creditBudget} >= 0 and ${table.creditsSpent} >= 0 and ${table.creditsSpent} <= ${table.creditBudget}`),
  ],
)
