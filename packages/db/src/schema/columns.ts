import { sql } from 'drizzle-orm'
import { text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Column builders every table shares.
 *
 * Written once so that "every table carries `project_id`" (AGENTS.md, Tenancy
 * and data access) is a call to one function rather than a line somebody can
 * forget. The scope machinery in `../scope.ts` then requires that column's
 * *type* to be present before a table can be queried at all, so forgetting it
 * is a compile error rather than a tenancy leak.
 */

/**
 * The tenant column. Present on every table but one.
 *
 * The exception is `users`, and it is a real exception rather than a lapse: a
 * person exists before they belong to a project and belongs to many, so a
 * `project_id` on that table would have to be either null or a lie. AGENTS.md,
 * Tech stack says `users` is ours precisely because it is the identity that
 * spans projects. The consequence is that `users` is the one table the
 * project-scoped repository machinery cannot reach, and that is enforced rather
 * than documented - `usersTable` is not a `ProjectScopedTable`, so it does not
 * compile as an argument to a scoped query. Reads of it go through their own
 * repository with their own reasoning.
 */
export const projectIdColumn = () => uuid('project_id').notNull()

/** A primary key the database mints when the caller does not. */
export const idColumn = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`)

/**
 * Timestamps.
 *
 * `withTimezone` always. A production office in Mumbai and a producer in London
 * reading the same revision date is not a hypothetical, and a naive timestamp
 * makes that a bug nobody can see.
 *
 * `mode: 'date'` gives a `Date` at the Drizzle boundary; the repositories turn
 * it into an ISO string, because `@folio/contracts` carries timestamps as
 * strings so they survive a queue payload. That conversion in one place is why
 * the contract and the column are allowed to disagree.
 */
export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' })

/**
 * A fractional order key.
 *
 * `text`, compared lexicographically, not a float. See `OrderKeySchema` in
 * `@folio/contracts` for why: repeatedly splitting at the same point exhausts a
 * double's mantissa in about fifty edits, and the failure corrupts document
 * order silently. A string can always get one character longer.
 *
 * Flagged: the design handoff's Appendix A sketches this as `order: number`.
 * The appendix is a sketch and says the contract wins where they differ, but
 * nobody has ruled this one specifically.
 */
export const orderKeyColumn = () => text('order_key').notNull()
