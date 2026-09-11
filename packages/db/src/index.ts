/**
 * @folio/db - Drizzle schema, forward-only migrations, project-scoped
 * repositories. The only place SQL lives.
 *
 * ## The tenancy mechanism, in one paragraph
 *
 * AGENTS.md, Tenancy: "Every query goes through a project-scoped repository.
 * The server uses the service-role key, which bypasses RLS entirely - RLS is a
 * safety net, not the mechanism." Because the server connects as the owner,
 * Postgres will happily return every project's rows for a query that forgot its
 * `WHERE`; there is nothing underneath to catch it. So the catching happens in
 * the type system. A `ProjectScope` is keyed by a `unique symbol` this package
 * does not export, so it cannot be fabricated; every repository function takes
 * one as its first argument, so an unscoped call is a missing argument; and the
 * database handle is behind a second private symbol, so a repository cannot
 * reach around `scoped()`. `scope-guarantees.ts` proves all three with
 * `@ts-expect-error`, which makes `pnpm typecheck` the test that they hold.
 *
 * ## What is exported and what is not
 *
 * `serverEnv` is **not** here. It lives behind `@folio/db/env`, so importing
 * this package for a table definition cannot drag the Supabase service-role key
 * into a bundle. AGENTS.md, Tenancy: "The service-role key must never reach the
 * browser." `apps/web/scripts/assert-no-server-secrets.mjs` fails the build if
 * one ever does.
 *
 * The two public `NEXT_PUBLIC_SUPABASE_*` values used to sit beside it and no
 * longer do - they are in `apps/web/lib/env/public.ts`. `@folio/db/env` throws
 * at module scope when imported in a browser, which is correct for a file
 * holding the service-role key and fatal for one holding a value the browser
 * needs. The split is now physical rather than conventional.
 *
 * `makeScope`, the `handle` symbol and `dbOf` are not here either. The package
 * boundary is the enforcement boundary - the same boundary AGENTS.md draws when
 * it says this package is the only place SQL lives - so a consumer gets
 * `openProjectForRequest`, `openProjectForWorker`, and a `ProjectScope` it
 * cannot look inside.
 *
 * ## Classification
 *
 * Every table is authored, derived-cache or measurement, and the full list with
 * its reasoning is in `schema/index.ts`. That classification is what decides
 * who may write a table: a derived cache is rewritten by `derive`, a
 * measurement by `paginate`, and neither may touch the other's rows or any
 * authored row. The derivation writer in `repositories/derived.ts` enforces its
 * half structurally - it has no reference to an authored table at all.
 */
export const PACKAGE_NAME = '@folio/db'

export * as schema from './schema'

export type { FolioDatabase } from './client'
export { closeDatabases, sessionDatabase, transactionDatabase } from './client'

export type { ProjectScope, ProjectScopedTable, TenantColumnTable } from './scope'

export type { OrderKey } from '@folio/contracts'
export { between, firstOrderKey, spread } from './order'

export * from './repositories'

export type { NodeWritePlan, StoredNodeRow } from './node-plan'
export { planNodeWrite } from './node-plan'
