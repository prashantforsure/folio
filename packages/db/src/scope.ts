import type { PoolerMode, ProjectId, UserId } from '@folio/contracts'
import { and, eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import type { FolioDatabase } from './client'
import { projects } from './schema'

/**
 * The type that makes an unscoped query a compile error.
 *
 * AGENTS.md, Tenancy and data access: "Every table carries `project_id`. Every
 * query is tenant-scoped. **Every query goes through a project-scoped
 * repository.** The server uses the service-role key, which bypasses RLS
 * entirely - RLS is a safety net, not the mechanism."
 *
 * The last sentence is why this file has to be load-bearing rather than tidy.
 * Because the server connects as the owner, Postgres will happily return every
 * project's rows for a query that forgot its `WHERE`. There is nothing
 * underneath to catch it. So the catching has to happen in the type system,
 * before the query exists.
 *
 * Four mechanisms, each closing a different hole:
 *
 * **1. A scope cannot be fabricated.** `ProjectScope` is keyed by a
 * module-private `unique symbol`. An object literal written anywhere else -
 * `{ projectId, db }` - is not assignable to it, because it cannot name that
 * key. The only way to get one is `openProjectScope`, which is the only place a
 * project id and a database handle are ever put in the same object.
 *
 * **2. A repository cannot be called without one.** Every repository function
 * takes `ProjectScope` as its first parameter. Omitting it is a missing
 * argument - see `scope-guarantees.ts`, which asserts exactly that with
 * `@ts-expect-error`, in the style `packages/script` already uses for its own
 * compile-time proofs.
 *
 * **3. A repository cannot get at the raw handle.** The Drizzle object is
 * behind a second private symbol and is reachable only through `scoped()`
 * below, which applies the tenant predicate itself. Outside this package there
 * is no way to extract a database from a scope at all: `@folio/db` exports the
 * `ProjectScope` *type* and never the key, so to a consumer it is opaque.
 *
 * **4. A table that is not tenant-scoped cannot be queried through it.**
 * `ProjectScopedTable` requires a `project_id` column. `users` has none - a
 * person exists before they belong to a project - so `users` is not assignable
 * and cannot be passed to `scoped()`. The one exception to "every table carries
 * `project_id`" is therefore enforced by the compiler rather than remembered.
 *
 * What this does **not** do is stop a repository author writing
 * `sql\`SELECT * FROM nodes\`` by hand. Nothing in a type system can. That is
 * what RLS is the net for, and what "the repository layer is the mechanism"
 * means: the mechanism is a mechanism, not a proof.
 */

// ---------------------------------------------------------------------------
// The private keys
// ---------------------------------------------------------------------------

/**
 * Not exported from the package. This is what makes a scope unforgeable: a
 * caller outside this module cannot write a property with this key, so it
 * cannot write an object that satisfies `ProjectScope`.
 */
declare const scopeBrand: unique symbol

/**
 * The database handle's key. Exported from this *module* so repositories in
 * this package can reach it, and deliberately absent from the package's
 * `index.ts`, so nothing outside `@folio/db` can. The package boundary is the
 * enforcement boundary, which is the same boundary AGENTS.md draws when it says
 * `packages/db` is "the only place SQL lives".
 */
export const handle: unique symbol = Symbol('folio.db.handle')

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

/**
 * A project, a connection, and the person acting - as one unforgeable value.
 *
 * `Mode` records which pooler the connection came through. A repository that
 * needs a session connection - an advisory lock, a `LISTEN` - declares
 * `ProjectScope<'session'>` and a request-path scope will not compile. Nothing
 * needs it yet; the parameter defaults to either, so ordinary repositories
 * ignore it entirely.
 *
 * `actor` is who is doing this, or `null` for the worker acting on its own
 * behalf. It is *not* a permission check - AGENTS.md, Development philosophy 5:
 * "The server enforces; the client discloses", and the enforcing happens in the
 * server action, which is a later phase. It is here so that writes which record
 * an author (`created_by`, `bound_by`, `decided_by`) take it from the scope
 * rather than from an argument a caller can get wrong.
 */
export type ProjectScope<Mode extends PoolerMode = PoolerMode> = {
  readonly [scopeBrand]: Mode
  readonly projectId: ProjectId
  readonly actor: UserId | null
  /** Which pooler the handle came through. Readable, unlike the brand. */
  readonly pooler: Mode
  readonly [handle]: FolioDatabase
}

/**
 * The only way to make one.
 *
 * Deliberately not exported from the package index either - `repositories.ts`
 * wraps it in `openProject`, which is what web and worker call. Keeping the
 * constructor internal means the set of places that decide "this request is for
 * that project" is a set of one.
 */
export const makeScope = <Mode extends PoolerMode>(
  db: FolioDatabase,
  mode: Mode,
  projectId: ProjectId,
  actor: UserId | null,
): ProjectScope<Mode> => {
  // `scopeBrand` has no runtime value - it is `declare`d - so the brand exists
  // only in the type, exactly as `NodeId` and the other brands do in
  // `packages/script`. The object below is what a scope is at runtime.
  const scope = {
    projectId,
    actor,
    pooler: mode,
    [handle]: db,
  }
  return scope as ProjectScope<Mode>
}

// ---------------------------------------------------------------------------
// What may be queried through a scope
// ---------------------------------------------------------------------------

/**
 * A table that carries `project_id`.
 *
 * `users` does not, and so is not assignable here. That is the whole of the
 * enforcement for AGENTS.md's one real exception to "every table carries
 * `project_id`".
 */
export type TenantColumnTable = PgTable & {
  readonly projectId: PgColumn
}

/**
 * `projects` is the other shape a tenant-scoped table can take.
 *
 * It has no `project_id` column because its own `id` **is** the project id.
 * Rather than adding a redundant self-referencing column to satisfy a type,
 * the type admits both shapes and `tenantColumn` below picks the right one.
 */
export type ProjectScopedTable = TenantColumnTable | typeof projects

/**
 * The column that carries the tenant, whichever shape the table is.
 *
 * Every scoped query goes through here, so there is exactly one answer to
 * "which column is the tenant" in the entire package.
 */
export const tenantColumn = (table: ProjectScopedTable): PgColumn =>
  'projectId' in table ? table.projectId : projects.id

/**
 * The tenant predicate for a table, combined with whatever else the caller
 * wants.
 *
 * This is the function repositories actually use. The tenant clause is
 * **prepended by this function**, not passed in, so a caller cannot forget it
 * and cannot override it - the worst they can do is add a redundant one.
 *
 * ```ts
 * db.select().from(nodes).where(scoped(scope, nodes, eq(nodes.documentId, id)))
 * ```
 *
 * `scoped(scope, users, ...)` does not compile.
 */
export const scoped = (
  scope: ProjectScope,
  table: ProjectScopedTable,
  ...rest: readonly (SQL | undefined)[]
): SQL => {
  const predicate = and(eq(tenantColumn(table), scope.projectId), ...rest)
  if (predicate === undefined) {
    // `and()` returns undefined only when every operand is undefined, and the
    // tenant clause never is. Unreachable, and typed rather than asserted.
    return eq(tenantColumn(table), scope.projectId)
  }
  return predicate
}

/**
 * The values every insert into a tenant-scoped table must carry.
 *
 * Spread into an insert so the tenant column comes from the scope rather than
 * from the caller:
 *
 * ```ts
 * db.insert(nodes).values({ ...tenant(scope), documentId, type, ... })
 * ```
 *
 * An insert that omits it fails to typecheck anyway, because `project_id` is
 * `NOT NULL` with no default - but taking it from the scope means it cannot be
 * *present and wrong*, which is the failure that a not-null constraint does not
 * catch.
 */
export const tenant = (scope: ProjectScope): { readonly projectId: ProjectId } => ({
  projectId: scope.projectId,
})

/** The handle, for repositories inside this package only. */
export const dbOf = (scope: ProjectScope): FolioDatabase => scope[handle]
