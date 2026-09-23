import type { JobHandler } from '@folio/db'

import { abandonBackgroundJob, runBackgroundJob } from '../agent/background'
import { assistantClient, modelClientOf } from '../assistant/client'

/**
 * A background agent run, on the worker - roadmap task 4.4. The run itself is
 * `lib/agent/background.ts`; this hands it the model (null without
 * `ANTHROPIC_API_KEY` on the worker, which fails the run with that reason) and
 * fails it as interrupted when the runtime gives up on the job.
 */
export const agentRunHandler: JobHandler = {
  run: async ({ job, signal }) => {
    const anthropic = assistantClient()
    return runBackgroundJob(job, signal, { client: anthropic === null ? null : modelClientOf(anthropic) })
  },
  abandon: abandonBackgroundJob,
}
