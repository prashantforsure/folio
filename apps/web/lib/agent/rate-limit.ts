import type { RateLimitBucket, UserId } from '@folio/contracts'
import { touchRateLimit } from '@folio/db'
import type { ProjectScope } from '@folio/db'

import { RATE_LIMITS } from './limits'

/**
 * "May this caller do one more of these this hour?" - ADR 0003 **D14**.
 *
 * One statement (`touchRateLimit`, `@folio/db`), called **after** the gate and
 * before the work. After, because the counter is per user per project and
 * neither is known until the gate has said so; before the work, because a
 * limit that counts what already happened is a report.
 *
 * ## The refusal names a number
 *
 * "Wait a while" is not advice anybody can act on. The refusal carries
 * `retryAfterSeconds` - the time to the end of the window, from the database's
 * clock - so a person is told when to come back and a caller that retries by
 * itself has something to wait for. Whether a caller *should* retry on its own
 * is not this function's business; it answers the question it was asked.
 */
export type RateLimited = {
  readonly status: 'rate-limited'
  readonly message: string
  readonly retryAfterSeconds: number
}

const NOUN: Readonly<Record<RateLimitBucket, string>> = {
  assistant: 'assistant requests',
  generate: 'generations',
}

const minutes = (seconds: number): string => {
  if (seconds <= 90) return `${String(Math.max(1, Math.round(seconds)))} seconds`
  return `${String(Math.round(seconds / 60))} minutes`
}

/**
 * `null` when the caller may proceed. A `RateLimited` result when they may
 * not - the caller returns it, or maps it onto its own result type.
 */
export const checkRateLimit = async (
  scope: ProjectScope,
  actor: UserId,
  bucket: RateLimitBucket,
): Promise<RateLimited | null> => {
  const limit = RATE_LIMITS[bucket]
  const outcome = await touchRateLimit(scope, actor, bucket, limit)
  if (outcome.allowed) return null
  return {
    status: 'rate-limited',
    message:
      `That is ${String(limit)} ${NOUN[bucket]} on this project in an hour, which is the limit. ` +
      `Try again in ${minutes(outcome.retryAfterSeconds)}.`,
    retryAfterSeconds: outcome.retryAfterSeconds,
  }
}
