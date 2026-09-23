/**
 * Whether the model `apps/web/lib/assistant/model.ts` names exists for this
 * key - one Models API call. `web/model-check` is the check and says why; the
 * key is read through `@folio/db/env`, as everywhere.
 *
 *   node --env-file=apps/web/.env apps/worker/scripts/run.mjs scripts/check-model.ts
 *
 * Exit 0: it exists. 1: it does not, or the question could not be answered.
 * 2: no `ANTHROPIC_API_KEY`, so nothing was asked.
 */
import { checkAssistantModel, modelCheckReport } from 'web/model-check'

const report = modelCheckReport(await checkAssistantModel())
if (report.exitCode === 0) console.log(report.line)
else console.error(report.line)
process.exitCode = report.exitCode
