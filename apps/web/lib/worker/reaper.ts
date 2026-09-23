import type { ProductionGenerationId } from '@folio/contracts'
import type { OrphanedReservation, PeriodicTask, ProjectScope, WorkerLog } from '@folio/db'
import { appendLedgerEntry, failGeneration, listOrphanedReservations, listProjectsHoldingReservations, openProjectForWorker, sessionDatabase } from '@folio/db'

import { INTERRUPTED } from './production-generation'

/**
 * The reaper - roadmap task 4.3. Every ten minutes it closes the reservations
 * nothing else will close (`listOrphanedReservations`, widened for it on
 * 2026-09-23):
 *
 *   a generation still `queued`/`running` with no live job to run it
 *       - failed with the reason "interrupted", which releases its credits
 *         and puts its target back (`failGeneration`)
 *   a generation or a frame job that is over, its reservation still held,
 *   or a reservation whose job id names nothing any more
 *       - released, under the same `release:job:<id>` key every other
 *         release uses, so a late settle cannot close it twice
 *   a reservation with no job id at all
 *       - logged, never released: a `release` with no job id would close
 *         every such reservation in the project at once (`readBalance` keys
 *         held-ness on `job_id`). Nothing writes one; finding one is a bug.
 *
 * It acts as no one (`actor` null): the entries it writes are the system's,
 * as the stale sweep's are.
 */

export const REAP_EVERY_MS = 10 * 60 * 1000

export type Reaped = { readonly interrupted: number; readonly released: number; readonly skipped: number }

const release = async (scope: ProjectScope, orphan: OrphanedReservation, why: string): Promise<boolean> => {
  const { entry } = orphan
  if (entry.jobId === null) return false
  await appendLedgerEntry(scope, {
    kind: 'release',
    delta: -entry.delta,
    jobId: entry.jobId,
    idempotencyKey: `release:job:${entry.jobId}`,
    reason: `Released by the reaper: ${why}`,
  })
  return true
}

/** One project's orphans, closed. Exported for the test. */
export const reapProject = async (scope: ProjectScope, log: WorkerLog): Promise<Reaped> => {
  let interrupted = 0
  let released = 0
  let skipped = 0
  for (const orphan of await listOrphanedReservations(scope)) {
    const { owner, entry } = orphan
    if (owner.kind === 'generation' && (owner.state === 'queued' || owner.state === 'running')) {
      // Null: it settled between the read and this write, and closed its own reservation.
      if ((await failGeneration(scope, owner.id as ProductionGenerationId, INTERRUPTED)) !== null) interrupted += 1
      continue
    }
    const why = owner.kind === 'generation' ? `the generation is ${owner.state}` : owner.kind === 'job' ? `the job is ${owner.status}` : 'nothing it names still exists'
    if (await release(scope, orphan, why)) {
      released += 1
      continue
    }
    skipped += 1
    log({ event: 'folio.reaper.unkeyed_reservation', projectId: scope.projectId, entryId: entry.id, delta: entry.delta, occurredAt: entry.occurredAt })
  }
  return { interrupted, released, skipped }
}

export const reaper: PeriodicTask = {
  name: 'reaper',
  everyMs: REAP_EVERY_MS,
  run: async (log) => {
    const projects = await listProjectsHoldingReservations(await sessionDatabase())
    for (const projectId of projects) {
      const reaped = await reapProject(await openProjectForWorker(projectId, null), log)
      if (reaped.interrupted + reaped.released > 0) log({ event: 'folio.reaper.reaped', projectId, ...reaped })
    }
  },
}
