import { z } from 'zod'

/**
 * The public half of the environment. Browser-safe, and the only environment
 * `apps/web` reads.
 *
 * ## Why this is not in `packages/db/src/env.ts`
 *
 * It was, and that file's own header says to move it:
 *
 * > **Caveat, flagged rather than solved:** when `apps/web` starts importing
 * > this, Next.js has to be able to see the literal `process.env.NEXT_PUBLIC_*`
 * > reads above in order to inline them [...] If that turns out to be awkward,
 * > the right move is to move this one object to `apps/web/lib/env.ts` [...]
 * > and leave the secrets here.
 *
 * It is awkward, and for a second reason that file could not have known: it
 * calls `refuseBrowser()` at module scope, which **throws** the moment anything
 * in it is imported into a Client Component. That tripwire is correct and must
 * stay - it guards the service-role key - but it makes the module unusable from
 * the browser by design, and the browser is exactly where the anon key has to
 * be. So the split is now physical: secrets in `@folio/db/env`, which throws in
 * a browser; public values here, which do not exist there.
 *
 * `packages/db` remains the only place a *secret* is read. AGENTS.md's rule is
 * about secrets ending up somewhere nobody declared them, and these two values
 * are declared public in `.env.example` under a banner that says so.
 *
 * ## Why the reads are written out literally, and why parsing is lazy
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_X` by **textual substitution at build
 * time**. It cannot inline a spread, a computed key or a dynamic lookup - those
 * become `undefined` in the browser with no error. So the two reads are written
 * out, exactly as they are in `packages/db/src/env.ts`, for the same reason.
 *
 * The parse is inside a function rather than at module scope so that
 * `next build` succeeds on a machine with no Supabase project. Nothing about
 * building the app needs these values; only serving a request does. Parsing at
 * import would make an unconfigured checkout unable to typecheck its own build
 * output, which is the failure `packages/db` went to some trouble to avoid.
 * Laziness costs nothing here: the inlining has already happened by the time
 * this runs.
 */

const SupabaseKeySchema = z.string().min(20, 'looks too short to be a Supabase key')

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SupabaseKeySchema,
})

export type PublicEnv = z.infer<typeof PublicEnvSchema>

const PROVENANCE: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL:
    'Supabase dashboard, Project Settings, API, Project URL. Safe to expose.',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    'Supabase dashboard, Project Settings, API Keys, anon/publishable. Safe to expose.',
}

let cached: PublicEnv | null = null

export const publicEnv = (): PublicEnv => {
  if (cached !== null) return cached

  const result = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })

  if (!result.success) {
    const seen = new Set<string>()
    const lines: string[] = []
    for (const issue of result.error.issues) {
      const name = issue.path.map(String).join('.')
      if (seen.has(name)) continue
      seen.add(name)
      const absent = issue.code === 'invalid_type' && issue.input === undefined
      lines.push(
        `  ${name}\n      ${absent ? 'missing' : `invalid - ${issue.message}`}\n      ${PROVENANCE[name] ?? 'see .env.example'}`,
      )
    }
    throw new Error(
      [
        '',
        'Folio: the public environment is not usable, so auth cannot start.',
        '',
        ...lines,
        '',
        'Copy .env.example to .env and fill it in. These two values are safe to',
        'expose and are compiled into client JavaScript; the service-role key is',
        'not, and lives behind @folio/db/env.',
        '',
      ].join('\n'),
    )
  }

  cached = result.data
  return cached
}
