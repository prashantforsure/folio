import type { CreditBalance, JobId, LedgerEntry, LedgerEntryId, UserId } from '@folio/contracts'
import { projectId as brandProjectId, toTimestamp } from '@folio/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { creditLedger } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp } from './mapping'

/**
 * The credits ledger.
 *
 * AGENTS.md, Jobs, credits and cost: the ledger is "**append-only** and the
 * balance is **computed, never stored**."
 *
 * **There is no `update` and no `delete` in this file, and there will not be
 * one.** That is the first of the three mechanisms; the trigger and the
 * revoked grants in `0001_rls_and_grants.sql` are the other two. Three, because
 * this is money and a single mechanism is a single point of failure.
 *
 * **There is no balance column to read.** `readBalance` sums the ledger. It is
 * a computation, every time, and the `credit_ledger_project_occurred_idx` index
 * is what makes that cheap enough to mean it.
 *
 * AGENTS.md, When to ask first: "Touch credits, the ledger, refunds, or
 * anything Dodo" needs a question first. This file is the plumbing. It sets no
 * price, grants no allowance and decides no refund policy - every entry's
 * amount and reason comes from its caller.
 */

const toEntry = (row: typeof creditLedger.$inferSelect): LedgerEntry => ({
  id: row.id as LedgerEntryId,
  projectId: brandProjectId(row.projectId),
  kind: row.kind,
  delta: row.delta,
  jobId: row.jobId === null ? null : (row.jobId as JobId),
  externalRef: row.externalRef,
  idempotencyKey: row.idempotencyKey,
  reason: row.reason,
  createdBy: row.createdBy === null ? null : (row.createdBy as UserId),
  occurredAt: stamp(row.occurredAt),
})

/**
 * Write one entry. The only write this repository has.
 *
 * `onConflictDoNothing` on the idempotency key is what makes AGENTS.md's
 * "webhooks reconciled idempotently" true: a Dodo delivery arriving twice
 * inserts once, and the second call is a success rather than an error, because
 * from the caller's point of view the effect it wanted has happened.
 *
 * A check-then-insert would race. The uniqueness is in the database and the
 * conflict clause is how this function reads the database's answer.
 */
export const appendLedgerEntry = async (
  scope: ProjectScope,
  entry: {
    readonly kind: LedgerEntry['kind']
    readonly delta: number
    readonly idempotencyKey: string
    readonly jobId?: JobId | null
    readonly externalRef?: string | null
    readonly reason?: string | null
  },
): Promise<void> => {
  await dbOf(scope)
    .insert(creditLedger)
    .values({
      ...tenant(scope),
      kind: entry.kind,
      delta: entry.delta,
      jobId: entry.jobId ?? null,
      externalRef: entry.externalRef ?? null,
      idempotencyKey: entry.idempotencyKey,
      reason: entry.reason ?? null,
      createdBy: scope.actor,
    })
    .onConflictDoNothing({
      target: [creditLedger.projectId, creditLedger.idempotencyKey],
    })
}

/**
 * The balance, computed from the ledger. Never read from a column.
 *
 * `settled` is the sum of every entry **except the provisional pair**,
 * `reserve` and `release`. `reserved` is the sum of reservations that have
 * not been released or spent - which is what "**Reserve then execute**"
 * needs in order to mean anything: a cost check has to compare against what
 * is left after work already promised, not against the raw total.
 *
 * ## Why the provisional pair is out of `settled` - a bug found by the first reservation
 *
 * This function, and the `credit_balances` view it mirrors, first summed
 * *everything* into `settled` and then added the held reservations to get
 * `available`. A held reservation is a negative entry, so it was subtracted
 * twice: a grant of 8 with one 4-credit job queued read as 0 available, not
 * 4. Nothing had written a `reserve` before the Storyboard route, so the
 * arithmetic had never been exercised. The corrected model, and the one the
 * kinds were designed around: a reservation is provisional and is *closed*
 * by a `spend` (the work ran) or a `release` (it did not); the settled sum
 * counts the real charges and credits - grant, purchase, spend, refund,
 * expire, adjust - and `available` is that less what is still held. A
 * failed job that consumed the work is a `spend` closing the reservation
 * plus a `refund` giving it back. The view is corrected in migration `0007`.
 *
 * The held-reservation subquery keys on `job_id`, so a reservation with no job
 * is counted as held forever. That is the safe direction - it under-reports
 * what is available rather than over-reporting it - and a reservation with no
 * job is a bug upstream that this function should not paper over.
 */
export const readBalance = async (scope: ProjectScope): Promise<CreditBalance> => {
  const db = dbOf(scope)

  const totals = await db
    .select({ settled: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(scoped(scope, creditLedger, sql`${creditLedger.kind} NOT IN ('reserve', 'release')`))

  const held = await db
    .select({ reserved: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(
      scoped(
        scope,
        creditLedger,
        eq(creditLedger.kind, 'reserve'),
        sql`NOT EXISTS (
          SELECT 1 FROM ${creditLedger} AS closing
          WHERE closing.project_id = ${creditLedger.projectId}
            AND closing.job_id IS NOT DISTINCT FROM ${creditLedger.jobId}
            AND closing.kind IN ('release', 'spend')
        )`,
      ),
    )

  const settled = totals[0]?.settled ?? 0
  const reserved = held[0]?.reserved ?? 0
  return {
    projectId: scope.projectId,
    settled,
    reserved,
    // `reserved` is already negative, so the reservation is subtracted by
    // adding it. Writing it as a subtraction of an absolute value would be one
    // sign error away from crediting the account for work in flight.
    available: settled + reserved,
    asOf: toTimestamp(new Date()),
  }
}

/** The ledger, newest first. For an audit view, not for arithmetic. */
export const listLedger = async (
  scope: ProjectScope,
  limit = 100,
): Promise<readonly LedgerEntry[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(creditLedger)
    .where(scoped(scope, creditLedger))
    .orderBy(desc(creditLedger.occurredAt))
    .limit(limit)
  return rows.map(toEntry)
}

/** Every entry for one job: its reservation, and whatever settled it. */
export const listJobEntries = async (
  scope: ProjectScope,
  jobId: JobId,
): Promise<readonly LedgerEntry[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(creditLedger)
    .where(scoped(scope, creditLedger, eq(creditLedger.jobId, jobId)))
    .orderBy(desc(creditLedger.occurredAt))
  return rows.map(toEntry)
}

/**
 * Reservations with no job attached.
 *
 * Not a normal query - a diagnostic. Every reservation should carry the job it
 * was taken for, and one that does not is counted as held forever by
 * `readBalance`, which will quietly shrink a project's available credits until
 * somebody looks.
 */
export const listOrphanedReservations = async (
  scope: ProjectScope,
): Promise<readonly LedgerEntry[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(creditLedger)
    .where(scoped(scope, creditLedger, and(eq(creditLedger.kind, 'reserve'), isNull(creditLedger.jobId))))
  return rows.map(toEntry)
}
