import type { PoolerMode } from '@folio/contracts'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

/**
 * Two connection paths, and they are not interchangeable.
 *
 * AGENTS.md, Tech stack: "Session pooler for the worker, transaction pooler for
 * requests." That is one line and it hides a real constraint, so it is written
 * out here.
 *
 * **The transaction pooler cannot do prepared statements.** Supabase's
 * transaction mode hands a different backend connection to each transaction, so
 * a statement prepared on one is not there on the next. postgres.js prepares by
 * default; left alone it produces `prepared statement "s1" does not exist`
 * under load and not in development, which is the worst possible place to find
 * out. `prepare: false` on that path is mandatory, not a tuning choice.
 *
 * **The session pooler can, and the worker needs what comes with it.** A
 * session-mode connection is one backend for its lifetime, so prepared
 * statements, `LISTEN`/`NOTIFY`, advisory locks and `SET` all behave. Long jobs
 * want all four. It is also the path migrations run over, because DDL in
 * transaction mode is asking for trouble.
 *
 * ## Where the mode is carried
 *
 * Not on the handle - on the scope. See `scope.ts`: a `ProjectScope` is branded
 * with the pooler it was opened over, so a repository that genuinely needs a
 * session (an advisory lock around a long generation, say) can require
 * `ProjectScope<'session'>` in its signature and a request-path scope will not
 * compile. Nothing needs that yet. It costs nothing now and the alternative is
 * discovering the requirement at runtime, in the worker.
 *
 * Branding the Drizzle handle itself was the first attempt and it is worse: the
 * handle comes out of `drizzle()` unbranded, so attaching the brand needs
 * either a runtime property on somebody else's object or an assertion, and
 * AGENTS.md, Conventions > Typing bans `as unknown as`. The scope is an object
 * this package constructs, so its brand is free and honest.
 *
 * ## Nothing here connects at import
 *
 * Both factories are lazy and memoised. postgres.js does not open a socket
 * until the first query, and the environment is not read until a factory is
 * called - so importing `@folio/db` for a table definition needs neither a
 * database nor a `.env`. That is what keeps typecheck, lint, build and the unit
 * tests runnable with no Supabase project in existence.
 */

/** A Drizzle handle over the full schema. Which pooler it came through is on the scope. */
export type FolioDatabase = PostgresJsDatabase<typeof schema>

/**
 * The worker and migrations.
 *
 * `idle_timeout: 0` keeps connections. A long-running service that reconnects
 * on every quiet spell spends its life in TLS handshakes.
 */
const SESSION_OPTIONS = {
  prepare: true,
  max: 10,
  idle_timeout: 0,
  connect_timeout: 30,
} as const

/**
 * Web requests.
 *
 * `prepare: false` is required - see the header. `max` is small because the
 * pooler is the pool: every instance holding ten connections is how a Supabase
 * project runs out of them. A short `idle_timeout` returns them promptly.
 */
const TRANSACTION_OPTIONS = {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
} as const

type Connection = {
  readonly sql: postgres.Sql
  readonly db: FolioDatabase
}

const open = (url: string, mode: PoolerMode): Connection => {
  const client =
    mode === 'session' ? postgres(url, SESSION_OPTIONS) : postgres(url, TRANSACTION_OPTIONS)
  return { sql: client, db: drizzle(client, { schema }) }
}

let sessionConnection: Connection | null = null
let transactionConnection: Connection | null = null

/**
 * The worker's connection, and the one migrations run over.
 *
 * Reads the environment on first call, not at import. Throws loudly if it is
 * missing - `env.ts` lists every problem at once and says where each value
 * comes from.
 */
export const sessionDatabase = async (): Promise<FolioDatabase> => {
  if (sessionConnection === null) {
    const { serverEnv } = await import('./env')
    sessionConnection = open(serverEnv.DATABASE_URL_SESSION, 'session')
  }
  return sessionConnection.db
}

/** The request path. `prepare: false`, because the transaction pooler requires it. */
export const transactionDatabase = async (): Promise<FolioDatabase> => {
  if (transactionConnection === null) {
    const { serverEnv } = await import('./env')
    transactionConnection = open(serverEnv.DATABASE_URL_TRANSACTION, 'transaction')
  }
  return transactionConnection.db
}

/**
 * Close whatever is open.
 *
 * For the worker's shutdown handler and for tests. `{ timeout: 5 }` lets a
 * query in flight finish rather than tearing a job's transaction in half.
 */
export const closeDatabases = async (): Promise<void> => {
  const live = [sessionConnection, transactionConnection].filter(
    (connection): connection is Connection => connection !== null,
  )
  sessionConnection = null
  transactionConnection = null
  await Promise.all(live.map((connection) => connection.sql.end({ timeout: 5 })))
}
