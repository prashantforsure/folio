# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there — do not read them ahead of time. Route history
lives in `docs/build-decisions.md`, one section per phase — read the phase for the route you touch.
That file was restarted on 2026-09-16 with the v2 redesign; the phases before it are in git
history (`git show 7a541bd:docs/build-decisions.md`) and are not the reference for a rebuilt route.

**The app is mid-redesign, and the design package is gone.** The v2 design package
(`docs/ui design/`, a README and nine `Route - * v2.dc.html` mockups) was the spec the shell and
the routes were rebuilt to; **the client deleted it on 2026-09-20, on purpose - do not read it, not
from git history either.** Its tokens live on in `packages/ui/src/tokens/palette.css`; its
language and patterns (plain lower-case-leaning copy, live counts, both states, both themes) still
bind. Done on the shell: the shell itself (rail, writing sidebar and header, assistant panel),
**Script**, **Outline**, **Storyboard**, **Production**, **Characters**, **Locations**, **Research**
(the last built from nothing: no body, table or contract existed before its pass), **Scenes**
(2026-09-17, ruled off its mockup onto the Storyboard's canvas, with a reading modal) and
**Timeline** (2026-09-18, all five phases — every route is on the shell now). Route by route the
spec is now the written record: Characters (rebuilt 2026-09-17/18 to a plan, **then a fourth pass on
2026-09-20 to laper.ai's route shape** - "Characters, fourth pass" in `docs/build-decisions.md` is
the spec), Locations and Timeline (both 2026-09-18, "Locations rebuild" and "Timeline rebuild"), and
**Production (2026-09-19)**, whose v2 body still runs but is superseded by the feature set in
`docs/production/` (a PRD, a design spec for Claude Design mockups, the data model, the generation
pipeline, six phases built one session each, a decisions log). Its `README.md` is the entry point;
nothing in that set is built yet.

**The script is a typed node list and the only hand-authored artefact.** Scenes, characters,
locations, page counts and shot lists are derived views. Nearly every real bug here is some other
surface quietly becoming authoritative.

## AGENTS.md is the contract — read the section for your task, not all of it

Always read **Open decisions** (under "When to ask first") and **Constraints**. Then only what
your change touches. `grep -n '^##' AGENTS.md` gives the line numbers.

| Your change touches | AGENTS.md section |
| --- | --- |
| the node model, an operation, Fountain or FDX | Domain rules → The node model; Exception tables |
| derive, characters, locations, aliases | Domain rules → Derivation; Entity identity |
| pages, the sheet, revisions | Domain rules → Pagination and the sheet |
| a route, a URL, anything visual | Domain rules → Routing; UI fidelity |
| the agent, jobs, credits | Domain rules → The AI agent; Jobs, credits and cost |
| a table or a query | Domain rules → Tenancy and data access |
| any new import | Tech stack → Adding a dependency |
| naming, layout, commits, reporting | Conventions; Feature workflow; Validation |

## Load on demand — these are large

| Before you… | Read |
| --- | --- |
| build a route or touch UI | that route's section in [docs/build-decisions.md](docs/build-decisions.md) — the design package is deleted (2026-09-20); `packages/ui/src/tokens/` and the built routes are the pattern |
| change a built route | its phase in [docs/build-decisions.md](docs/build-decisions.md) — `grep -n '^## ' docs/build-decisions.md` |
| touch the Production route, its worker, or any `✦` generation | [docs/production/README.md](docs/production/README.md) first — the feature is built in phases across sessions; that index says which of its seven files to read for the phase. The old `Route - Production v2.dc.html` is retired by `docs/production/02-design-spec.md` |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — preamble first; both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| answer something the spec leaves open | [docs/build-decisions.md](docs/build-decisions.md) — "Open, and blocking" is the live list |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |
| read or add an environment variable | [.env.example](.env.example) — every variable, its reader and where it comes from; the `R2_*` block and `ANTHROPIC_API_KEY` are optional, session vs transaction pooler is not a choice. A new variable lands in `packages/db/src/env.ts` and there in the same change |

## Repository map

- `packages/script` — the pure core, done, no dependencies: node model, operations, Fountain both
  ways, FDX import/export, derivation, pagination, the draft diff, and one read module per
  derived route (`beats.ts`, `shots.ts`, `timeline.ts`, `rename.ts`).
- `packages/contracts` — Zod boundary schemas. `packages/db` — Drizzle schema, forward-only
  migrations `0000`–`0024` (which are applied to the dev Supabase project is tracked in
  `packages/db/CLAUDE.md`), project-scoped repositories.
  `packages/ui` — tokens as CSS custom properties, the inline SVG icon set (`icons.tsx`), and a
  few small components (`src/index.ts` is the list).
- `apps/web` — auth, the home shell, the workspace chrome, and the built route bodies: Script,
  Outline, Storyboard, Scenes, Characters, Locations, Timeline, Research, Production — all nine
  (AGENTS.md, Architecture). Each has an `app/(app)/app/project/[projectId]/_<route>/`
  directory and a `lib/<route>/` with its actions. `lib/workspace/routes.ts` is the route tree
  (`lib/routes.ts` is something else: the one `as Route` assertion for auth's `next` redirects);
  `_chrome/project-shell.tsx` is the shell. The `/settings` stub has no route body. Production
  (v2, 2026-09-16) is the first route outside the writing surface on the shell:
  `_chrome/production-layout.tsx` renders the same `Sidebar` (with the route's `slots`) and
  `WritingHeader` (with `route="production"`, for the third crumb) and the shared `_chrome/status-bar.tsx`.
  **The header's centre is the route's views** (2026-09-17): `lib/workspace/views.ts` tables every
  route's `?view=` tabs, `_chrome/header-views.tsx` lights one from the URL, `_chrome/view-pill.tsx`
  draws them (icon beside name, one shape); the writing sidebar is Script · Storyboard · Outline ·
  Scenes and the Write / Storyboard pill is gone. Three routes' views are client state, not `?view=`
  (Characters 2026-09-16, Storyboard and Scenes 2026-09-17 - all client rulings): `_characters/view-state.tsx`,
  `_storyboard/view-state.tsx` and `_scenes/view-state.tsx`, tabs as buttons in the same slot, the URL unchanged. The assistant (`lib/assistant/`,
  `app/api/assistant/route.ts`) and share links (`lib/share/`, `app/share/[token]/`) are cross-route
  features built with the redesign.
- `apps/worker` — empty today; Production phase 1 (`docs/production/05-phases.md`) builds it as the
  BullMQ consumer AGENTS.md names, behind an all-or-none `REDIS_URL` + `FAL_KEY` env block. Do not
  create `apps/sync/`.

Facts too narrow for AGENTS.md's contract but easy to get wrong (full history in
`docs/build-decisions.md`):

- **Dependencies approved in `apps/web`:** `@tiptap/{core,pm,react,suggestion}`,
  `@floating-ui/dom`, `@anthropic-ai/sdk`, `fast-xml-parser` (FDX, `lib/script/fdx-adapter.ts`)
  and `aws4fetch` (R2), version-pinned — no other `@tiptap/*` extension and no drop-cursor
  without asking (AGENTS.md, Adding a dependency). Boundary files are `lib/script/pm-model.ts` and `lib/outline/pm-model.ts`;
  the document lives in the editor, never in React state. See AGENTS.md, The node model, for the
  slash-menu / no-type-bar rule both editors follow.
- **Characters is a canvas (2026-09-20, the fourth pass, laper.ai's shape by the client's ruling);
  Locations reads the script back as evidence.** `/characters` is `Canvas · Relationships · List`
  (client state), no sidebar: a 306px card per record on the Storyboard's canvas
  (`_characters/canvas/`, positions in `characters.canvas_x/_y`, migration `0024`), authored
  relationships as threads between cards and as a deterministic force / dialogue / chord graph
  (`_characters/graph/`, `lib/characters/graph.ts` - no animated simulation), a sortable List with
  a Display menu and CSV. `character_relationships` was reshaped in `0024` to one row per pair with
  two directional labels, written by the connect-drag, the pills and the drawer's
  `＋ Add relationship` (`lib/characters/relationships.ts` sorts the pair). The identity layer
  (alias table, rows-based queue, record-level rename with preview + undo, merge, `Off the page`
  kept) is unchanged and lives in the `Needs a decision` panel behind the toolbar pill
  (`_characters/queue-panel.tsx`). The drawer is a form (`Basic info · Bio · Appearance notes ·
  Portrait · Relationships`); `✦ Generate` on a card is drawn disabled (the look-sheet job is
  Production's, not built). `character_findings` (`0022`) is orphaned - the two drawer model
  actions went with the pass. `packages/script` reads `derive.ts`, `introductions.ts`, `sides.ts`
  as before. Locations: what the script says about a set is computed at request time by
  `packages/script/src/sets.ts` and never stored; the drawer is `/locations/:uuid`; the views
  (`Places · Scenes here · Sheet`) are client state. Portraits and photos are on R2
  (`lib/storage/r2.ts`, gated on the `R2_*` block). The rest is in "Characters, fourth pass",
  "Characters rebuild" and "Locations rebuild" in `docs/build-decisions.md`.
- **The Timeline was rebuilt in five phases (2026-09-18) to a written plan.** Three authored
  things (`story_threads`; `scenes.story_day/story_clock/flashback/threads`, migration `0011`;
  `timeline_findings`, the writer's `It's deliberate` on a finding, `0023`) and three pure
  modules in `packages/script` - `timeline.ts` (the order), `continuity.ts` (eight rules, named
  thresholds) and `time-cues.ts` (what a heading's `CONTINUOUS` / `LATER` and a line like "the
  next morning" say, and the placements they propose). Nothing reads a slugline as a date: the
  queue *proposes* a day with its reason and citation, the writer accepts or skips, and the
  bulk accept is undoable. `Story order · Chronology · Continuity` are client state
  (`_timeline/view-state.tsx`; `/timeline/:sceneId` waits on open decision 10), the workspace
  runs the core over the rows and patches writes optimistically, the lanes grid drags and takes
  keys, and the assistant reads story time on the route (`timeline: true`). `✦ Suggest
  placements` is not built (open decision 13). "Timeline rebuild, phases 2-5" and "phase 1" in
  `docs/build-decisions.md`.
- **`beats`, `revisions` and `comment_threads` are tables with no route above them** (AGENTS.md,
  Constraints — all three routes were built, then cut). `beats` was dropped in migration `0010`;
  `revisions` and `comment_threads` stay: the Script route draws threads inline under their
  blocks (`_script/comments/`) and the revision list in its title menu.
- **The Script body is Geist on the canvas, not a Courier sheet** (ruled 2026-09-16). The engine
  still paginates in Courier; `lib/script/pages.ts` turns the record into `Page N` dividers and
  the E2E golden diff still reads `[data-page-map]`. The Outline still draws its old prose sheet
  until its pass.
- **Production is a pipeline of jobs, and consistency is reference discipline.** A scene's derived
  shots (the Storyboard's rows) group into reels of a fixed length; each reel walks Scene still →
  Performance (derived, read-only) → Shots → Frames (takes) → Clip (versions), every generation a
  `jobs` row with its cost named before it is spent, conditioned on the same kept character Look,
  location plate and Art Style prefix, and marked stale by `source_hash` when the page or a
  reference changes. Tiers (`Draft · Standard · Cinema`), never model names, in UI or schema — the
  registry is the one place a model is named. The whole of it: `docs/production/`.
- **The assistant needs `ANTHROPIC_API_KEY`** (optional, like the `R2_*` block): unset, the panel
  draws its composer disabled and says so. Model id is `lib/assistant/model.ts`, not env.
  Bible was a fourth cut route, but unlike these its five tables had no other reader once the
  rail badge query stopped calling into them — `0015` drops them outright rather than orphaning
  them ("Bible route removed" in `docs/build-decisions.md`).

**Nothing needs a live database** to typecheck, lint, build or unit-test. The signed-in E2E
walks (`apps/web/e2e/*-route.spec.ts`) need `E2E_EMAIL`/`E2E_PASSWORD` and skip without them;
`E2E_PORT` points them at a running dev server (default 3210).

## Commands

```bash
pnpm typecheck   # 6 packages — also a test suite: @ts-expect-error guarantees live in it
pnpm lint        # eslint.config.mjs is AGENTS.md made executable; each ban error carries its reason
pnpm test        # only @folio/script and web have test scripts
pnpm build       # only web; ends with scripts/assert-no-server-secrets.mjs, which fails the build if a server secret is in a client chunk
pnpm test:e2e    # Playwright, web only — see the E2E_* note above

pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
pnpm --filter web exec vitest run tests/production-status.test.ts   # one web test (needs Node >=22.12)
```

Package-specific commands are in that package's `CLAUDE.md`.

Traps that produce a false reading:

1. **`>>> FULL TURBO` means nothing ran** — the counts are a recording. Force before reporting a
   suite as passing: `pnpm exec turbo run test --force`.
2. **Root `pnpm test` can abort before `@folio/script` runs** — `web`'s tests fail on local Node
   22.5.1 (`ERR_REQUIRE_ESM`; `engines` wants `>=22.12.0`). Run the package directly.
3. **AGENTS.md's `test -- --coverage` does nothing** — the `--` turns both into filename filters.
   Use `pnpm --filter @folio/script test --coverage`.
4. **Windows: vitest prints an `EPERM` forks-worker stack after a passing run.** Read the counts.
5. **Git Bash mangles `//#lint:root` into a path.** `pnpm lint` is fine; prefix
   `MSYS_NO_PATHCONV=1` when using `turbo run` for that task.

## Rules the config enforces

- `tsconfig.base.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — the
  `undefined` guard after an index lookup is required, not redundant.
- `process.env` is a lint error outside `packages/db/src/env.ts`, `apps/web/lib/env/public.ts`,
  `apps/web/scripts/` and test-runner configs. The split is a security boundary.
- Flat eslint config is last-match-wins; block order is load-bearing. Some exemptions are
  pre-declared for directories that do not exist yet.

## Working here

- **Escalate the open decisions in AGENTS.md; do not resolve them.** They're one table there
  (fourteen rows, four struck through as ruled or moot; row 14 points at the Production feature set's own list) — read it before touching any of them.
- **Any dependency needs approval, every time.** `packages/script` has none — keep it that way.
- Report literally: paste failing output, name assumptions, flag any rule you were tempted to break.
