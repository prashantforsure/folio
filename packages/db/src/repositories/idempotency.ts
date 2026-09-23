import { sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * What makes a create safe to retry.
 *
 * Nine tables carry a nullable `idempotency_key` and a partial unique index on
 * `(project_id, idempotency_key)` (migration `0031`). A caller that cannot
 * tell its own retry from a second intention - the agent, whose `tool_use` id
 * is the key, ADR 0003 **D13** - passes one, and the second insert with that
 * key conflicts instead of creating a second row. A caller that can - a person
 * clicking a button - passes nothing, and `NULL` never conflicts with `NULL`,
 * so two clicks still mean two records.
 *
 * ## Why a conflict is read back rather than reported
 *
 * "A repeat with the same key returns the existing row as success." The
 * alternative - refusing the second call - makes a retry indistinguishable
 * from a mistake at exactly the moment the caller cannot tell either, which
 * is what the key exists to fix. `credit_ledger` already takes a unique
 * violation as success (`repositories/credits.ts`); this returns the row too,
 * because a create has to answer with what it created.
 */

type KeyedTable = {
  readonly projectId: PgColumn
  readonly idempotencyKey: PgColumn
}

/**
 * The `ON CONFLICT DO NOTHING` clause that names the partial index.
 *
 * Targeted rather than bare: an untargeted clause would swallow *every*
 * unique violation on the table - a duplicate episode slug, a duplicate
 * alias - and turn a real collision into an insert that silently did nothing.
 */
export const onIdempotencyKeyConflict = (table: KeyedTable) => ({
  target: [table.projectId, table.idempotencyKey],
  targetWhere: sql`idempotency_key is not null`,
})

/**
 * The row the insert wrote, or - when the key had already been used - the row
 * the earlier call wrote, read back through `existing`.
 *
 * Both throws are "this cannot happen" rather than an outcome a caller
 * handles: an insert with no key returns a row or raises, and a conflict that
 * finds nothing to conflict with means the row was deleted between the two
 * statements, which is not a state any caller can do anything about.
 */
export const insertedOrExisting = async <T>(
  inserted: readonly T[],
  key: string | null,
  existing: () => Promise<T | null>,
  noun: string,
): Promise<T> => {
  const row = inserted[0]
  if (row !== undefined) return row
  if (key === null) {
    throw new Error(`Folio: inserting a ${noun} returned no row. This is a bug in the repository.`)
  }
  const already = await existing()
  if (already === null) {
    throw new Error(`Folio: a ${noun} with that idempotency key was written and is no longer there.`)
  }
  return already
}
