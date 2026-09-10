import { defineConfig } from 'drizzle-kit'

import { serverEnv } from './src/env'

/**
 * drizzle-kit. Forward-only, owned in the repo.
 *
 * AGENTS.md, Tech stack: "Migrations | drizzle-kit, forward-only | Owned in the
 * repo", and When to ask first: "Edit schema in the Supabase dashboard. (The
 * answer is always no.)" Every change to this database is a file under
 * `migrations/`, in git, reviewed like code.
 *
 * ## Which connection this uses, and why
 *
 * `DATABASE_URL_SESSION`. DDL in transaction-pooler mode is a bad idea - the
 * pooler hands out a different backend per transaction, and a migration that
 * takes a lock in one statement and uses it in the next will not find it.
 *
 * ## What needs the environment and what does not
 *
 * `generate` and `check` read the schema files and the journal. Neither opens a
 * socket. They still need the variable to be **present**, because this config
 * is evaluated whole - so `drizzle-kit check` on a machine with no `.env` fails
 * with the environment error rather than a connection error, which is the
 * clearer of the two.
 *
 * `migrate` genuinely connects. That is the only command in this package that
 * needs a reachable database.
 *
 * Nothing in `pnpm typecheck`, `pnpm lint`, `pnpm test` or `pnpm build` runs any
 * of them.
 *
 * ## strict and verbose
 *
 * `strict: true` makes drizzle-kit ask before running a statement it thinks is
 * destructive. AGENTS.md, When to ask first: "write a migration that drops a
 * column" needs a human. This is that prompt, on by default rather than
 * remembered.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: serverEnv.DATABASE_URL_SESSION },
  strict: true,
  verbose: true,
  /**
   * Supabase owns `auth`, `storage`, `realtime` and the rest. Without this,
   * `drizzle-kit generate` reads them as tables we forgot to declare and writes
   * a migration that drops them.
   */
  schemaFilter: ['public'],
})
