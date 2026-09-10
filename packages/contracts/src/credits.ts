import { z } from 'zod'

import { LedgerEntryKindSchema } from './enums'
import { JobIdSchema, LedgerEntryIdSchema, ProjectIdSchema, UserIdSchema } from './ids'
import { CreditDeltaSchema, TimestampSchema } from './primitives'

/**
 * The credits ledger. Append-only, and there is no balance anywhere in it.
 *
 * AGENTS.md, Jobs, credits and cost: "The credits ledger is **append-only** and
 * the balance is **computed, never stored**." The exception table repeats it as
 * a case where storing a computable value is specifically forbidden: "The
 * ledger is the truth. Compute from the append-only ledger. Never store a
 * balance."
 *
 * Look for a `balance` field below and there is not one, on any schema, in any
 * form - not on the project, not on a membership, not cached with a
 * `balanceAsOf` beside it. `CreditBalanceSchema` at the foot of the file is a
 * **read model**: the shape of an answer computed by summing the ledger. It is
 * a view in `packages/db`, not a table, and it has no writer.
 *
 * Append-only is enforced three times over, deliberately, because a single
 * mechanism here is a single point of failure for money:
 *
 *   1. The repository exposes `append` and nothing else - no update, no delete.
 *   2. A trigger raises on `UPDATE` and `DELETE`.
 *   3. `UPDATE` and `DELETE` are revoked from every role but the owner.
 *
 * AGENTS.md, When to ask first lists "credits, the ledger, refunds, or anything
 * Dodo" as needing a question before it is touched. This phase writes the
 * table, its constraints and its repository; it decides no pricing, no
 * allowance and no refund policy.
 */

/**
 * One entry.
 *
 * `delta` is signed and integral. A `reserve` is negative and is written
 * **before** the job is enqueued - AGENTS.md: "**Reserve then execute.** The
 * balance check happens *before* the job is enqueued, never inside it." The
 * reservation is later either released, if the job never ran, or converted to a
 * spend.
 *
 * `jobId` is a forward reference with no foreign key: jobs are not a table in
 * this phase. It is stored rather than deferred because every entry after a
 * reservation has to be attributable to the same piece of work, and adding the
 * column later to an append-only table means the early rows can never carry it.
 *
 * `externalRef` is the Dodo Payments reference on a `purchase`, and the reason
 * `idempotencyKey` is unique: AGENTS.md, Tech stack requires Dodo webhooks to
 * be "reconciled idempotently", and a webhook delivered twice must insert once.
 * The uniqueness is a database constraint, not a check-then-insert, because
 * check-then-insert races.
 *
 * `reason` is required on `adjust` - a human correction with no stated reason
 * is indistinguishable from a bug.
 */
export const LedgerEntrySchema = z
  .object({
    id: LedgerEntryIdSchema,
    projectId: ProjectIdSchema,
    kind: LedgerEntryKindSchema,
    /** Signed. Negative for reserve, spend and expire. */
    delta: CreditDeltaSchema,
    /** The BullMQ job this belongs to. No FK: jobs are not a table yet. */
    jobId: JobIdSchema.nullable(),
    /** Dodo's reference on a purchase, or a refund's. Null otherwise. */
    externalRef: z.string().trim().min(1).max(200).nullable(),
    /** Unique. What makes a redelivered webhook insert once. */
    idempotencyKey: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1_000).nullable(),
    createdBy: UserIdSchema.nullable(),
    occurredAt: TimestampSchema,
  })
  .refine(
    (value) =>
      value.kind === 'adjust' ? value.reason !== null && value.reason.length > 0 : true,
    'An adjust entry must say why.',
  )
  .refine((value) => {
    const negative = value.kind === 'reserve' || value.kind === 'spend' || value.kind === 'expire'
    const positive =
      value.kind === 'grant' ||
      value.kind === 'purchase' ||
      value.kind === 'release' ||
      value.kind === 'refund'
    if (negative) return value.delta < 0
    if (positive) return value.delta > 0
    // `adjust` is the only signed kind, and it may not be a no-op.
    return value.delta !== 0
  }, 'A ledger entry moves the balance in the direction its kind implies, and never by zero.')

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>

/**
 * A balance, computed.
 *
 * Never persisted. `available` is what a cost check may spend: the settled
 * balance minus everything currently reserved against a job that has not
 * finished. Naming them separately is what lets a button show a real number
 * while a reel is generating.
 *
 * `asOf` is here so a caller can see how fresh the sum is. It is not a cache
 * key and nothing writes it to a row.
 */
export const CreditBalanceSchema = z.object({
  projectId: ProjectIdSchema,
  /** Sum of every entry. */
  settled: CreditDeltaSchema,
  /** Sum of reservations not yet released or spent. Zero or negative. */
  reserved: CreditDeltaSchema,
  /** `settled` less what is held. What a cost check compares against. */
  available: CreditDeltaSchema,
  asOf: TimestampSchema,
})

export type CreditBalance = z.infer<typeof CreditBalanceSchema>
