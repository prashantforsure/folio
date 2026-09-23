import type { JobHandlers, PeriodicTask } from '@folio/db'

/**
 * What the worker runs - imported by `apps/worker` as `web/worker` and bundled
 * into its one file (roadmap task 4.1, ADR 0003 D5).
 *
 * The handlers live here rather than in `apps/worker` because what they do is
 * web's domain: a Production generation is `lib/production/pipeline/`, an agent
 * run is `lib/agent/`. The worker owns the loop - claim, heartbeat, recovery,
 * shutdown - and nothing about what a job means.
 *
 * **Nothing reachable from this file may touch a Next request API** - no
 * `cookies()`, no `revalidatePath()`, no `after()`, and no `'use server'`
 * module, whose exports are public endpoints. A handler acts as the job's
 * starter through the actor gates (`lib/script/actor-gate.ts`), never through a
 * cookie. `tests/worker-import-graph.test.ts` walks the imports and holds it.
 *
 * Empty until the kinds are built: 4.3 adds `production_generation`,
 * `frame_generation`, the reaper and the sweeper; 4.4 adds `agent_run`. The
 * worker claims only the kinds this map holds, so a queued job of a kind with
 * no handler yet stays queued rather than failing.
 */
export const workerHandlers: JobHandlers = {}

export const periodicTasks: readonly PeriodicTask[] = []
