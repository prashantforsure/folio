import { z } from 'zod'

/**
 * The environment, parsed once, loudly.
 *
 * **This file is the only place in the repository that may read
 * `process.env`.** That is not a convention: `eslint.config.mjs` bans the
 * expression everywhere else as an error, and this path is the single
 * exemption. `packages/script` cannot reach it at all - `process` is a
 * restricted global there, because AGENTS.md, Development philosophy 2 says the
 * pure core has "no `process.env`", and determinism is what makes speculative
 * derivation possible.
 *
 * Two objects, and the split is a security boundary rather than a tidiness one:
 *
 *   - `serverEnv` holds secrets. The service-role key **bypasses RLS
 *     entirely** (AGENTS.md, Tenancy), so a copy of it in a browser bundle is
 *     total access to every project in the database. AGENTS.md, Tenancy and
 *     data access: "The service-role key must never reach the browser. Same for
 *     Dodo keys."
 *   - `publicEnv` holds the two values that are *designed* to be public. The
 *     anon key is a JWT that carries no privilege on its own; RLS is what makes
 *     it safe, which is one of the reasons RLS exists at all even though the
 *     server does not rely on it.
 *
 * Three things keep the first out of the second:
 *
 *   1. `serverEnv` is behind its own export path, `@folio/db/env`, and is not
 *      re-exported from the package index - so importing `@folio/db` for a
 *      table definition cannot drag a secret into a bundle.
 *   2. Reading it in a browser throws before any value is returned.
 *   3. The schema refuses any server variable whose name begins with
 *      `NEXT_PUBLIC_`, because that prefix is an instruction to Next.js to
 *      inline the value into client JavaScript.
 *
 * ## Why it throws rather than falling back
 *
 * A default for a connection string is a way to talk to the wrong database
 * without noticing. There is no default for anything here. A missing or
 * malformed variable is a thrown error at import, with every problem listed at
 * once and each one saying where the value comes from - see `format` below.
 */

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * A tripwire, not a security control.
 *
 * Bundlers can and do reach past module boundaries. This catches the honest
 * mistake - a server-only module imported into a Client Component - at the
 * first moment it could do damage, which is better than discovering it in a
 * shipped bundle.
 */
const refuseBrowser = (): void => {
  // `hasOwnProperty` on `globalThis` rather than `typeof window`, so this file
  // does not need the DOM lib. A server-only package that can see `document`
  // is a server-only package somebody will eventually use `document` in.
  if (Object.prototype.hasOwnProperty.call(globalThis, 'window')) {
    throw new Error(
      'Folio: @folio/db/env was imported in a browser. It holds the Supabase service-role key, ' +
        'which bypasses RLS. Move the import into a Server Component, a server action or the worker.',
    )
  }
}

/**
 * Pull `.env` into `process.env` if there is one.
 *
 * `process.loadEnvFile` is native to Node 20.12+, so this costs no dependency -
 * `dotenv` is not installed and is not wanted. Next.js has already done this by
 * the time a route runs; the worker and `drizzle-kit` have not, which is why it
 * is here rather than assumed.
 *
 * Missing file is the normal case in production, where Railway supplies the
 * variables directly. It is not an error and it is not logged.
 */
const loadDotEnvIfPresent = (): void => {
  try {
    process.loadEnvFile()
  } catch {
    // No .env. Expected wherever the platform supplies the environment.
  }
}

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/**
 * A Postgres connection string.
 *
 * Checked for scheme and for having a host, and no further. Refusing anything
 * more specific would mean this file having an opinion about Supabase's
 * hostnames, which change, and about local development, which uses none of
 * them.
 */
const PostgresUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must start with postgres:// or postgresql://',
  })
  .refine((value) => {
    try {
      return new URL(value).hostname.length > 0
    } catch {
      return false
    }
  }, { message: 'is not a parseable URL' })

/**
 * A Supabase API key. A JWT, or one of the newer `sb_` publishable/secret keys.
 *
 * Length rather than structure: Supabase has changed the format once already
 * and a validator that knows too much about it becomes a false failure the
 * first time it changes again.
 */
const SupabaseKeySchema = z.string().min(20, 'looks too short to be a Supabase key')

const ServerEnvSchema = z.object({
  DATABASE_URL_SESSION: PostgresUrlSchema,
  DATABASE_URL_TRANSACTION: PostgresUrlSchema,
  SUPABASE_SERVICE_ROLE_KEY: SupabaseKeySchema,
})

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SupabaseKeySchema,
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>
export type PublicEnv = z.infer<typeof PublicEnvSchema>

