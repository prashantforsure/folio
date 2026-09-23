import type { JobId, JobKind } from '@folio/contracts'
import { projectId } from '@folio/contracts'
import type { ClaimedJob, JobHandler, JobLease, JobOutcome } from '@folio/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { healthResponse } from './health'
import type { Queue } from './runtime'
import { createWorker } from './runtime'

/**
 * The worker's loop - roadmap task 4.1. The queue is an array; the policy is
 * the real one. Each case is one sentence of the task: claim with a
 * concurrency, a throw retried then given up, a cancel through
 * `cancel_requested_at`, a lost lease, the stale sweep, and a `SIGTERM` that
 * drains and hands the rest back.
 */

type Row = {
  id: string
  kind: JobKind
  status: 'queued' | 'running' | 'finished' | 'failed' | 'blocked' | 'cancelled'
  attempts: number
  lease: string | null
  cancel: boolean
  error: string | null
}

const PROJECT = projectId('00000000-0000-4000-8000-000000000001')

const fakeQueue = (rows: Row[]) => {
  let clock = 0
  const claimedOf = (row: Row): ClaimedJob => ({
    id: row.id as JobId,
    projectId: PROJECT,
    kind: row.kind,
    payload: {},
    createdBy: null,
    attempts: row.attempts,
    cost: 0,
    lease: row.lease ?? '',
  })
  const heldBy = (lease: JobLease): Row | undefined => rows.find((row) => row.id === lease.id && row.lease === lease.lease && row.status === 'running')
  const calls = { requeued: [] as { id: string; counted: boolean }[], finished: [] as { id: string; outcome: JobOutcome }[] }
  const queue: Queue = {
    claim: async (kinds, limit) => {
      const next = rows.filter((row) => row.status === 'queued' && kinds.includes(row.kind)).slice(0, limit)
      for (const row of next) {
        row.status = 'running'
        row.attempts += 1
        clock += 1
        row.lease = `lease-${String(clock)}`
      }
      return next.map(claimedOf)
    },
    heartbeat: async (leases) => leases.flatMap((lease) => {
      const row = heldBy(lease)
      return row === undefined ? [] : [{ id: row.id, cancelRequested: row.cancel }]
    }),
    finish: async (lease, outcome) => {
      const row = heldBy(lease)
      if (row === undefined) return false
      row.status = outcome.status
      row.error = outcome.status === 'failed' ? outcome.error : null
      calls.finished.push({ id: row.id, outcome })
      return true
    },
    requeue: async (lease, options) => {
      const row = heldBy(lease)
      if (row === undefined) return false
      row.status = 'queued'
      row.lease = null
      if (!options.counted) row.attempts = Math.max(0, row.attempts - 1)
      calls.requeued.push({ id: row.id, counted: options.counted })
      return true
    },
    recoverStale: async () => ({ requeued: 0, failed: [] }),
  }
  return { queue, calls }
}

const row = (id: string, kind: JobKind = 'frame_generation', attempts = 0): Row => ({ id, kind, status: 'queued', attempts, lease: null, cancel: false, error: null })

/** Let the loop's promise chains run. */
const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

