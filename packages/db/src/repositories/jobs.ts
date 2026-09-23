import type { JobId, JobKind, ProjectId, UserId } from '@folio/contracts'
import { projectId as brandProjectId } from '@folio/contracts'
import { sql } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { listenOnSession } from '../client'
import { jobs } from '../schema'
import { dbOf } from '../scope'
import type { ProjectScope } from '../scope'
import { jsonb } from '../sql-json'

/**
 * The worker's queue - roadmap task 4.1, ADR 0003 **D6**, AGENTS.md ruling R6.
 *
 * The queue **is** the `jobs` table. A worker claims the oldest queued rows with
 * `SELECT … FOR UPDATE SKIP LOCKED` inside one `UPDATE`, so two workers never
 * claim the same row and neither waits on the other's lock; it is woken by
 * `NOTIFY folio_jobs` (the triggers in `0036`) over the session pooler, and a
 * five-second poll covers a notification lost to a reconnect. There is no
 * Redis and no BullMQ: a second queue beside this table would make the job
 * row and the queue entry two authorities on one fact.
 *
 * ## The one repository here that is not project-scoped
 *
 * Claiming is across projects by nature - a worker takes the oldest job,
 * whoever's it is - so the claim, heartbeat, finish and stale sweep take the
 * raw session database, as `tokensTodayFor` takes a raw one for a per-user sum.
 * What they touch is the queue's own columns and nothing else: a job's *work*
 * runs through a `ProjectScope` the handler opens for the job's project
 * (`openProjectForWorker`), and the only tenant row these functions write is
 * the `jobs` row they were handed. `enqueueJob` is scoped, like every create.
 *
 * ## The lease
 *
 * A claim stamps `claimed_at`, and the claimant keeps the exact value as a
 * token (`lease`, full microsecond text - a JavaScript `Date` would drop the
 * microseconds and never match). A heartbeat, a finish, a retry and a release
 * all name it, so a worker whose heartbeat lapsed - its job requeued by the
 * stale sweep and claimed by someone else - finds its later writes match no
 * row. It learns it lost the job from the heartbeat, which returns only the
 * jobs still held.
 */

/** The channel `0036`'s triggers notify on. The payload is the job's kind. */
export const JOBS_CHANNEL = 'folio_jobs'

/** A job a worker holds. */
export type ClaimedJob = {
  readonly id: JobId
  readonly projectId: ProjectId
  readonly kind: JobKind
  readonly payload: unknown
  readonly createdBy: UserId | null
  /** This claim included. */
  readonly attempts: number
  readonly cost: number
  /** This claim's `claimed_at`, as full-precision text - the lease token. */
  readonly lease: string
}

/** How a handler's job ended, as the row records it. */
export type JobOutcome =
  | { readonly status: 'finished' }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'cancelled' }

type ClaimedRow = {
  readonly id: string
  readonly project_id: string
  readonly kind: JobKind
  readonly payload: unknown
  readonly created_by: string | null
  readonly attempts: number
  readonly cost: number
  readonly lease: string
}

const claimedFrom = (row: ClaimedRow): ClaimedJob => ({
  id: row.id as JobId,
  projectId: brandProjectId(row.project_id),
  kind: row.kind,
  payload: row.payload,
  createdBy: row.created_by === null ? null : (row.created_by as UserId),
  attempts: row.attempts,
  cost: row.cost,
  lease: row.lease,
})

/** A lease as the statements below name it. */
export type JobLease = Pick<ClaimedJob, 'id' | 'lease'>

/**
 * What a kind of job does, as the worker calls it. Declared here, beside the
 * queue, so the handlers (`apps/web/lib/worker/`, where the domain code is) and
 * the runtime (`apps/worker`) agree on one shape without either importing the
 * other's internals.
 *
 * `run` gets the claimed job and a signal that is aborted when the writer
 * cancels (`reason: 'cancel'`), when the lease is lost (`'lost'`) or when the
 * worker is shutting down past its grace (`'shutdown'`); it answers how the job
 * ended. A throw is an attempt that failed - requeued, or failed for good at
 * the last attempt. `abandon` settles what a job held when it is failed
 * without its handler finishing (the stale sweep, the last attempt): a
 * reservation, a run.
 */
export type JobHandler = {
  readonly run: (context: { readonly job: ClaimedJob; readonly signal: AbortSignal }) => Promise<JobOutcome>
  readonly abandon?: (job: ClaimedJob, reason: string) => Promise<void>
}

export type JobHandlers = Readonly<Partial<Record<JobKind, JobHandler>>>

/** One structured log line - the worker prints it as JSON, `event` first. */
export type WorkerLog = (entry: Readonly<Record<string, unknown>>) => void

/** Work the worker does on a clock rather than off the queue: the reaper, the sweeper. It reports through the worker's log. */
export type PeriodicTask = {
  readonly name: string
  readonly everyMs: number
  readonly run: (log: WorkerLog) => Promise<void>
}

