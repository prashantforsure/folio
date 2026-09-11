# packages/db

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before adding a table or asking what may write one, read
[src/schema/index.ts](src/schema/index.ts) — every table is classified
authored / derived-cache / measurement. Touching `episodes` needs
[ADR 0002](../../docs/adr/0002-episode-identity.md) first.

- **Tenancy is a compile error, not a review catch.** [scope.ts](src/scope.ts): a `ProjectScope` is
  keyed by a private `unique symbol` so it cannot be fabricated; every repository takes one; the
  handle sits behind a second symbol; a table without `project_id` is not assignable.
  [scope-guarantees.ts](src/scope-guarantees.ts) proves all four with `@ts-expect-error`, so
  `pnpm typecheck` is the test that they hold.
- **Nothing needs a live database.** Both factories in [client.ts](src/client.ts) are lazy —
  importing `@folio/db` for a table definition reads no env and opens no socket.
- **[env.ts](src/env.ts) is the only reader of secrets** (`@folio/db/env`), loads `.env` itself,
  and **throws at module scope in a browser** — correct for a file holding the service-role key.
  The two public `NEXT_PUBLIC_SUPABASE_*` values therefore live in `apps/web/lib/env/public.ts`,
  not here.
- **The migrations are applied to the dev Supabase project** (shell-routes phase), and `0000` was
  reordered once, before it had ever run anywhere — see "Shell routes phase" in
  `docs/build-decisions.md`. Migrations are forward-only.

## Commands

```bash
pnpm --filter @folio/db db:generate   # write a migration from the schema
pnpm --filter @folio/db db:check      # verify the journal — reads files, never connects
pnpm --filter @folio/db db:migrate    # the only one that needs a reachable database
```

All three need the env vars **present** — `drizzle.config.ts` is evaluated whole. On a bare
checkout `.env` is empty, so `db:check` exits 1 with `env.ts`'s three-problem report. That is a
config failure, not a schema failure; the journal is clean.

AGENTS.md's `pnpm --filter @folio/db drizzle-kit check` does not run at all
(`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` — not a script name). Use `db:check`.

**`db:migrate` hides the failing statement.** When a migration errors, `drizzle-kit migrate` prints
only Postgres NOTICEs and exits 1 — no query, no message. To see the real error, run
`drizzle-orm/postgres-js/migrator`'s `migrate()` directly from a node one-liner in this directory;
it throws with the failed SQL and the cause. That is how the `0000` ordering bug was found.
