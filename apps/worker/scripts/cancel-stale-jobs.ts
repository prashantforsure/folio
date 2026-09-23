/**
 * Cancel the jobs left queued from before a date - once, before the worker is
 * first deployed. `src/stale-jobs.ts` is the policy and says why; this wires it
 * to the database.
 *
 *   node --env-file=apps/web/.env apps/worker/scripts/run.mjs scripts/cancel-stale-jobs.ts --before 2026-09-24
 *   … --before 2026-09-24 --confirm
 *
 * Without `--confirm` it only prints. Each frame job is cancelled through
 * `cancelJob`, in its own project's scope, with no actor - the release is the
 * sweep's, not a person's.
 */
import { cancelJob, closeDatabases, listQueuedJobsBefore, openProjectForWorker, sessionDatabase } from '@folio/db'

import { cancelStaleJobs, parseStaleJobsArgs } from '../src/stale-jobs'

const main = async (): Promise<number> => {
  const parsed = parseStaleJobsArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.message)
    return 2
  }
  try {
    const db = await sessionDatabase()
    const report = await cancelStaleJobs(
      {
        list: (before) => listQueuedJobsBefore(db, before),
        cancel: async (job) => cancelJob(await openProjectForWorker(job.projectId, null), job.id),
        print: (line) => {
          console.log(line)
        },
      },
      parsed.args,
    )
    return report.failed > 0 ? 1 : 0
  } finally {
    await closeDatabases()
  }
}

process.exitCode = await main()