/**
 * Claim up to `limit` of the oldest queued jobs of these kinds. One statement:
 * the `SKIP LOCKED` select picks the rows, the `UPDATE` takes them - running,
 * one more attempt, a fresh lease and heartbeat - and returns them.
 */
export const claimJobs = async (
  db: FolioDatabase,
  options: { readonly kinds: readonly JobKind[]; readonly limit: number },
): Promise<readonly ClaimedJob[]> => {
  if (options.limit <= 0 || options.kinds.length === 0) return []
  const rows = await db.execute<ClaimedRow>(sql`
    with next as (
      select ${jobs.id} as id from ${jobs}
      where ${jobs.status} = 'queued' and ${jobs.kind}::text = any(${sql.param([...options.kinds])}::text[])
      order by ${jobs.createdAt}
      limit ${options.limit}
      for update skip locked
    )
    update ${jobs} as j
    set status = 'running',
        attempts = j.attempts + 1,
        -- clock_timestamp, not now(): now() is the transaction's start, and a
        -- lease token must differ between two claims however close together.
        claimed_at = clock_timestamp(),
        heartbeat_at = now(),
        started_at = coalesce(j.started_at, now())
    from next
    where j.id = next.id
    returning j.id, j.project_id, j.kind, j.payload, j.created_by, j.attempts, j.cost, j.claimed_at::text as lease
  `)
  return rows.map(claimedFrom)
}

/**
 * One heartbeat for every job a worker holds, in one statement. Returns the
 * jobs **still held** - a lease missing from the answer was lost - each with
 * whether the writer has asked it to stop (`cancel_requested_at`), so
 * cancellation costs no statement of its own.
 */
export const heartbeatJobs = async (
  db: FolioDatabase,
  leases: readonly JobLease[],
): Promise<readonly { readonly id: JobId; readonly cancelRequested: boolean }[]> => {
  if (leases.length === 0) return []
  // The leases go over as `text[]` and are cast per element: postgres.js cannot
  // serialise a `timestamptz[]` parameter (measured 2026-09-23, both poolers).
  const rows = await db.execute<{ readonly id: string; readonly cancel_requested: boolean }>(sql`
    update ${jobs} as j
    set heartbeat_at = now()
    from unnest(${sql.param(leases.map((lease) => lease.id))}::uuid[], ${sql.param(leases.map((lease) => lease.lease))}::text[]) as held(id, lease)
    where j.id = held.id and j.claimed_at = held.lease::timestamptz and j.status = 'running'
    returning j.id, (j.cancel_requested_at is not null) as cancel_requested
  `)
  return rows.map((row) => ({ id: row.id as JobId, cancelRequested: row.cancel_requested }))
}

/** Settle a held job. `false`: the lease was lost and nothing was written. */
export const finishJob = async (db: FolioDatabase, lease: JobLease, outcome: JobOutcome): Promise<boolean> => {
  const error = outcome.status === 'failed' ? outcome.error : null
  const reason = outcome.status === 'blocked' ? outcome.reason : null
  const rows = await db.execute<{ readonly id: string }>(sql`
    update ${jobs}
    set status = ${outcome.status}, finished_at = now(), heartbeat_at = null, error = ${error}, blocked_reason = ${reason}
    where ${jobs.id} = ${lease.id} and ${jobs.claimedAt} = ${lease.lease}::timestamptz and ${jobs.status} = 'running'
    returning ${jobs.id} as id
  `)
  return rows.length > 0
}

/**
 * Put a held job back in the queue. `counted: true` - the handler threw, and
 * the attempt stands; `false` - the worker is shutting down, which is not the
 * job's fault, so the attempt is given back.
 */
export const requeueJob = async (db: FolioDatabase, lease: JobLease, options: { readonly counted: boolean; readonly error?: string }): Promise<boolean> => {
  const rows = await db.execute<{ readonly id: string }>(sql`
    update ${jobs}
    set status = 'queued', claimed_at = null, heartbeat_at = null,
        attempts = case when ${options.counted} then ${jobs.attempts} else greatest(${jobs.attempts} - 1, 0) end,
        error = ${options.error ?? null}
    where ${jobs.id} = ${lease.id} and ${jobs.claimedAt} = ${lease.lease}::timestamptz and ${jobs.status} = 'running'
    returning ${jobs.id} as id
  `)
  return rows.length > 0
}

/** What the stale sweep did. `failed` are the jobs a worker must still settle: their kind's give-up hook. */
export type StaleSweep = { readonly requeued: number; readonly failed: readonly ClaimedJob[] }

/**
 * The stale sweep: every running job whose heartbeat is older than
 * `staleSeconds` goes back to the queue - or, at `maxAttempts`, is failed and
 * handed back so the worker can settle what the job held (a reservation, a
 * run). One statement; `SKIP LOCKED` so two workers sweeping at once split the
 * rows rather than both acting on them.
 */
