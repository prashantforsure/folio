import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

/**
 * A JSON value as a `jsonb` parameter in a hand-written statement.
 *
 * Drizzle's postgres-js driver replaces the driver's json serialisers with
 * pass-throughs (`postgres-js/driver.js`) because it stringifies `jsonb`
 * *columns* itself - so a raw object handed to `sql.param` reaches the
 * wire as `[object Object]`, and an array crashes the bind. Every
 * `jsonb_to_recordset` in the repositories takes its rows through here.
 */
export const jsonb = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`