/**
 * What each variable is and where it comes from.
 *
 * Carried here rather than only in `.env.example` so the failure message can
 * tell somebody where to go, at the moment they need to know, without them
 * having to find a file they have not got.
 */
const PROVENANCE: Readonly<Record<string, string>> = {
  DATABASE_URL_SESSION:
    'Supabase dashboard, Project Settings, Database, Connection string, "Session pooler". Used by the worker and by migrations.',
  DATABASE_URL_TRANSACTION:
    'Supabase dashboard, Project Settings, Database, Connection string, "Transaction pooler" (port 6543). Used by web requests.',
  SUPABASE_SERVICE_ROLE_KEY:
    'Supabase dashboard, Project Settings, API Keys, service_role. Server only - it bypasses RLS.',
  NEXT_PUBLIC_SUPABASE_URL:
    'Supabase dashboard, Project Settings, API, Project URL. Safe to expose.',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    'Supabase dashboard, Project Settings, API Keys, anon/publishable. Safe to expose.',
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * One problem per variable, with its provenance, under a banner.
 *
 * Zod's own message is accurate and unhelpful at four in the morning. What is
 * needed is the variable's name, whether it is absent or wrong, and where to
 * get it - so that is what this prints, for every problem at once rather than
 * the first.
 */
const format = (surface: string, issues: readonly z.core.$ZodIssue[]): string => {
  // One line per variable, not one per failed check. An empty
  // `DATABASE_URL_SESSION` fails the length check, the scheme check and the URL
  // check, and printing all three buries the one fact that matters: that
  // variable is not set. First issue wins.
  const first = new Map<string, z.core.$ZodIssue>()
  for (const issue of issues) {
    const name = issue.path.map(String).join('.')
    if (!first.has(name)) first.set(name, issue)
  }
  const lines = [...first].map(([name, issue]) => {
    const absent = issue.code === 'invalid_type' && issue.input === undefined
    const what = absent ? 'missing' : `invalid - ${issue.message}`
    const where = PROVENANCE[name] ?? 'see .env.example'
    return `  ${name}\n      ${what}\n      ${where}`
  })
  return [
    '',
    `Folio: the ${surface} environment is not usable.`,
    '',
    `${lines.length} problem${lines.length === 1 ? '' : 's'}:`,
    '',
    ...lines,
    '',
    'Copy .env.example to .env and fill it in. Nothing outside',
    'packages/db/src/env.ts reads process.env, so this is the only',
    'place that can tell you what is wrong.',
    '',
  ].join('\n')
}

const parseOrThrow = <T>(schema: z.ZodType<T>, raw: unknown, surface: string): T => {
  const result = schema.safeParse(raw)
  if (!result.success) throw new Error(format(surface, result.error.issues))
  return result.data
}

// ---------------------------------------------------------------------------
// The exports
// ---------------------------------------------------------------------------

refuseBrowser()
loadDotEnvIfPresent()

/**
 * Server-only. Never import this from a Client Component.
 *
 * Each value is read by its literal name rather than by spreading
 * `process.env`. That is not style - Next.js only inlines a variable it can see
 * written out, and a spread also drags every unrelated variable on the machine
 * into a validated object, which is how a secret ends up somewhere it was never
 * declared.
 */
export const serverEnv: ServerEnv = parseOrThrow(
  ServerEnvSchema,
  {
    DATABASE_URL_SESSION: process.env.DATABASE_URL_SESSION,
    DATABASE_URL_TRANSACTION: process.env.DATABASE_URL_TRANSACTION,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  'server',
)

/**
 * Safe to expose. These two values are compiled into client JavaScript.
 *
 * **Caveat, flagged rather than solved:** when `apps/web` starts importing
 * this, Next.js has to be able to see the literal `process.env.NEXT_PUBLIC_*`
 * reads above in order to inline them, which for a workspace package means
 * adding `@folio/db` to `transpilePackages` in `next.config.ts`. If that turns
 * out to be awkward, the right move is to move this one object to
 * `apps/web/lib/env.ts` - which the brief for this phase explicitly allows -
 * and leave the secrets here. Nothing in this phase imports it, so nothing
 * currently depends on the answer.
 */
export const publicEnv: PublicEnv = parseOrThrow(
  PublicEnvSchema,
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  'public',
)