/** A handler whose jobs finish when the test says so. */
const gated = () => {
  const open = new Map<string, (outcome: JobOutcome) => void>()
  const signals = new Map<string, AbortSignal>()
  const handler: JobHandler = {
    run: ({ job, signal }) =>
      new Promise<JobOutcome>((resolve) => {
        open.set(job.id, resolve)
        signals.set(job.id, signal)
      }),
  }
  const finish = (id: string, outcome: JobOutcome = { status: 'finished' }): void => {
    open.get(id)?.(outcome)
    open.delete(id)
  }
  return { handler, open, signals, finish }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('claiming', () => {
  it('claims no more than its concurrency, and claims again as a slot frees', async () => {
    const rows = [row('a'), row('b'), row('c')]
    const { queue } = fakeQueue(rows)
    const jobs = gated()
    const worker = createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 2 })
    worker.start()
    await flush()
    expect(rows.map((entry) => entry.status)).toEqual(['running', 'running', 'queued'])
    expect(worker.status().running).toBe(2)

    jobs.finish('a')
    await flush()
    expect(rows.map((entry) => entry.status)).toEqual(['finished', 'running', 'running'])
  })

  it('claims only the kinds it has a handler for', async () => {
    const rows = [row('a', 'agent_run'), row('b', 'frame_generation')]
    const { queue } = fakeQueue(rows)
    const jobs = gated()
    createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 4 }).start()
    await flush()
    expect(rows.map((entry) => entry.status)).toEqual(['queued', 'running'])
  })

  it('finds a job queued later on the five-second poll', async () => {
    const rows: Row[] = []
    const { queue } = fakeQueue(rows)
    const jobs = gated()
    createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1 }).start()
    await flush()
    rows.push(row('late'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(rows[0]?.status).toBe('running')
  })

  it('records what the handler answered', async () => {
    const rows = [row('a')]
    const { queue, calls } = fakeQueue(rows)
    const handler: JobHandler = { run: async () => ({ status: 'blocked', reason: 'The model refused the shot.' }) }
    createWorker({ queue, handlers: { frame_generation: handler }, concurrency: 1 }).start()
    await flush()
    expect(calls.finished).toEqual([{ id: 'a', outcome: { status: 'blocked', reason: 'The model refused the shot.' } }])
  })
})

describe('a throw', () => {
  it('is an attempt: requeued with the attempt counted', async () => {
    const rows = [row('a')]
    const { queue, calls } = fakeQueue(rows)
    const handler: JobHandler = { run: async () => Promise.reject(new Error('The provider timed out.')) }
    createWorker({ queue, handlers: { frame_generation: handler }, concurrency: 1 }).start()
    await flush()
    expect(calls.requeued[0]).toEqual({ id: 'a', counted: true })
  })

  it('at the third attempt fails the job and abandons it', async () => {
    const rows = [row('a', 'frame_generation', 2)]
    const { queue, calls } = fakeQueue(rows)
    const abandon = vi.fn(async () => undefined)
    const handler: JobHandler = { run: async () => Promise.reject(new Error('Still broken.')), abandon }
    createWorker({ queue, handlers: { frame_generation: handler }, concurrency: 1 }).start()
    await flush()
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.error).toBe('Stopped after 3 attempts: Still broken.')
    expect(calls.requeued).toEqual([])
    expect(abandon).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'Stopped after 3 attempts: Still broken.')
  })
})

describe('the heartbeat', () => {
  it('aborts a job the writer cancelled, and records the cancel the handler answers', async () => {
    const rows = [row('a')]
    const { queue } = fakeQueue(rows)
    const jobs = gated()
    createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1 }).start()
    await flush()
    const first = rows[0]
    if (first === undefined) throw new Error('no row')
    first.cancel = true
    await vi.advanceTimersByTimeAsync(15_000)
    const signal = jobs.signals.get('a')
    expect(signal?.aborted).toBe(true)
    expect(signal?.reason).toBe('cancel')
    jobs.finish('a', { status: 'cancelled' })
    await flush()
    expect(first.status).toBe('cancelled')
  })

  it('aborts a job whose lease was taken over, and never settles it', async () => {
    const rows = [row('a')]
    const { queue, calls } = fakeQueue(rows)
    const jobs = gated()
    createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1 }).start()
    await flush()
    const first = rows[0]
    if (first === undefined) throw new Error('no row')
    // The stale sweep of another worker requeued it and a third claimed it.
    first.lease = 'someone-else'
    await vi.advanceTimersByTimeAsync(15_000)
    expect(jobs.signals.get('a')?.reason).toBe('lost')
    jobs.finish('a')
    await flush()
    expect(calls.finished).toEqual([])
    expect(first.status).toBe('running')
  })
})

