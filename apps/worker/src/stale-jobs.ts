import type { JobKind } from '@folio/contracts'
import type { CancelJobResult, QueuedJob } from '@folio/db'

/**
 * The one-off pre-deploy sweep of stale queued jobs - `scripts/cancel-stale-jobs.ts`.
 *
 * Jobs queued while no worker ran would all start the moment one does, and a
 * frame job spends the credits it reserved. This lists every job still
 * `queued` from before a date and, **only with `--confirm`**, cancels each
 * through `cancelJob`, which releases its reservation in the same statement.
 * Without `--confirm` it prints what it would do and writes nothing.
 *
 * **Frame jobs only.** `cancelJob` is the Storyboard's cancel: it settles the
 * `jobs` row and the ledger and nothing else, and its release names a frame. A
 * `production_generation` job cancelled through it would leave its
 * `generations` row queued for ever, and an `agent_run` job its run - so those
 * are listed and left, with the cancel that does settle them named.
 *
 * The dependencies are passed in so the policy is tested without a database
 * (`stale-jobs.test.ts`); the script wires in `@folio/db`.
 */

/** The one kind `cancelJob` settles completely. */
export const CANCELLED_BY_CANCEL_JOB: JobKind = 'frame_generation'

/** Where to cancel a kind `cancelJob` would only half-settle. */
const ELSEWHERE: Readonly<Partial<Record<JobKind, string>>> = {
  production_generation: "cancel its generation instead (Production's cancel, `cancelGeneration`), which settles the generation row with the job",
  agent_run: 'cancel its run instead (the run card, `cancelBackgroundRun`), which settles the run with the job',
}

export type StaleJobsArgs = { readonly before: Date; readonly confirm: boolean }

export type ParsedArgs = { readonly ok: true; readonly args: StaleJobsArgs } | { readonly ok: false; readonly message: string }

export const USAGE = 'Usage: cancel-stale-jobs --before <YYYY-MM-DD or ISO timestamp> [--confirm]'

/** `--before <date>` (or `--before=<date>`), required; `--confirm`, optional. Anything else is refused. */
export const parseStaleJobsArgs = (argv: readonly string[]): ParsedArgs => {
  let before: string | null = null
  let confirm = false
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? ''
    if (arg === '--confirm') confirm = true
    else if (arg === '--before') {
      before = argv[at + 1] ?? null
      at += 1
    } else if (arg.startsWith('--before=')) before = arg.slice('--before='.length)
    else return { ok: false, message: `Unknown argument ${arg}.\n${USAGE}` }
  }
  if (before === null || before.trim() === '') return { ok: false, message: `--before is required.\n${USAGE}` }
  // A date or a timestamp, nothing looser: `Date.parse` alone takes "5" as a year.
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/u.test(before.trim())) return { ok: false, message: `--before ${before} is not a date.\n${USAGE}` }
  const when = new Date(before.trim())
  if (Number.isNaN(when.getTime())) return { ok: false, message: `--before ${before} is not a date.\n${USAGE}` }
  return { ok: true, args: { before: when, confirm } }
}

export type StaleJobsDeps = {
  readonly list: (before: Date) => Promise<readonly QueuedJob[]>
  readonly cancel: (job: QueuedJob) => Promise<CancelJobResult>
  readonly print: (line: string) => void
}

export type StaleJobsReport = {
  readonly listed: number
  readonly cancelled: number
  readonly released: number
  /** Not frame jobs: listed, never touched. */
  readonly left: number
  /** Frame jobs that were not cancelled: started meanwhile, already over, gone, or the cancel threw. */
  readonly missed: number
  /** Of those, the cancels that threw - the script exits 1 when there is one. */
  readonly failed: number
}

const lineOf = (job: QueuedJob): string =>
  `${job.id}  ${job.kind}  project ${job.projectId as string}  cost ${String(job.cost)}  queued ${job.createdAt}`

const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`

export const cancelStaleJobs = async (deps: StaleJobsDeps, args: StaleJobsArgs): Promise<StaleJobsReport> => {
  const { print } = deps
  const jobs = await deps.list(args.before)
  const frames = jobs.filter((job) => job.kind === CANCELLED_BY_CANCEL_JOB)
  const others = jobs.filter((job) => job.kind !== CANCELLED_BY_CANCEL_JOB)

  print(`${plural(jobs.length, 'queued job')} queued before ${args.before.toISOString()}.`)
  for (const job of jobs) print(`  ${lineOf(job)}`)
  for (const job of others) print(`  left: ${job.id} is ${job.kind} - ${ELSEWHERE[job.kind] ?? 'cancelJob does not settle this kind; left as it is'}.`)

  const reserved = frames.reduce((total, job) => total + job.cost, 0)
  if (!args.confirm) {
    print(`Dry run: would cancel ${plural(frames.length, 'frame job')} and release up to ${plural(reserved, 'credit')}; ${String(others.length)} left. Nothing was written.`)
    if (frames.length > 0) print('Run again with --confirm to cancel them.')
    return { listed: jobs.length, cancelled: 0, released: 0, left: others.length, missed: 0, failed: 0 }
  }

  let cancelled = 0
  let released = 0
  let missed = 0
  let failed = 0
  for (const job of frames) {
    let outcome: CancelJobResult
    try {
      outcome = await deps.cancel(job)
    } catch (cause) {
      missed += 1
      failed += 1
      print(`  failed: ${job.id} - ${cause instanceof Error ? cause.message : String(cause)}`)
      continue
    }
    switch (outcome.status) {
      case 'cancelled':
        cancelled += 1
        released += outcome.released
        print(`  cancelled: ${job.id}, ${plural(outcome.released, 'credit')} released`)
        break
      case 'requested':
        // It was claimed between the list and the cancel: asked to stop, and the worker settles it.
        missed += 1
        print(`  running now: ${job.id} was asked to stop; the worker settles its ${plural(outcome.cost, 'credit')}`)
        break
      case 'already-over':
        missed += 1
        print(`  already ${outcome.was}: ${job.id}`)
        break
      case 'no-job':
        missed += 1
        print(`  gone: ${job.id}`)
        break
    }
  }
  print(`Cancelled ${plural(cancelled, 'frame job')}, released ${plural(released, 'credit')}; ${String(missed)} not cancelled (${String(failed)} failed), ${String(others.length)} left.`)
  return { listed: jobs.length, cancelled, released, left: others.length, missed, failed }
}
