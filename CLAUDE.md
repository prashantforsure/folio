# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there — do not read them ahead of time. Route history
lives in `docs/build-decisions.md`, one section per phase — read the phase for the route you touch.
That file was restarted on 2026-09-16 with the v2 redesign; the phases before it are in git
history (`git show 7a541bd:docs/build-decisions.md`) and are not the reference for a rebuilt route.

**The app is mid-redesign.** `docs/ui design/README.md` and the nine `Route - * v2.dc.html`
mockups are the spec; routes are rebuilt to them one at a time. Done: the shell (rail, writing
sidebar and header, assistant panel, Characters overlay), **Script**, **Outline**,
**Storyboard**, **Production**, **Characters** and **Research** (the first built from nothing: no body,
table or contract existed before its pass). The other route bodies still draw their pre-redesign
chrome inside the new shell until their own pass.

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
| build a route or touch UI | [docs/ui design/README.md](docs/ui%20design/README.md), then that route's `Route - <name> v2.dc.html` |
| change a built route | its phase in [docs/build-decisions.md](docs/build-decisions.md) — `grep -n '^## ' docs/build-decisions.md` |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — preamble first; both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| answer something the spec leaves open | [docs/build-decisions.md](docs/build-decisions.md) — "Open, and blocking" is the live list |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |

## Repository map

- `packages/script` — the pure core, done, no dependencies: node model, operations, Fountain both
  ways, FDX import/export, derivation, pagination, the draft diff, and one read module per
  derived route (`beats.ts`, `shots.ts`, `timeline.ts`, `rename.ts`).
- `packages/contracts` — Zod boundary schemas. `packages/db` — Drizzle schema, forward-only
  migrations `0000`–`0019` (which are applied to the dev Supabase project is tracked in
  `packages/db/CLAUDE.md`), project-scoped repositories.
  `packages/ui` — tokens as CSS custom properties, the inline SVG icon set (`icons.tsx`), and a
  few small components (`src/index.ts` is the list).
- `apps/web` — auth, the home shell, the workspace chrome, and the built route bodies: Script,
  Outline, Storyboard, Scenes, Characters, Locations, Timeline, Research, Production — all nine
  (AGENTS.md, Architecture). Each has an `app/(app)/app/project/[projectId]/_<route>/`
  directory and a `lib/<route>/` with its actions. `lib/workspace/routes.ts` is the route tree;
  `_chrome/project-shell.tsx` is the shell. The `/settings` stub has no route body. Production
  (v2, 2026-09-16) is the first route outside the writing surface on the shell:
  `_chrome/production-layout.tsx` renders the same `Sidebar` (with the route's `slots`) and
  `WritingHeader` (with `route="production"`, so no mode pill) and the shared `_chrome/status-bar.tsx`
  and `_chrome/view-pill.tsx`. The assistant (`lib/assistant/`, `app/api/assistant/route.ts`) and share
  links (`lib/share/`, `app/share/[token]/`) are cross-route features built with the redesign.
- `apps/worker` — empty on purpose. Do not create `apps/sync/`.

Facts too narrow for AGENTS.md's contract but easy to get wrong (full history in
`docs/build-decisions.md`):

- **Dependencies approved in `apps/web`:** `@tiptap/{core,pm,react,suggestion}`,
  `@floating-ui/dom`, `@anthropic-ai/sdk`, `fast-xml-parser` (FDX, `lib/script/fdx-adapter.ts`)
  and `aws4fetch` (R2), version-pinned — no other `@tiptap/*` extension and no drop-cursor
  without asking (AGENTS.md, Adding a dependency). Boundary files are `lib/script/pm-model.ts` and `lib/outline/pm-model.ts`;
  the document lives in the editor, never in React state. See AGENTS.md, The node model, for the
  slash-menu / no-type-bar rule both editors follow.
- **The Characters route is `Route - Characters v2.dc.html`** ("Redesign phase 4" in
  `docs/build-decisions.md`); the laper.ai second pass and the older bundle are history.
  `?view=cast | relationships | sheet`; `/characters/:uuid` is the edit drawer (a portal into
  the layout's slot beside the column); the sidebar card is the cast list (groups computed in
  `lib/characters/cast.ts`, `Defined N / M` widget); unmatched cues are the banner's queue and
  a `--warn` conflict block on the card their proposal names. Migration `0013` dropped the
  first pass's drives, arc turns, voice rules and key lines; `0017` brings back only `wants`,
  `needs` and a writer-set `status` (`draft | defined | locked`). Portraits are on Cloudflare
  R2 through `apps/web/lib/storage/r2.ts` (`aws4fetch`), gated on the optional `R2_*` env
  block; the card's `Drop a reference` is a real drop. `character_relationships` is kept as a
  derivation read and nothing writes it. Gender, the colour picker, appearance, the alias
  table and merge have actions and no surface since the v2 pass. Generate (the look-sheet job)
  is not built.
- **`beats`, `revisions` and `comment_threads` are tables with no route above them** (AGENTS.md,
  Constraints — all three routes were built, then cut). `beats` was dropped in migration `0010`;
  `revisions` and `comment_threads` stay: the Script route draws threads inline under their
  blocks (`_script/comments/`) and the revision list in its title menu.
- **The Script body is Geist on the canvas, not a Courier sheet** (ruled 2026-09-16). The engine
  still paginates in Courier; `lib/script/pages.ts` turns the record into `Page N` dividers and
  the E2E golden diff still reads `[data-page-map]`. The Outline still draws its old prose sheet
  until its pass.
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
pnpm build       # only web
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
  now (twelve rows) — read it before touching any of them.
- **Any dependency needs approval, every time.** `packages/script` has none — keep it that way.
- Report literally: paste failing output, name assumptions, flag any rule you were tempted to break.
