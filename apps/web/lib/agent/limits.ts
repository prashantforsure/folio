import type { RateLimitBucket } from '@folio/contracts'

/**
 * The numbers ADR 0003 sets, in one place.
 *
 * Constants and not environment variables, for `lib/assistant/model.ts`'s
 * reason: "a setting is how it drifts between deployments". A limit that is
 * different on staging is a limit nobody can reason about from the code.
 */

/**
 * **D14.** Fixed windows, one hour, per user per project.
 *
 * Set well above real use on purpose: these are a bound on a loop, not a
 * quota. A writer who hits 60 assistant requests in an hour is having an
 * unusual afternoon; a model that hits it has stopped making progress.
 */
export const RATE_LIMITS: Readonly<Record<RateLimitBucket, number>> = {
  assistant: 60,
  generate: 30,
}

/**
 * **D14's third limit**: two concurrent agent runs per project. It is a count
 * of live background runs - `queued` or `running` - rather than a window,
 * enforced since roadmap task 4.4 when a run starts and when a waiting one is
 * continued (`startBackgroundRun`, `continueBackgroundRun`, under a
 * per-project advisory lock). An interactive turn is not counted: it lasts a
 * minute and the writer is watching it. A run waiting for the writer holds
 * nothing and is not counted either. Per project rather than per user because
 * it protects the document, not the bill.
 */
export const CONCURRENT_RUNS_PER_PROJECT = 2

/**
 * **D5**, a background run's step cap per job. An interactive turn has 12 and
 * 60 seconds; a background run has no clock, and pauses for the writer
 * (`waiting_for_user`) after this many steps rather than ending - their reply
 * carries it on for as many again.
 */
export const BACKGROUND_MAX_STEPS = 40

/**
 * **D3.** A per-user daily token cap, so a run cannot cost unbounded model
 * time. The meter is `agent_runs` (`0034`), summed across every project the
 * person works in by `tokensTodayFor` (`@folio/db`).
 */
export const DAILY_TOKENS_PER_USER = 2_000_000
