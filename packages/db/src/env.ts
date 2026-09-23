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
 *   - The two values that are *designed* to be public - the Supabase URL and
 *     the anon key - are **no longer here**. They moved to
 *     `apps/web/lib/env/public.ts`, which is what the caveat at the foot of
 *     this file used to propose. The reason is the tripwire below:
 *     `refuseBrowser()` throws at module scope, so any module in this file is
 *     unusable from a Client Component by design - and the browser is exactly
 *     where the anon key has to be. The split is now physical rather than
 *     conventional, which is stronger than what it replaced.
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

export type ServerEnv = z.infer<typeof ServerEnvSchema>

/**
 * Object storage - Cloudflare R2, over its S3 API. Server only.
 *
 * Optional as a block: with none of the five set the app boots as it did
 * before storage existed, and `storageEnv` is `null` - the Characters
 * route draws Upload disabled and says why. With any set, all five must
 * be, and each is checked, so a half-configured bucket is a boot failure
 * with a name rather than a 500 on the first upload.
 *
 * `R2_PUBLIC_URL` is the origin the bucket is served from (a custom domain
 * or the `r2.dev` one); the app composes `${R2_PUBLIC_URL}/${key}` at
 * read and never stores a URL.
 */
const StorageEnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  R2_PUBLIC_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
})

export type StorageEnv = z.infer<typeof StorageEnvSchema>

/**
 * The assistant - Anthropic's API. Server only.
 *
 * Optional the way storage is: unset, `assistantEnv` is `null` and the
 * assistant panel draws its composer disabled with a line saying the
 * assistant is not connected. Set, the key is checked for shape only. The
 * model id is not an environment variable: it is a decision, written once in
 * `apps/web/lib/assistant/model.ts`, and an env var would make it a setting.
 */
const AssistantEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20, 'looks too short to be an Anthropic key'),
})

export type AssistantEnv = z.infer<typeof AssistantEnvSchema>

/**
 * The Production route's models - Google's Gemini API, by the client's
 * ruling (2026-09-22). Server only, optional the way the assistant is:
 * unset, `modelEnv` is `null` and every generate button is drawn
 * disabled with a line saying the model is not connected. The model ids
 * are not environment variables either: they are the registry in
 * `@folio/contracts` (`MODEL_REGISTRY`), the only place a model is named.
 */
const ModelEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(20, 'looks too short to be a Gemini API key'),
})

export type ModelEnv = z.infer<typeof ModelEnvSchema>

/**
 * The worker's own settings (`apps/worker`, roadmap task 4.1). Both have a
 * default, so the web app - which never sets them - parses the same file
 * without noticing. The worker reads the database through `serverEnv` like
 * everything else; it needs `DATABASE_URL_SESSION` above all, for its claims
 * and its `LISTEN`.
 */
const WorkerEnvSchema = z.object({
  /** How many jobs one worker process runs at once. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  /** The port `GET /health` answers on. */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
})

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>

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
  R2_ACCOUNT_ID: 'Cloudflare dashboard, R2, the account id on the overview page. Set all five R2_* or none.',
  R2_ACCESS_KEY_ID: 'Cloudflare dashboard, R2, Manage R2 API Tokens, an Object Read & Write token for the bucket.',
  R2_SECRET_ACCESS_KEY: 'The same token. Shown once at creation. Server only.',
  R2_BUCKET: 'The bucket name, as created in the Cloudflare dashboard.',
  R2_PUBLIC_URL: 'The origin the bucket is served from - its custom domain, or the r2.dev public URL - with no trailing slash.',
  ANTHROPIC_API_KEY: 'Anthropic Console, API keys. Server only. Unset, the assistant panel is drawn disconnected.',
  GEMINI_API_KEY: 'Google AI Studio, Get API key. Server only. Unset, Production draws its generate buttons disconnected.',
  WORKER_CONCURRENCY: 'Optional, the worker only: how many jobs one process runs at once, 1-32. Default 4. See docs/agents/worker.md.',
  WORKER_HEALTH_PORT: 'Optional, the worker only: the port GET /health answers on. Default 8080.',
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

const STORAGE_NAMES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const

const rawStorage = {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
}

/**
 * Server-only. `null` when no `R2_*` variable is set at all - storage is
 * not configured, and every reader treats that as "no portraits yet".
 * Throws, with the same report as `serverEnv`, when some are set and some
 * are not.
 */
export const storageEnv: StorageEnv | null = STORAGE_NAMES.every(
  (name) => rawStorage[name] === undefined || rawStorage[name] === '',
)
  ? null
  : parseOrThrow(StorageEnvSchema, rawStorage, 'storage')

/**
 * Server-only. `null` when `ANTHROPIC_API_KEY` is unset - the assistant is
 * not connected, and every reader treats that as a disabled composer, never
 * as a broken one.
 */
export const assistantEnv: AssistantEnv | null =
  process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY === ''
    ? null
    : parseOrThrow(AssistantEnvSchema, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }, 'assistant')

/**
 * Server-only. `null` when `GEMINI_API_KEY` is unset - Production's
 * generations are not connected, and every reader treats that as a
 * disabled button, never as a broken one.
 */
export const modelEnv: ModelEnv | null =
  process.env.GEMINI_API_KEY === undefined || process.env.GEMINI_API_KEY === ''
    ? null
    : parseOrThrow(ModelEnvSchema, { GEMINI_API_KEY: process.env.GEMINI_API_KEY }, 'model')

/** An unset or empty variable, as the default rather than as `0`. */
const orDefault = (value: string | undefined): string | undefined => (value === '' ? undefined : value)

/** Server-only. The worker's settings, each with its default when unset. */
export const workerEnv: WorkerEnv = parseOrThrow(
  WorkerEnvSchema,
  {
    WORKER_CONCURRENCY: orDefault(process.env.WORKER_CONCURRENCY),
    WORKER_HEALTH_PORT: orDefault(process.env.WORKER_HEALTH_PORT),
  },
  'worker',
)
