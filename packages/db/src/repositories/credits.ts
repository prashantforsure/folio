import type { CreditBalance, GenerationState, JobId, JobStatus, LedgerEntry, LedgerEntryId, ProjectId, UserId } from '@folio/contracts'
import { projectId as brandProjectId, toTimestamp } from '@folio/contracts'
import { desc, eq, sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { creditLedger, generations, jobs } from '../schema'
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
 * A reservation still held that nothing live will ever close, and what it was
 * taken for (`listOrphanedReservations`).
 *
 *   `none`        no job id, or one that names neither a generation nor a job
 *   `generation`  a Production generation that is over, or that still says
 *                 `queued`/`running` with no live job to run it - interrupted
 *   `job`         a Storyboard frame job that is over
 */
export type OrphanedReservation = {
  readonly entry: LedgerEntry
  readonly owner:
    | { readonly kind: 'none' }
    | { readonly kind: 'generation'; readonly id: string; readonly state: GenerationState }
    | { readonly kind: 'job'; readonly id: JobId; readonly status: JobStatus }
}

/**
 * How long a live generation may go without a live job before the reaper calls
 * it interrupted. Longer than the video model's own ten-minute deadline, so a
 * generation a web process started before the worker existed - no job row, an
 * `after()` still running - is not reaped mid-render.
 */
export const INTERRUPTED_AFTER_MINUTES = 15

/**
 * Reservations still held that nothing will close - widened for the worker's
 * reaper (roadmap task 4.3; ruled 2026-09-23). It began as "reservations with
 * no job attached", which nothing writes, so a reaper built on it found
 * nothing: a reservation outlives what it was for when the process running a
 * generation dies, and that is what is reported now.
 *
 * Held means no `release` and no `spend` names the same `job_id` - the rule
 * `readBalance` counts by. One statement: the held reserves, each joined to the
 * generation and the job its `job_id` could name.
 */
export const listOrphanedReservations = async (scope: ProjectScope): Promise<readonly OrphanedReservation[]> => {
  const rows = await dbOf(scope).execute<
    typeof creditLedger.$inferSelect & {
      readonly generation_id: string | null
      readonly generation_state: GenerationState | null
      readonly found_job_id: string | null
      readonly found_job_status: JobStatus | null
    }
  >(sql`
    with held as (
      select l.* from ${creditLedger} as l
      where l.project_id = ${scope.projectId as string} and l.kind = 'reserve'
        and not exists (
          select 1 from ${creditLedger} as c
          where c.project_id = l.project_id and c.job_id is not distinct from l.job_id and c.kind in ('release', 'spend')
        )
    )
    select held.id, held.project_id as "projectId", held.kind, held.delta, held.job_id as "jobId", held.external_ref as "externalRef",
           held.idempotency_key as "idempotencyKey", held.reason, held.created_by as "createdBy", held.occurred_at as "occurredAt",
           g.id as generation_id, g.state as generation_state, j.id as found_job_id, j.status as found_job_status
    from held
    left join ${generations} as g on g.id = held.job_id and g.project_id = held.project_id
    left join ${jobs} as j on j.id = held.job_id and j.project_id = held.project_id
    where held.job_id is null
       or (g.id is null and j.id is null)
       or (g.id is not null and g.state not in ('queued', 'running'))
       or (g.id is not null
           and held.occurred_at < now() - make_interval(mins => ${INTERRUPTED_AFTER_MINUTES})
           and not exists (
             select 1 from ${jobs} as live
             where live.project_id = held.project_id and live.kind = 'production_generation'
               and live.payload ->> 'generationId' = g.id::text and live.status in ('queued', 'running')
           ))
       or (j.id is not null and j.status not in ('queued', 'running'))
  `)
  return rows.map((row) => ({
    entry: toEntry({ ...row, occurredAt: new Date(row.occurredAt) }),
    owner:
      row.generation_id !== null && row.generation_state !== null
        ? { kind: 'generation', id: row.generation_id, state: row.generation_state }
        : row.found_job_id !== null && row.found_job_status !== null
          ? { kind: 'job', id: row.found_job_id as JobId, status: row.found_job_status }
          : { kind: 'none' },
  }))
}

/**
 * Every project holding a reservation nothing has closed - the reaper's walk
 * (roadmap task 4.3). Across projects by nature, so it takes the raw database
 * as `tokensTodayFor` does; the reaper then opens each project's own scope.
 */
export const listProjectsHoldingReservations = async (db: FolioDatabase): Promise<readonly ProjectId[]> => {
  const rows = await db.execute<{ readonly project_id: string }>(sql`
    select distinct l.project_id from ${creditLedger} as l
    where l.kind = 'reserve'
      and not exists (
        select 1 from ${creditLedger} as c
        where c.project_id = l.project_id and c.job_id is not distinct from l.job_id and c.kind in ('release', 'spend')
      )
  `)
  return rows.map((row) => brandProjectId(row.project_id))
}
