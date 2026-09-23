import type { RateLimitBucket, UserId } from '@folio/contracts'
import { sql } from 'drizzle-orm'

import { rateLimits } from '../schema'
import { dbOf, tenant } from '../scope'
import type { ProjectScope } from '../scope'

/**
 * The fixed-window counter - ADR 0003 **D14**, one statement.
 *
 * ## Why the increment is the check
 *
 * Reading the count and then writing it is two statements with a race between
 * them, and the race is exactly the case the limit exists for: a caller making
 * requests faster than they can be counted. `INSERT … ON CONFLICT DO UPDATE`
 * with the limit in the `WHERE` is the whole decision in one atomic statement.
 *
 * ## How a refusal is recognised
 *
 * The update is conditional on `count < limit`, so when the limit is reached
 * the conflicting row matches nothing and **no row comes back**. An empty
 * result is the refusal, and it also means a caller past the limit stops
 * incrementing - the window ends when the hour does, not when they stop
 * trying, which is the difference between a limit and a punishment.
 *
 * `window_start` is `date_trunc('hour', now())` computed by the database, so
 * two web processes with different clocks agree on which window they are in.
 */
export type RateLimitOutcome =
  | { readonly allowed: true; readonly used: number; readonly limit: number }
  | { readonly allowed: false; readonly limit: number; readonly retryAfterSeconds: number }

export const touchRateLimit = async (
  scope: ProjectScope,
  actor: UserId,
  bucket: RateLimitBucket,
  limit: number,
): Promise<RateLimitOutcome> => {
  const rows = await dbOf(scope)
    .insert(rateLimits)
    .values({ ...tenant(scope), userId: actor, bucket, windowStart: sql`date_trunc('hour', now())`, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.projectId, rateLimits.userId, rateLimits.bucket, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
      setWhere: sql`${rateLimits.count} < ${limit}`,
    })
    .returning({ count: rateLimits.count })
  const row = rows[0]
  if (row !== undefined) return { allowed: true, used: row.count, limit }
  return { allowed: false, limit, retryAfterSeconds: await secondsToNextWindow(scope) }
}

/**
 * Seconds until the window turns over, from the database's clock rather than
 * this process's - the window boundary is the database's, and a caller told to
 * come back in 40 seconds by a server whose clock is a minute out comes back
 * to the same refusal.
 */
const secondsToNextWindow = async (scope: ProjectScope): Promise<number> => {
  const rows = await dbOf(scope).execute<{ seconds: number }>(
    sql`select ceil(extract(epoch from (date_trunc('hour', now()) + interval '1 hour' - now())))::int as seconds`,
  )
  const first = rows[0] as { readonly seconds: number } | undefined
  return first?.seconds ?? 3600
}
