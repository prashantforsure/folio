import type { JobKind } from '@folio/contracts'
import type { ClaimedJob, JobHandlers, JobLease, JobOutcome, PeriodicTask, StaleSweep } from '@folio/db'

/**
 * The worker's loop - roadmap task 4.1, ADR 0003 **D5** and **D6**.
 *
 * One process, `concurrency` jobs at a time, claimed from the `jobs` table.
 * Everything that touches the database arrives as the `queue` argument, so this
 * file is the policy and nothing else, and `runtime.test.ts` drives it with an
 * array.
 *
 *   **Claim.** A pass claims as many jobs as there are free slots, of the kinds
 *   there is a handler for. A pass runs when woken - a `NOTIFY` (`main.ts`),
 *   the five-second poll, a job finishing - and never two at once; a wake that
 *   arrives mid-pass runs one more pass after it.
 *
 *   **Heartbeat.** Every 15 seconds, one statement for every held job. What
 *   comes back is the jobs still held, each with whether the writer asked it to
 *   stop: a cancel aborts the job's signal with `'cancel'`, a job missing from
 *   the answer lost its lease and is aborted with `'lost'` - and is never
 *   settled by this worker, because another one holds it now.
 *
 *   **Stale sweep.** Every 30 seconds: a job silent for two minutes goes back
 *   to the queue, and at its third attempt it is failed and its kind's
 *   `abandon` settles what it held. Any worker's sweep covers every worker, so
 *   a crashed process's jobs come back without it.
 *
 *   **A throw** is an attempt that failed: requeued, or at the last attempt
 *   failed and abandoned. A handler that *answers* - finished, failed, blocked,
 *   cancelled - is taken at its word.
 *
 *   **Shutdown** (`stop`, on `SIGTERM`): claim nothing more, let running jobs
 *   finish for `drainMs`, then abort them with `'shutdown'` and put each back in
 *   the queue with its attempt given back - a deploy is not the job's fault.
 */

export type Log = (entry: Readonly<Record<string, unknown>>) => void

/** The queue as the loop uses it - `@folio/db`'s functions, bound to the session database in `main.ts`. */
export type Queue = {
  readonly claim: (kinds: readonly JobKind[], limit: number) => Promise<readonly ClaimedJob[]>
  readonly heartbeat: (leases: readonly JobLease[]) => Promise<readonly { readonly id: string; readonly cancelRequested: boolean }[]>
  readonly finish: (lease: JobLease, outcome: JobOutcome) => Promise<boolean>
  readonly requeue: (lease: JobLease, options: { readonly counted: boolean; readonly error?: string }) => Promise<boolean>
  readonly recoverStale: (options: { readonly staleSeconds: number; readonly maxAttempts: number }) => Promise<StaleSweep>
}

export type WorkerOptions = {
  readonly queue: Queue
  readonly handlers: JobHandlers
  readonly periodic?: readonly PeriodicTask[]
  readonly concurrency: number
  readonly log?: Log
  /** The fallback poll, for a notification lost to a reconnect. */
  readonly pollMs?: number
  readonly heartbeatMs?: number
  readonly sweepMs?: number
  /** A running job silent this long is stale. */
  readonly staleSeconds?: number
  readonly maxAttempts?: number
  /** How long `stop` lets running jobs finish before aborting them. */
  readonly drainMs?: number
}

export const POLL_MS = 5_000
export const HEARTBEAT_MS = 15_000
export const SWEEP_MS = 30_000
export const STALE_SECONDS = 120
export const MAX_ATTEMPTS = 3
export const DRAIN_MS = 25_000
/** After the abort, how long a handler has to notice before its job is put back from outside. */
const ABORT_GRACE_MS = 5_000

export type AbortReason = 'cancel' | 'lost' | 'shutdown'

export type WorkerStatus = {
  readonly state: 'idle' | 'running' | 'draining' | 'stopped'
  readonly running: number
  /** Whether the last claim pass reached the database. The health endpoint's answer. */
  readonly databaseOk: boolean
  readonly lastPassAt: number | null
}

export type Worker = {
  readonly start: () => void
  /** Look for work now. Safe to call at any rate. */
  readonly wake: () => void
  readonly stop: () => Promise<void>
  readonly status: () => WorkerStatus
}