export const recoverStaleJobs = async (
  db: FolioDatabase,
  options: { readonly staleSeconds: number; readonly maxAttempts: number },
): Promise<StaleSweep> => {
  const message = `Stopped after ${String(options.maxAttempts)} attempts without finishing.`
  const rows = await db.execute<ClaimedRow & { readonly outcome: 'requeued' | 'failed' }>(sql`
    with stale as (
      select ${jobs.id} as id, ${jobs.attempts} as attempts from ${jobs}
      where ${jobs.status} = 'running'
        and ${jobs.heartbeatAt} < now() - make_interval(secs => ${options.staleSeconds})
      for update skip locked
    ),
    requeued as (
      update ${jobs} as j
      set status = 'queued', claimed_at = null, heartbeat_at = null
      from stale
      where j.id = stale.id and stale.attempts < ${options.maxAttempts}
      returning j.id, j.project_id, j.kind, j.payload, j.created_by, j.attempts, j.cost, '' as lease
    ),
    failed as (
      update ${jobs} as j
      set status = 'failed', finished_at = now(), heartbeat_at = null, error = ${message}
      from stale
      where j.id = stale.id and stale.attempts >= ${options.maxAttempts}
      returning j.id, j.project_id, j.kind, j.payload, j.created_by, j.attempts, j.cost, '' as lease
    )
    select *, 'requeued' as outcome from requeued
    union all
    select *, 'failed' as outcome from failed
  `)
  return {
    requeued: rows.filter((row) => row.outcome === 'requeued').length,
    failed: rows.filter((row) => row.outcome === 'failed').map(claimedFrom),
  }
}

/**
 * Queue a job for this project. The trigger in `0036` notifies on commit.
 * `cost` is what the job itself reserved - zero for a kind whose reservation
 * is keyed elsewhere (a Production generation's is on the generation).
 */
export const enqueueJob = async (
  scope: ProjectScope,
  job: { readonly kind: JobKind; readonly payload: unknown; readonly cost?: number },
): Promise<JobId> => {
  const rows = await dbOf(scope).execute<{ readonly id: string }>(sql`
    insert into ${jobs} (project_id, kind, status, cost, payload, created_by)
    values (${scope.projectId as string}, ${job.kind}, 'queued', ${job.cost ?? 0}, ${jsonb(job.payload)}, ${scope.actor as string | null}::uuid)
    returning ${jobs.id} as id
  `)
  const row = rows[0]
  if (row === undefined) throw new Error('Folio: queueing a job returned no row.')
  return row.id as JobId
}

/** A job still queued, as the one-off stale-job sweep lists it (`apps/worker/scripts/cancel-stale-jobs.ts`). */
export type QueuedJob = {
  readonly id: JobId
  readonly projectId: ProjectId
  readonly kind: JobKind
  readonly cost: number
  readonly createdBy: UserId | null
  /** Full-precision text, as Postgres prints it. */
  readonly createdAt: string
}

/**
 * Every job still `queued` that was queued before `before`, oldest first, across
 * projects - read-only. For the pre-deploy sweep: jobs queued while no worker
 * ran would otherwise all start (and spend) the moment one does. What to do
 * with each is the caller's: cancelling one goes through its project's scope.
 */
export const listQueuedJobsBefore = async (db: FolioDatabase, before: Date): Promise<readonly QueuedJob[]> => {
  const rows = await db.execute<{
    readonly id: string
    readonly project_id: string
    readonly kind: JobKind
    readonly cost: number
    readonly created_by: string | null
    readonly created_at: string
  }>(sql`
    select ${jobs.id} as id, ${jobs.projectId} as project_id, ${jobs.kind} as kind, ${jobs.cost} as cost,
           ${jobs.createdBy} as created_by, ${jobs.createdAt}::text as created_at
    from ${jobs}
    where ${jobs.status} = 'queued' and ${jobs.createdAt} < ${before.toISOString()}::timestamptz
    order by ${jobs.createdAt}
  `)
  return rows.map((row) => ({
    id: row.id as JobId,
    projectId: brandProjectId(row.project_id),
    kind: row.kind,
    cost: row.cost,
    createdBy: row.created_by === null ? null : (row.created_by as UserId),
    createdAt: row.created_at,
  }))
}

/** One round trip that proves the database answers - the health endpoint's check. */
export const pingDatabase = async (db: FolioDatabase): Promise<void> => {
  await db.execute(sql`select 1`)
}

/**
 * Wake on `NOTIFY folio_jobs`. postgres.js holds a dedicated session
 * connection for it, reconnects on its own and calls `onListen` each time it
 * is listening again - which is when a worker should poll once, for whatever
 * was queued while it was deaf.
 */
export const listenForJobs = (onKind: (kind: string) => void, onListen: () => void): Promise<{ readonly unlisten: () => Promise<void> }> =>
  listenOnSession(JOBS_CHANNEL, onKind, onListen)
