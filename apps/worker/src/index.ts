/**
 * worker - a long-running Node process over the Postgres `jobs` table.
 * Never a serverless function (AGENTS.md, Deliberately not using).
 *
 * ADR 0003 **D6** (AGENTS.md ruling R6): the queue is the `jobs` table,
 * claimed with `SELECT … FOR UPDATE SKIP LOCKED` and woken by `LISTEN`/`NOTIFY`
 * over the session pooler. **No Redis and no BullMQ** - a second queue beside
 * the table would make the job row and the queue entry two authorities on one
 * fact. **D5**: long work runs here, in its own container; the web app's hosting
 * does not change.
 *
 *   `main.ts`     the process: queue, handlers, `LISTEN`, health, `SIGTERM`
 *   `runtime.ts`  the loop - claim, heartbeat, stale recovery, cancel, drain
 *   `health.ts`   `GET /health`
 *
 * The handlers - what a frame, a generation or an agent run *does* - are domain
 * code and live in web (`apps/web/lib/worker/`), imported as `web/worker` and
 * bundled into `dist/main.mjs` by `scripts/build.mjs`. How to run and deploy
 * it: `docs/agents/worker.md`.
 */
export { createWorker } from './runtime'
export type { Queue, Worker, WorkerOptions, WorkerStatus } from './runtime'
export { healthResponse, startHealthServer } from './health'