type Held = {
  readonly job: ClaimedJob
  readonly controller: AbortController
  reason: AbortReason | null
  /** Put back from outside after a shutdown abort the handler ignored - its own finish must not land. */
  released: boolean
  done: Promise<void>
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const quiet: Log = () => undefined

export const createWorker = (options: WorkerOptions): Worker => {
  const { queue, handlers } = options
  const log = options.log ?? quiet
  const concurrency = Math.max(1, options.concurrency)
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const kinds = (Object.keys(handlers) as JobKind[]).filter((kind) => handlers[kind] !== undefined)

  const held = new Map<string, Held>()
  const timers: ReturnType<typeof setInterval>[] = []
  let state: WorkerStatus['state'] = 'idle'
  let databaseOk = true
  let lastPassAt: number | null = null
  let passing = false
  let again = false

  const abandon = async (job: ClaimedJob, reason: string): Promise<void> => {
    const handler = handlers[job.kind]
    if (handler?.abandon === undefined) return
    try {
      await handler.abandon(job, reason)
    } catch (cause) {
      log({ event: 'folio.worker.abandon_failed', jobId: job.id, kind: job.kind, message: messageOf(cause) })
    }
  }

  /** Settle a job its handler finished or threw on - unless the lease is gone or it was put back from outside. */
  const settle = async (entry: Held, outcome: JobOutcome | { readonly threw: string }): Promise<void> => {
    const { job } = entry
    if (entry.released || entry.reason === 'lost') return
    if (entry.reason === 'shutdown') {
      await queue.requeue(job, { counted: false })
      log({ event: 'folio.worker.released', jobId: job.id, kind: job.kind })
      return
    }
    if ('threw' in outcome) {
      if (job.attempts >= maxAttempts) {
        const error = `Stopped after ${String(maxAttempts)} attempts: ${outcome.threw}`
        if (await queue.finish(job, { status: 'failed', error })) await abandon(job, error)
        log({ event: 'folio.worker.gave_up', jobId: job.id, kind: job.kind, attempts: job.attempts, message: outcome.threw })
        return
      }
      await queue.requeue(job, { counted: true, error: outcome.threw })
      log({ event: 'folio.worker.retry', jobId: job.id, kind: job.kind, attempts: job.attempts, message: outcome.threw })
      return
    }
    await queue.finish(job, outcome)
    log({ event: 'folio.worker.finished', jobId: job.id, kind: job.kind, status: outcome.status })
  }

  const begin = (job: ClaimedJob): void => {
    const handler = handlers[job.kind]
    const controller = new AbortController()
    const entry: Held = { job, controller, reason: null, released: false, done: Promise.resolve() }
    held.set(job.id, entry)
    log({ event: 'folio.worker.claimed', jobId: job.id, kind: job.kind, attempt: job.attempts })
    entry.done = (async () => {
      let outcome: JobOutcome | { readonly threw: string }
      try {
        outcome = handler === undefined ? { status: 'failed', error: `No handler for ${job.kind}.` } : await handler.run({ job, signal: controller.signal })
      } catch (cause) {
        outcome = { threw: messageOf(cause) }
      }
      try {
        await settle(entry, outcome)
      } catch (cause) {
        // The row is left running; its heartbeat stops with this entry, so the sweep requeues it.
        log({ event: 'folio.worker.settle_failed', jobId: job.id, kind: job.kind, message: messageOf(cause) })
      }
    })().finally(() => {
      held.delete(job.id)
      wake()
    })
  }

  const pass = async (): Promise<void> => {
    const free = concurrency - held.size
    if (state !== 'running' || free <= 0 || kinds.length === 0) return
    try {
      const claimed = await queue.claim(kinds, free)
      databaseOk = true
      lastPassAt = Date.now()
      for (const job of claimed) begin(job)
    } catch (cause) {
      databaseOk = false
      log({ event: 'folio.worker.claim_failed', message: messageOf(cause) })
    }
  }

  const wake = (): void => {
    if (state !== 'running') return
    if (passing) {
      again = true
      return
    }
    passing = true
    void (async () => {
      try {
        do {
          again = false
          await pass()
        } while (again && state === 'running')
      } finally {
        passing = false
      }
    })()
  }

  const abort = (entry: Held, reason: AbortReason): void => {
    if (entry.reason !== null) return
    entry.reason = reason
    entry.controller.abort(reason)
  }

  const beat = async (): Promise<void> => {
    const entries = [...held.values()].filter((entry) => entry.reason !== 'lost' && !entry.released)
    if (entries.length === 0) return
    try {
      const alive = await queue.heartbeat(entries.map((entry) => entry.job))
      databaseOk = true
      const byId = new Map(alive.map((row) => [row.id, row]))
      for (const entry of entries) {
        const row = byId.get(entry.job.id)
        if (row === undefined) {
          abort(entry, 'lost')
          log({ event: 'folio.worker.lease_lost', jobId: entry.job.id, kind: entry.job.kind })
        } else if (row.cancelRequested) {
          abort(entry, 'cancel')
          log({ event: 'folio.worker.cancel_requested', jobId: entry.job.id, kind: entry.job.kind })
        }
      }
    } catch (cause) {
      databaseOk = false
      log({ event: 'folio.worker.heartbeat_failed', message: messageOf(cause) })
    }
  }

  const sweep = async (): Promise<void> => {
    try {
      const result = await queue.recoverStale({ staleSeconds: options.staleSeconds ?? STALE_SECONDS, maxAttempts })
      if (result.requeued > 0) {
        log({ event: 'folio.worker.stale_requeued', count: result.requeued })
        wake()
      }
      for (const job of result.failed) {
        log({ event: 'folio.worker.stale_failed', jobId: job.id, kind: job.kind, attempts: job.attempts })
        await abandon(job, `Stopped after ${String(maxAttempts)} attempts without finishing.`)
      }
    } catch (cause) {
      log({ event: 'folio.worker.sweep_failed', message: messageOf(cause) })
    }
  }

  /** A periodic task never overlaps itself; a slow run skips the tick that would have doubled it. */
  const every = (task: PeriodicTask): void => {
    let busy = false
    timers.push(
      setInterval(() => {
        if (busy || state !== 'running') return
        busy = true
        void task
          .run()
          .catch((cause: unknown) => log({ event: 'folio.worker.task_failed', task: task.name, message: messageOf(cause) }))
          .finally(() => {
            busy = false
          })
      }, task.everyMs),
    )
  }

  const start = (): void => {
    if (state !== 'idle') return
    state = 'running'
    timers.push(setInterval(wake, options.pollMs ?? POLL_MS))
    timers.push(setInterval(() => void beat(), options.heartbeatMs ?? HEARTBEAT_MS))
    timers.push(setInterval(() => void sweep(), options.sweepMs ?? SWEEP_MS))
    for (const task of options.periodic ?? []) every(task)
    log({ event: 'folio.worker.started', concurrency, kinds })
    wake()
  }

  const settled = (entries: readonly Held[], ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (entries.length === 0) {
        resolve(true)
        return
      }
      const timer = setTimeout(() => resolve(false), ms)
      void Promise.all(entries.map((entry) => entry.done)).then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })

  const stop = async (): Promise<void> => {
    if (state === 'stopped' || state === 'draining') return
    state = 'draining'
    for (const timer of timers.splice(0)) clearInterval(timer)
    log({ event: 'folio.worker.draining', running: held.size })

    // Keep the leases alive while the running jobs finish - the sweep of another
    // worker must not take a job this one is still honestly working on.
    const keepAlive = setInterval(() => void beat(), options.heartbeatMs ?? HEARTBEAT_MS)
    try {
      if (await settled([...held.values()], options.drainMs ?? DRAIN_MS)) return
      const late = [...held.values()]
      for (const entry of late) abort(entry, 'shutdown')
      if (await settled(late, ABORT_GRACE_MS)) return
      // A handler that ignored its signal: put its job back from here, and make sure its own settle cannot land.
      for (const entry of held.values()) {
        entry.released = true
        await queue.requeue(entry.job, { counted: false }).catch(() => false)
        log({ event: 'folio.worker.released', jobId: entry.job.id, kind: entry.job.kind, forced: true })
      }
    } finally {
      clearInterval(keepAlive)
      state = 'stopped'
      log({ event: 'folio.worker.stopped' })
    }
  }

  const status = (): WorkerStatus => ({ state, running: held.size, databaseOk, lastPassAt })

  return { start, wake, stop, status }
}
