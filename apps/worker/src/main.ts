import {
  claimJobs,
  closeDatabases,
  finishJob,
  heartbeatJobs,
  listenForJobs,
  pingDatabase,
  recoverStaleJobs,
  requeueJob,
  sessionDatabase,
} from '@folio/db'
import { workerEnv } from '@folio/db/env'
import { periodicTasks, workerHandlers } from 'web/worker'

import { startHealthServer } from './health'
import type { Log, Queue } from './runtime'
import { createWorker } from './runtime'

/**
 * The worker process - `node dist/main.mjs`. Roadmap task 4.1.
 *
 * Wires the loop (`runtime.ts`) to the queue in `@folio/db` over the **session
 * pooler**, the handlers web defines (`apps/web/lib/worker/`, imported as
 * `web/worker`), `LISTEN folio_jobs` and the health endpoint, then waits for
 * `SIGTERM`. `docs/agents/worker.md` is how to run and deploy it.
 *
 * Logs are one JSON object per line on stdout, `event` first - `console`, not
 * pino, because pino is not installed (AGENTS.md, Tech stack: planned).
 */

const log: Log = (entry) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }))
}

const main = async (): Promise<void> => {
  const db = await sessionDatabase()
  await pingDatabase(db)

  const queue: Queue = {
    claim: (kinds, limit) => claimJobs(db, { kinds, limit }),
    heartbeat: (leases) => heartbeatJobs(db, leases),
    finish: (lease, outcome) => finishJob(db, lease, outcome),
    requeue: (lease, options) => requeueJob(db, lease, options),
    recoverStale: (options) => recoverStaleJobs(db, options),
  }
  const worker = createWorker({
    queue,
    handlers: workerHandlers,
    periodic: periodicTasks,
    concurrency: workerEnv.WORKER_CONCURRENCY,
    log,
  })

  // A lost LISTEN is not fatal: the five-second poll still finds every job, only later.
  const listener = await listenForJobs(
    () => worker.wake(),
    () => {
      log({ event: 'folio.worker.listening' })
      worker.wake()
    },
  ).catch((cause: unknown) => {
    log({ event: 'folio.worker.listen_failed', message: cause instanceof Error ? cause.message : String(cause) })
    return null
  })

  const health = await startHealthServer(workerEnv.WORKER_HEALTH_PORT, () => worker.status())
  worker.start()

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    log({ event: 'folio.worker.signal', signal })
    await worker.stop()
    await listener?.unlisten().catch(() => undefined)
    await new Promise<void>((resolve) => health.close(() => resolve()))
    await closeDatabases()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((cause: unknown) => {
  log({ event: 'folio.worker.boot_failed', message: cause instanceof Error ? cause.message : String(cause) })
  process.exit(1)
})
