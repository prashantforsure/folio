import { AGENT_OP_MODES, AGENT_OP_STATUSES, AGENT_PROPOSAL_STATUSES, AGENT_RUN_MODES, AGENT_RUN_STATUSES, ASSISTANT_ROLES, STORY_STAGES, STORY_STAGE_STATUSES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
    /**
     * What a background run was asked to do (`BackgroundRunInputSchema`,
     * migration `0037`, roadmap task 4.4): the worker rebuilds the run's
     * context from it on every job. Null for an interactive turn, whose
     * request carries it.
     */
    input: jsonb('input'),
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

/**
 * `agent_proposals` - a reviewable group of agent changes. AUTHORED by the
 * agent's run, decided by a person (roadmap task 3.1, migration `0035`, ADR
 * 0003 **D1**).
 *
 * `base` is what the proposal was planned against - each document's id and
 * the digest of its stored node list - so a server-side apply can refuse with
 * `stale` rather than write over what the writer typed since (D10).
 * `needs_confirmation` is fixed when the proposal is written: true when any of
 * its operations is `confirm` or `paid`, which no autonomy setting skips.
 *
 * **A proposal is a pending intention, readable only as itself.** Nothing may
 * read one to answer what the script says (ADR 0003, *Does this keep the
 * script authoritative?*); the node list is what the script says.
 */
export const agentProposalStatusEnum = pgEnum('agent_proposal_status', AGENT_PROPOSAL_STATUSES)

export const agentOpStatusEnum = pgEnum('agent_op_status', AGENT_OP_STATUSES)

export const agentOpModeEnum = pgEnum('agent_op_mode', AGENT_OP_MODES)

export const agentProposals = pgTable(
  'agent_proposals',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** The run that planned it - the `provenance_run_id` its nodes carry (D11). */
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    status: agentProposalStatusEnum('status').notNull().default('pending'),
    summary: text('summary').notNull(),
    base: jsonb('base').notNull(),
    needsConfirmation: boolean('needs_confirmation').notNull().default(false),
    creditCost: integer('credit_cost'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestampColumn('decided_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('agent_proposals_project_idx').on(table.projectId, table.createdAt),
    index('agent_proposals_run_idx').on(table.runId),
    check('agent_proposals_summary_not_empty', sql`length(btrim(${table.summary})) > 0`),
    check('agent_proposals_cost_nonnegative', sql`${table.creditCost} is null or ${table.creditCost} >= 0`),
  ],
)

/**
 * `agent_proposal_ops` - one tool call of a proposal, in order. AUTHORED
 * (`0035`).
 *
 * `idempotency_key` is the API's `tool_use` id (D13), unique per project: a
 * replayed tool call finds the operation it already made rather than
 * proposing it twice. `undo` is written just before the operation runs - the
 * prior values, a rename's restore payload, the placements that landed - and
 * is null when the operation cannot be undone.
 */
export const agentProposalOps = pgTable(
  'agent_proposal_ops',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => agentProposals.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    tool: text('tool').notNull(),
    args: jsonb('args').notNull(),
    mode: agentOpModeEnum('mode').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: agentOpStatusEnum('status').notNull().default('pending'),
    result: jsonb('result'),
    undo: jsonb('undo'),
    appliedAt: timestampColumn('applied_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('agent_proposal_ops_proposal_seq_key').on(table.proposalId, table.seq),
    uniqueIndex('agent_proposal_ops_project_key').on(table.projectId, table.idempotencyKey),
    index('agent_proposal_ops_project_idx').on(table.projectId),
    check('agent_proposal_ops_seq_nonnegative', sql`${table.seq} >= 0`),
  ],
)

export const storyStageEnum = pgEnum('story_stage', STORY_STAGES)

export const storyStageStatusEnum = pgEnum('story_stage_status', STORY_STAGE_STATUSES)

/**
 * `agent_run_stages` - what a story-to-script run has made so far, a row per
 * stage (roadmap task 4.5, migration `0038`). WRITTEN BY THE RUN: the
 * stage's output, parsed with its contract (`StageOutputSchemas`) before it
 * lands, so a paused or crashed run picks up at the stage it reached rather
 * than asking the model again for what it already has. `status` is where the
 * stage stands with the writer: `ready`, `waiting` (a checkpoint, or
 * proposals to apply) or `approved`.
 *
 * Not the script, and never read as it: the draft is proposals until the
 * writer applies them, and the script is the node list.
 */
export const agentRunStages = pgTable(
  'agent_run_stages',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    stage: storyStageEnum('stage').notNull(),
    status: storyStageStatusEnum('status').notNull().default('ready'),
    output: jsonb('output').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [uniqueIndex('agent_run_stages_run_stage_key').on(table.runId, table.stage), index('agent_run_stages_project_idx').on(table.projectId)],
)
