@AGENTS.md

# apps/web

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before touching auth or reaching for a Supabase client, read
[lib/auth/NO-BROWSER-CLIENT.md](lib/auth/NO-BROWSER-CLIENT.md). Before putting anything in a
client store, read [lib/state/README.md](lib/state/README.md). Before building a route, read
[docs/ui design/README.md](../../docs/ui%20design/README.md), then that route's
`Route - <name> v2.dc.html`.

- **State:** Google OAuth **and** email + password (AGENTS.md Constraints was rewritten for this —
  `docs/build-decisions.md`), session in Server Components, route protection in two places. Two
  shells under one boundary: [app/(app)/layout.tsx](app/(app)/layout.tsx) is `requireUser()` and
  the frame; [app/(app)/app/(home)/layout.tsx](app/(app)/app/(home)/layout.tsx) draws the
  four-item sidebar for the six list routes (three views over one query in `_projects/`, plus
  `new`, `trash`, `settings`); [app/(app)/app/project/[projectId]/layout.tsx](app/(app)/app/project/[projectId]/layout.tsx)
  draws the workspace shell through `_chrome/project-shell.tsx` (56px rail, the assistant panel,
  the Characters overlay), and `_chrome/writing-layout.tsx` the 236px sidebar, 60px header and
  main-surface card for the four writing routes. Seven of the nine workspace routes have bodies
  (root `CLAUDE.md`, Repository map).
- **The shell owns `html[data-nav-open]`.** Route bodies read `useSession().navOpen` for their own
  geometry and never write the attribute; `useViewport()` (`lib/state/viewport.ts`) is the one
  resize listener. Below 1200px an open assistant panel forces the sidebar closed there.
- **The workspace, in one directory:** [lib/workspace/](lib/workspace/). `routes.ts` is the route
  tree and both orders (rail, episode nav); `params.ts` the sub-view params; `hrefs.ts` every
  workspace URL and the film/series shape; `context.ts` the membership gate and the `cache()`d
  loaders; `format.ts` the `104pp` / `—` / `empty` / `0` convention. The film shape is a
  second static tree under `project/[projectId]/(film)/` — Next has no optional segment — and
  each page canonicalises the URL for the project's type.
- **The Script route since the redesign:** `_script/script-workspace.tsx` is the body inside the
  surface card - toolbar (title menu, `⋯` actions menu), banners, the scrolling column. Threads
  are widget hosts in the editor DOM that React portals cards into (`_script/comments/`); the
  `+` handle's menu inserts blocks or opens a thread composer; the `⠿` handle node-selects and
  ProseMirror's own drag moves the block (`clipboard.ts` keeps its id on a move). Page breaks
  are widget dividers from `lib/script/pages.ts`.
- **The Outline route since the redesign:** `_outline/outline-workspace.tsx` is the same shape -
  toolbar (`Outline · Draft N` menu over the snapshots, `⋯` with snapshot, Markdown export, undo,
  statistics), banners, the column - with no sheet, panel or status bar. The sidebar's second
  group is the route's (`_chrome/sidebar-group.tsx`): `In this outline` reads the cell the
  workspace publishes to (`lib/outline/toc.ts`), seeded by a `cache()`d document read the page
  shares (`lib/outline/server.ts`). Handles, threads and the `@` combobox are the Script's pieces
  (`_script/editor/extensions/handles.ts`, `_script/comments/`, `mention-suggestion.ts`).
- **The Script autosave is a delta and every write it runs is one statement.** Over the
  transaction pooler a parameterised statement costs two round trips and cannot be pipelined
  (`packages/db/src/client.ts`), so on the request path the cost is statement count, not row
  count. Add to an existing statement or defer with `deferAfterSave`; never add a sequential
  query to a save.
- **Both editors are Tiptap and the document is not React state.** `_script/editor/` and
  `_outline/editor/` hold the extensions; `lib/script/pm-model.ts` and `lib/outline/pm-model.ts` are
  the one boundary each to its node list; the chrome reads store slices (`editor-store.ts`,
  `outline-store.ts`), never the editor value. The Outline reuses the Script's framework pieces -
  the `@mention` atom and its combobox, the identity plugin, the handles, the floating layer, the
  slice cell, the thread cards - and shares no block node with it. Details: `docs/build-decisions.md`,
  "Redesign phase 1" and "Redesign phase 2".
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
E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e            # also runs the signed-in walks (e2e/*-route.spec.ts) against the .env project
E2E_PORT=3000 …                                     # point the walks at a running dev server
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
3. **The Script walk imports the golden corpus and diffs the rendered page map against it** —
   a pagination change that moves pages fails there, not only in `@folio/script`.
4. **`typecheck` runs `next typegen` first, and must.** `typedRoutes: true` types `href` and
   `redirect()` against a generated union that does not exist on a never-built checkout — `tsc`
   alone reports every route as invalid.
