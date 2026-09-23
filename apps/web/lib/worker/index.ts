import type { JobHandlers, PeriodicTask } from '@folio/db'

import { agentRunHandler } from './agent-run'
import { frameGenerationHandler } from './frame-generation'
import { productionGenerationHandler } from './production-generation'
import { reaper } from './reaper'
import { sweeper } from './sweeper'

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
 * 4.3 added `production_generation`, `frame_generation`, the reaper and the
 * sweeper; 4.4 `agent_run`, a background agent run (`lib/agent/background.ts`).
 * The worker claims only the kinds this map holds, so a queued job of a kind
 * with no handler stays queued rather than failing.
 */
export const workerHandlers: JobHandlers = {
  production_generation: productionGenerationHandler,
  frame_generation: frameGenerationHandler,
  agent_run: agentRunHandler,
}

export const periodicTasks: readonly PeriodicTask[] = [reaper, sweeper]
