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
 * **D14's third limit**, recorded here and not yet enforced: two concurrent
 * agent runs per project. It is a count of live `agent_runs` rows rather than
 * a window, so it lands with that table (roadmap Phase 4) rather than with the
 * counters. Per project rather than per user because it protects the document,
 * not the bill.
 */
export const CONCURRENT_RUNS_PER_PROJECT = 2

/**
 * **D3.** A per-user daily token cap, so a run cannot cost unbounded model
 * time. Recorded with the others; the meter that reads it is `agent_runs`,
 * which does not exist yet.
 */
export const DAILY_TOKENS_PER_USER = 2_000_000
