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
 *
 * **The column is `COLLATE "C"` in the database and cannot say so here.**
 * Drizzle's `text()` builder has no collation, so migration `0032` sets it
 * (and `0006` set `shots.order_key` by hand before it). The collation is not a
 * detail: under a locale collation this column is not a byte string and the
 * order it returns is not the order the keys encode - `../order.ts` records
 * the incident. `db:generate` sees no diff, because there is nothing here for
 * it to diff against; a table that adds an order key needs the `COLLATE "C"`
 * written into its migration by hand.
 */
export const orderKeyColumn = () => text('order_key').notNull()

/**
 * The key that makes a create idempotent, and the index that enforces it.
 *
 * Nullable, because every create the UI makes carries no key and must keep
 * working: a person clicking `＋ New character` twice means two characters, and
 * `NULL` is not equal to `NULL`, so a partial unique index leaves them alone.
 * A caller that *can* be retried - the agent, whose `tool_use` id is the key
 * (ADR 0003 **D13**) - passes one, and the second insert with that key hits the
 * index instead of creating a second row.
 *
 * Per project rather than globally, for `credit_ledger`'s reason
 * (`schema/credits.ts`): two projects reconciling the same upstream id is
 * legitimate, and a global key would make the second one vanish.
 */
export const idempotencyKeyColumn = () => text('idempotency_key')