describe('the stale sweep', () => {
  it('abandons every job it failed', async () => {
    const { queue } = fakeQueue([])
    const abandoned: string[] = []
    const failedJob: ClaimedJob = { id: 'x' as JobId, projectId: PROJECT, kind: 'agent_run', payload: {}, createdBy: null, attempts: 3, cost: 0, lease: '' }
    const sweeping: Queue = { ...queue, recoverStale: async () => ({ requeued: 0, failed: [failedJob] }) }
    const handler: JobHandler = {
      run: async () => ({ status: 'finished' }),
      abandon: async (job, reason) => {
        abandoned.push(`${job.id}: ${reason}`)
      },
    }
    createWorker({ queue: sweeping, handlers: { agent_run: handler }, concurrency: 1 }).start()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(abandoned).toEqual(['x: Stopped after 3 attempts without finishing.'])
  })
})

describe('shutdown', () => {
  it('claims nothing more, lets running jobs finish, and stops', async () => {
    const rows = [row('a'), row('b')]
    const { queue } = fakeQueue(rows)
    const jobs = gated()
    const worker = createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1 })
    worker.start()
    await flush()
    const stopping = worker.stop()
    expect(worker.status().state).toBe('draining')
    jobs.finish('a')
    await stopping
    expect(worker.status().state).toBe('stopped')
    expect(rows.map((entry) => entry.status)).toEqual(['finished', 'queued'])
  })

  it('past the grace, aborts the rest and hands them back with the attempt given back', async () => {
    const rows = [row('a')]
    const { queue, calls } = fakeQueue(rows)
    const jobs = gated()
    const worker = createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1, drainMs: 1_000 })
    worker.start()
    await flush()
    const stopping = worker.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(jobs.signals.get('a')?.reason).toBe('shutdown')
    jobs.finish('a', { status: 'failed', error: 'aborted' })
    await vi.advanceTimersByTimeAsync(0)
    await stopping
    expect(calls.requeued).toEqual([{ id: 'a', counted: false }])
    expect(rows[0]).toMatchObject({ status: 'queued', attempts: 0 })
  })

  it('puts back a job whose handler ignored the abort, and its late answer does not land', async () => {
    const rows = [row('a')]
    const { queue, calls } = fakeQueue(rows)
    const jobs = gated()
    const worker = createWorker({ queue, handlers: { frame_generation: jobs.handler }, concurrency: 1, drainMs: 1_000 })
    worker.start()
    await flush()
    const stopping = worker.stop()
    await vi.advanceTimersByTimeAsync(1_000 + 5_000)
    await stopping
    expect(calls.requeued).toEqual([{ id: 'a', counted: false }])
    jobs.finish('a')
    await flush()
    expect(calls.finished).toEqual([])
  })
})

describe('health', () => {
  it('is 200 only while running with the database answering', () => {
    expect(healthResponse({ state: 'running', running: 1, databaseOk: true, lastPassAt: 1 }).code).toBe(200)
    expect(healthResponse({ state: 'running', running: 0, databaseOk: false, lastPassAt: 1 }).code).toBe(503)
    expect(healthResponse({ state: 'draining', running: 1, databaseOk: true, lastPassAt: 1 }).code).toBe(503)
    expect(healthResponse({ state: 'idle', running: 0, databaseOk: true, lastPassAt: null }).code).toBe(503)
  })

  it('reports a failed claim as the database not answering', async () => {
    const { queue } = fakeQueue([])
    const failing: Queue = { ...queue, claim: async () => Promise.reject(new Error('connection refused')) }
    const jobs = gated()
    const worker = createWorker({ queue: failing, handlers: { frame_generation: jobs.handler }, concurrency: 1 })
    worker.start()
    await flush()
    expect(worker.status().databaseOk).toBe(false)
  })
})
