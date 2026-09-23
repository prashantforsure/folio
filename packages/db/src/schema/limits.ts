import { RATE_LIMIT_BUCKETS } from '@folio/contracts'
import { integer, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'

import { projectIdColumn, timestampColumn } from './columns'
import { projects, users } from './tenancy'

/**
 * `rate_limits` - one counter per user, per project, per bucket, per hour.
 * AUTHORED by the system on a request.
 *
 * ADR 0003 **D14**. No rate limiting of any kind existed before this: the only
 * `429` in the repository was *reading* Supabase's own limit on auth. A model
 * that can call a tool in a loop is the first thing in this product that
 * generates load without a human clicking, so the limits ship with it.
 *
 * ## Why a table and not Redis
 *
 * D6 rules out Redis for the queue, for reasons that hold here too: it would
 * be a dependency decision AGENTS.md puts behind a question, and a second
 * store beside Postgres. A fixed window is a counting query - approximate at
 * the boundary, exact enough for limits set well above real use.
 *
 * ## Why `project_id` is in the key
 *
 * Every table but `users` carries it (AGENTS.md, Tenancy), and the type system
 * enforces that: a table with no `project_id` is not a `ProjectScopedTable` and
 * cannot be queried through a scope at all. It is also the right key - the
 * limits are per user *per project*, so somebody working on two projects is
 * not throttled on one by what they did on the other.
 *
 * ## The window is the hour, and it is not stored as a range
 *
 * `window_start` is `date_trunc('hour', now())`, written by the statement that
 * increments the count, so a new hour is a new row rather than a reset. Old
 * rows are dead weight rather than a correctness problem; nothing reads them
 * and a retention sweep is a later pass's (`activity_log` is in the same
 * position, and is on the orphan list in `docs/remainingroadmap.md`).
 */
export const rateLimitBucketEnum = pgEnum('rate_limit_bucket', RATE_LIMIT_BUCKETS)

export const rateLimits = pgTable(
  'rate_limits',
  {
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bucket: rateLimitBucketEnum('bucket').notNull(),
    /** `date_trunc('hour', now())`. Part of the key, so a new hour is a new row. */
    windowStart: timestampColumn('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId, table.bucket, table.windowStart] }),
  ],
)
