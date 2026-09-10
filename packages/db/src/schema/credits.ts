import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { idColumn, projectIdColumn, timestampColumn } from './columns'
import { ledgerEntryKindEnum, projects, users } from './tenancy'

/**
 * The credits ledger. Append-only, and there is no balance column anywhere.
 *
 * AGENTS.md, Jobs, credits and cost: "The credits ledger is **append-only** and
 * the balance is **computed, never stored**." The exception table repeats it as
 * a case where storing a computable value is specifically forbidden: "The
 * ledger is the truth. Compute from the append-only ledger. Never store a
 * balance."
 *
 * There is no `balance` column on this table, on `projects`, on `memberships`
 * or anywhere else in this schema - not even a cached one with a `balance_as_of`
 * beside it. The balance is a view, `credit_balances`, created in
 * `0001_rls_and_grants.sql`. A view has no writer and cannot drift.
 *
 * ## Append-only, three times over
 *
 * Money gets one mechanism per failure mode, because a single one is a single
 * point of failure:
 *
 *   1. The repository exposes `append` and nothing else. No update, no delete.
 *   2. A trigger raises on `UPDATE` and `DELETE`.
 *   3. `UPDATE` and `DELETE` are revoked from `authenticated` and `anon`.
 *
 * The first is a compile-time fact, the second stops a `psql` session and the
 * third stops a compromised anon key. They are deliberately not the same
 * mechanism twice.
 *
 * AGENTS.md, When to ask first lists "credits, the ledger, refunds, or anything
 * Dodo" as needing a question first. This phase writes the table, its
 * constraints and its repository. It decides no pricing, no allowance and no
 * refund policy.
 */

/**
 * One entry. AUTHORED - and immutable once written.
 *
 * `delta` is signed and integral, and the check constraint ties its sign to the
 * kind, so a `spend` that credits the account is rejected by the database
 * rather than by a code review.
 *
 * A `reserve` is negative and is written **before** the job is enqueued -
 * AGENTS.md: "**Reserve then execute.** The balance check happens *before* the
 * job is enqueued, never inside it." It is later either released, if the job
 * never ran, or converted to a spend. `release` and `refund` are both positive
 * and both undo a charge, and they are separate because they answer different
 * questions: a release means nothing was consumed, a refund means something was
 * and we are absorbing it. Collapsing them makes "what did failure cost us"
 * unanswerable from the only place it could be answered.
 *
 * `job_id` is a forward reference with no foreign key - jobs are not a table in
 * this phase. It is written now rather than added later because every entry
 * after a reservation has to be attributable to the same piece of work, and a
 * column added later to an append-only table can never be filled in for the
 * rows that came before it.
 *
 * `idempotency_key` is unique, and that uniqueness is the whole of AGENTS.md's
 * "webhooks reconciled idempotently". A Dodo webhook delivered twice must
 * insert once, and a check-then-insert races - so the constraint is in the
 * database, and the repository's `append` treats a unique violation as success.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'restrict' }),
    kind: ledgerEntryKindEnum('kind').notNull(),
    /** Signed. Negative for reserve, spend and expire. Never zero. */
    delta: integer('delta').notNull(),
    /** The BullMQ job this belongs to. No FK: jobs are not a table yet. */
    jobId: uuid('job_id'),
    /** Dodo's reference on a purchase or a refund. Null otherwise. */
    externalRef: text('external_ref'),
    /** Unique. What makes a redelivered webhook insert once. */
    idempotencyKey: text('idempotency_key').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: timestampColumn('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    /**
     * Unique per project, not globally: two projects reconciling the same
     * upstream event is legitimate, and a global key would make the second one
     * silently vanish.
     */
    uniqueIndex('credit_ledger_idempotency_key').on(table.projectId, table.idempotencyKey),
    /** The index the balance view reads. Every query here is per project. */
    index('credit_ledger_project_occurred_idx').on(table.projectId, table.occurredAt),
    index('credit_ledger_job_idx').on(table.jobId),
    /**
     * A reservation still held has no matching release or spend. Finding those
     * is the hot path for `available`, so it gets its own partial index.
     */
    index('credit_ledger_reserve_idx')
      .on(table.projectId, table.jobId)
      .where(sql`kind = 'reserve'`),
    check(
      'credit_ledger_delta_matches_kind',
      sql`(
        (${table.kind} IN ('reserve', 'spend', 'expire') AND ${table.delta} < 0)
        OR (${table.kind} IN ('grant', 'purchase', 'release', 'refund') AND ${table.delta} > 0)
        OR (${table.kind} = 'adjust' AND ${table.delta} <> 0)
      )`,
    ),
    /** A human correction with no stated reason is indistinguishable from a bug. */
    check(
      'credit_ledger_adjust_states_reason',
      sql`${table.kind} <> 'adjust' OR length(btrim(coalesce(${table.reason}, ''))) > 0`,
    ),
  ],
)

/**
 * `ON DELETE restrict`, not `cascade`, and that is the odd one out in this
 * schema.
 *
 * Every other table cascades from `projects` because deleting a project should
 * take its work with it. The ledger is money: an append-only record that a
 * `DELETE FROM projects` can erase is not append-only. Restricting means a
 * project with ledger history cannot be hard-deleted at all, which is correct -
 * AGENTS.md already requires asking before deleting user data, and `trashed_at`
 * on `projects` is the soft delete that this phase actually uses.
 */
