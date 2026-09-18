# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there — do not read them ahead of time. Route history
lives in `docs/build-decisions.md`, one section per phase — read the phase for the route you touch.
That file was restarted on 2026-09-16 with the v2 redesign; the phases before it are in git
history (`git show 7a541bd:docs/build-decisions.md`) and are not the reference for a rebuilt route.

**The app is mid-redesign.** `docs/ui design/README.md` and the nine `Route - * v2.dc.html`
mockups are the spec; routes are rebuilt to them one at a time. Done: the shell (rail, writing
sidebar and header, assistant panel), **Script**, **Outline**,
**Storyboard**, **Production**, **Characters**, **Locations**, **Research** (the last built from
nothing: no body, table or contract existed before its pass) and **Scenes** (2026-09-17, ruled off
its mockup onto the Storyboard's canvas, with a reading modal). Timeline still draws its
pre-redesign chrome inside the new shell until its own pass.

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
  migrations `0000`–`0022` (which are applied to the dev Supabase project is tracked in
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
  `WritingHeader` (with `route="production"`, for the third crumb) and the shared `_chrome/status-bar.tsx`.
  **The header's centre is the route's views** (2026-09-17): `lib/workspace/views.ts` tables every
  route's `?view=` tabs, `_chrome/header-views.tsx` lights one from the URL, `_chrome/view-pill.tsx`
  draws them (icon beside name, one shape); the writing sidebar is Script · Storyboard · Outline ·
  Scenes and the Write / Storyboard pill is gone. Three routes' views are client state, not `?view=`
  (Characters 2026-09-16, Storyboard and Scenes 2026-09-17 - all client rulings): `_characters/view-state.tsx`,
  `_storyboard/view-state.tsx` and `_scenes/view-state.tsx`, tabs as buttons in the same slot, the URL unchanged. The assistant (`lib/assistant/`,
  `app/api/assistant/route.ts`) and share links (`lib/share/`, `app/share/[token]/`) are cross-route
  features built with the redesign.
- `apps/worker` — empty on purpose. Do not create `apps/sync/`.

Facts too narrow for AGENTS.md's contract but easy to get wrong (full history in
`docs/build-decisions.md`):

- **Dependencies approved in `apps/web`:** `@tiptap/{core,pm,react,suggestion}`,
  `@floating-ui/dom`, `@anthropic-ai/sdk`, `fast-xml-parser` (FDX, `lib/script/fdx-adapter.ts`)
  and `aws4fetch` (R2), version-pinned — no other `@tiptap/*` extension and no drop-cursor
  without asking (AGENTS.md, Adding a dependency). Boundary files are `lib/script/pm-model.ts` and `lib/outline/pm-model.ts`;
  the document lives in the editor, never in React state. See AGENTS.md, The node model, for the
  slash-menu / no-type-bar rule both editors follow.
- **The Characters route was rebuilt to a written plan, not a mockup** (ruled 2026-09-17;
  `Route - Characters v2.dc.html` is retired for this route - "Characters rebuild" in
  `docs/build-decisions.md`, four sections, one per phase, all built 2026-09-17/18). The route
  reads the script back as evidence about each person: views `Cast · Presence · Sheet` (client
  state, `_characters/view-state.tsx`; Presence is a character × scene grid that replaced the
  graph), content-first cards with a presence strip (`@folio/ui` `PresenceStrip`), the alias
  table (`_characters/alias-table.tsx`), the reasoned, undoable queue with pair rows for two
  records that read as one person, and a drawer ordered derived-first (stats, Voice, Introduced,
  Presence, Scenes, Sets, then a `Notes` fold, then Continuity). The pure core counts the voice
  (`packages/script` `derive.ts`: words, speeches, first / last / longest line, per-scene counts,
  exchanges; `introductions.ts`, `sides.ts`, `revertCueRewrites` for the rename's undo) on
  `character_derivations` since migration `0021`, which also added `characters.origin`. The
  assistant reads the whole project on `/characters` with a Focus block for the open record, and
  the drawer's `✦ Draft from the script` / `✦ Check for contradictions`
  (`lib/characters/model-actions.ts`) write only into an unsaved field or `character_findings`
  (`0022`) - open decision 13 stands. The Script editor's cues carry `data-character-id` with a
  hover card and a `Colour cues` toggle. `/characters/:uuid` is the edit drawer (a portal into
  the layout's slot). Migration `0013` dropped the first pass's profile; `0017` brought back
  `wants`, `needs` and `status`. Portraits are on Cloudflare R2 (`apps/web/lib/storage/r2.ts`,
  gated on the optional `R2_*` block). `character_relationships` is kept as a derivation read and
  nothing writes it. Generate (the look-sheet job) is not built. The rail's Characters icon is a
  plain link everywhere.
- **The Locations route was rebuilt to a written plan, not the mockup** (ruled 2026-09-18, the
  Characters precedent; `Route - Locations v2.dc.html` is retired for this route - "Locations
  rebuild" in `docs/build-decisions.md`). The views `Places · Scenes here · Sheet` are client state
  (`_locations/view-state.tsx`); `/locations/:uuid` is the drawer. What the script says about a
  set is read at request time, not stored: `packages/script/src/sets.ts` (the establishing line,
  the `INT/EXT × DAY/NIGHT` quadrant, similar-set pairs, set-text matching) over the node list
  and the scene index in `lib/locations/server.ts` - no migration. `scheduled_days` is authored in
  the drawer's Production fold and rolled up; the alias table is `_locations/slugline-table.tsx`;
  every scene ref is a link into the script; the assistant reads the location records on
  `/locations` (`places: true`, a location Focus). `PresenceStrip` in `@folio/ui` is shared with
  Characters. No scouting layer beyond status / address / days / one photo, by ruling.
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
