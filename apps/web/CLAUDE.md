@AGENTS.md

# apps/web

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before touching auth or reaching for a Supabase client, read
[lib/auth/NO-BROWSER-CLIENT.md](lib/auth/NO-BROWSER-CLIENT.md). Before putting anything in a
client store, read [lib/state/README.md](lib/state/README.md). Before building a route, read
[docs/ui design/CLAUDE.md](../../docs/ui%20design/CLAUDE.md), then that one route's bundle.

- **State:** Google OAuth **and** email + password (AGENTS.md Constraints was rewritten for this —
  `docs/build-decisions.md`), session in Server Components, route protection in two places. Two
  shells under one boundary: [app/(app)/layout.tsx](app/(app)/layout.tsx) is `requireUser()` and
  the frame; [app/(app)/app/(home)/layout.tsx](app/(app)/app/(home)/layout.tsx) draws the
  four-item sidebar for the six list routes (three views over one query in `_projects/`, plus
  `new`, `trash`, `settings`); [app/(app)/app/project/[projectId]/layout.tsx](app/(app)/app/project/[projectId]/layout.tsx)
  draws the 66px rail for the workspace. The fourteen workspace routes are empty shells.
- **The workspace, in one directory:** [lib/workspace/](lib/workspace/). `routes.ts` is the route
  tree and both orders (rail, episode nav); `params.ts` the sub-view params; `hrefs.ts` every
  workspace URL and the film/series shape; `context.ts` the membership gate and the `cache()`d
  loaders; `format.ts` the `104pp` / `—` / `empty` / `0` convention. The film shape is a
  second static tree under `project/[projectId]/(film)/` — Next has no optional segment — and
  each page canonicalises the URL for the project's type.
- **Every episode segment goes through `parseEpisodeSegment`** (`@folio/contracts`) in
  `[episodeId]/layout.tsx` before any lookup. Do not add a route that reads `params.episodeId`
  without it.
- **No Supabase SDK reaches the browser.** Every auth path is a server action.
- **Public env is [lib/env/public.ts](lib/env/public.ts)** — the two `NEXT_PUBLIC_SUPABASE_*`
  values only. Secrets are in `@folio/db/env`, which throws in a browser. `process.env` anywhere
  else is a lint error; `scripts/` and test-runner configs are the only exemptions.
- **The service-role key is kept out of the bundle by a check.**
  [scripts/assert-no-server-secrets.mjs](scripts/assert-no-server-secrets.mjs) runs after
  `next build`, scans `.next/static/**` and every served `.html`/`.rsc`, and fails on the
  variable's name, its value, or the env module's browser-refusal string — without printing the
  match. Verified by poisoning a client component.

## Commands

```bash
pnpm --filter web test                              # fails locally — see trap 1
pnpm --filter web check:secrets                     # bundle scan alone; needs a prior `next build`
pnpm test:e2e                                       # needs `pnpm --filter web exec playwright install chromium` once
E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e            # also runs the two signed-in walks against the .env project
E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e            # also runs the two signed-in walks against the .env project
pnpm --filter web exec playwright test -g "glyph"   # one e2e
```

Traps:

1. **`pnpm --filter web test` fails on a fresh run** — `ERR_REQUIRE_ESM` from jsdom. Local Node is
   22.5.1, below the `>=22.12.0` in `engines`; `.npmrc` sets `engine-strict=false`, CI reads
   `.nvmrc` and never hits it.
2. **A dev server reached over `127.0.0.1` renders but never hydrates.** Next 16 treats it as a
   cross-origin dev request unless it is in `allowedDevOrigins` and withholds assets. No error page:
   every Client Component is inert, every `useEffect` silently never runs.
   [playwright.config.ts](playwright.config.ts) uses `localhost` for this reason; `smoke.spec.ts`
   has one test that fails if hydration stops.
3. **`typecheck` runs `next typegen` first, and must.** `typedRoutes: true` types `href` and
   `redirect()` against a generated union that does not exist on a never-built checkout — `tsc`
   alone reports every route as invalid.
