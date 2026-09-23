import type { ReelId } from '@folio/contracts'
import { ProductionGenerationIdSchema } from '@folio/contracts'
import type { ClaimedJob, GenerationRun, JobHandler, JobOutcome, ProjectScope } from '@folio/db'
import { failGeneration, openProjectForWorker, readGenerationForRun } from '@folio/db'
import { z } from 'zod'

import { readReelView } from '../production/core'
import { runGeneration } from '../production/pipeline/runner'
import { specFromRun } from '../production/pipeline/spec'
import { readCastAndPlaces } from '../production/compose'

/**
 * A Production generation, on the worker - roadmap task 4.3 (ADR 0003 D5).
 *
 * `createGeneration` queued this job in the statement that reserved the
 * credits; the payload names the generation and nothing else, because the row
 * is the authority. The handler reads the row, rebuilds the spec it was quoted
 * for (`specFromRun` - the stored prompt, references, settings and route, not
 * a spec re-assembled from records that may have moved since), re-reads the
 * reel a sheet or a shotlist is drawn from and the cast names a shotlist is
 * parsed with, and runs the same runner the request used to run in `after()`.
 * How the job ended is read back off the generation: the runner has already
 * settled the credits either way.
 *
 * **Only a cancel stops the provider call.** The job's signal also aborts when
 * the worker shuts down or loses the lease, and neither is a reason to fail
 * the generation: on shutdown the job goes back to the queue and the next
 * worker picks the `running` row up again (`resumeGeneration`); a lost lease
 * means another worker already has it.
 */

export const INTERRUPTED = 'interrupted'

const PayloadSchema = z.object({ generationId: ProductionGenerationIdSchema })

/** How the job ended, from the generation's own state once the runner is done. */
export const outcomeOfGeneration = (row: GenerationRun | null): JobOutcome => {
  if (row === null) return { status: 'failed', error: 'The generation is gone.' }
  switch (row.state) {
    case 'succeeded':
      return { status: 'finished' }
    case 'refused':
      return { status: 'blocked', reason: row.refusalReason ?? 'The model refused it.' }
    case 'cancelled':
      return { status: 'cancelled' }
    case 'failed':
      return { status: 'failed', error: row.error ?? 'The generation failed.' }
    case 'queued':
    case 'running':
      return { status: 'failed', error: 'The generation did not settle.' }
  }
}

/** A signal that aborts only when the writer cancels - see the header. */
const onCancel = (signal: AbortSignal): AbortSignal => {
  const cancel = new AbortController()
  const follow = (): void => {
    if (signal.reason === 'cancel') cancel.abort('cancel')
  }
  if (signal.aborted) follow()
  else signal.addEventListener('abort', follow, { once: true })
  return cancel.signal
}

const scopeOf = (job: ClaimedJob): Promise<ProjectScope> => openProjectForWorker(job.projectId, job.createdBy)

export const productionGenerationHandler: JobHandler = {
  run: async ({ job, signal }) => {
    const payload = PayloadSchema.safeParse(job.payload)
    if (!payload.success) return { status: 'failed', error: 'The job names no generation.' }
    const id = payload.data.generationId
    const scope = await scopeOf(job)

    const row = await readGenerationForRun(scope, id)
    if (row === null) return { status: 'failed', error: 'The generation is gone.' }
    // Cancelled while it waited, or settled by an earlier attempt: nothing to run.
    if (row.state !== 'queued' && row.state !== 'running') return outcomeOfGeneration(row)

    const spec = specFromRun(row)
    if (spec === null) {
      await failGeneration(scope, id, 'The stored spec did not read.')
      return outcomeOfGeneration(await readGenerationForRun(scope, id))
    }
    const [reel, cast] = await Promise.all([
      row.targetType === 'reel' ? readReelView(scope, row.targetId as ReelId) : Promise.resolve(null),
      row.job === 'ai_shotlist' ? readCastAndPlaces(scope) : Promise.resolve(null),
    ])
    await runGeneration({ scope, id, spec, reel, names: cast?.names ?? [], target: { type: row.targetType, id: row.targetId }, signal: onCancel(signal) })
    return outcomeOfGeneration(await readGenerationForRun(scope, id))
  },

  /** Failed without finishing (the stale sweep's third attempt): the generation is interrupted, its credits released. */
  abandon: async (job) => {
    const payload = PayloadSchema.safeParse(job.payload)
    if (!payload.success) return
    await failGeneration(await scopeOf(job), payload.data.generationId, INTERRUPTED)
  },
}
