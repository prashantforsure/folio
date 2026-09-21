# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there. Route history is `docs/build-decisions.md`,
one section per pass, newest first (`grep -n '^## ' docs/build-decisions.md`); it restarted on
2026-09-16 with the v2 redesign, so older phases in git history are not the reference.

**The script is a typed node list and the only hand-authored artefact.** Scenes, characters,
locations, page counts and shot lists are derived views. Nearly every real bug here is some other
surface quietly becoming authoritative.

**The design package is gone.** The v2 mockups (`docs/ui design/`) were the spec; the client
deleted them on 2026-09-20 on purpose — do not read them, not from git history either. Their
tokens live in `packages/ui/src/tokens/palette.css`; their language (plain lower-case-leaning
copy, live counts, both states, both themes) still binds. Each route's build-decisions section is
now its spec.

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

## Load on demand

| Before you… | Read |
| --- | --- |
| build or change a route, or touch UI | its section in [docs/build-decisions.md](docs/build-decisions.md); `packages/ui/src/tokens/` and the built routes are the pattern |
| answer something the spec leaves open | "Open, and blocking" at the top of `docs/build-decisions.md` — the live list |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |
| read or add an environment variable | [.env.example](.env.example) — every variable and its reader; a new one lands in `packages/db/src/env.ts` and there in the same change |

## Repository map

- `packages/script` — the pure core, **no dependencies, keep it that way**: node model,
  operations, Fountain and FDX both ways, derivation, pagination, the draft diff, and one read
  module per derived route (`beats.ts`, `shots.ts`, `timeline.ts`, `continuity.ts`,
  `time-cues.ts`, `sets.ts`, `rename.ts`).
- `packages/contracts` — Zod boundary schemas. `packages/db` — Drizzle schema, forward-only
  migrations `0000`–`0024` (which are applied to dev is tracked in its `CLAUDE.md`),
  project-scoped repositories. `packages/ui` — tokens as CSS custom properties, the inline SVG
  icon set, a few small components.
- `apps/web` — auth, home shell, workspace chrome (`_chrome/project-shell.tsx`) and all nine
  route bodies: Script, Outline, Storyboard, Scenes, Characters, Locations, Timeline, Research,
  Production. Each is `app/(app)/app/project/[projectId]/_<route>/` plus `lib/<route>/` for its
  actions. `lib/workspace/routes.ts` is the route tree; `lib/workspace/views.ts` tables each
  route's `?view=` tabs, drawn in the header's centre. The assistant (`lib/assistant/`) and
  share links (`lib/share/`) are cross-route.
- `apps/worker` — deliberately empty (one exported constant). Do not create `apps/sync/`.

Facts easy to get wrong (full history in `docs/build-decisions.md`):

- **Views are client state on Characters, Storyboard, Scenes and Timeline** (`_<route>/view-state.tsx`,
  URL unchanged); the other routes use `?view=`. Expect the same ask per route; do not pre-empt it.
- **Characters is a canvas** (fourth pass 2026-09-20, laper.ai's shape): `Characters · List`, no
  sidebar, a card per record with authored relationships as threads between cards
  (`character_relationships`, one row per pair, two directional labels, migration `0024`). The
  Relationships graph tab was removed 2026-09-21 as a second view of the same fact;
  `lib/characters/graph.ts` stays, tested, partly unread. `✦ Generate` is drawn disabled.
- **Locations reads the script back as evidence** at request time (`packages/script/src/sets.ts`),
  never stored. **Timeline** never reads a slugline as a date: `time-cues.ts` *proposes*, the
  writer accepts; `✦ Suggest placements` is not built (open decision 13).
- **Both editors are Tiptap 3**; the document lives in the editor, never React state. Boundary
  files: `lib/script/pm-model.ts`, `lib/outline/pm-model.ts`. Approved `apps/web` deps:
  `@tiptap/{core,pm,react,suggestion}`, `@floating-ui/dom`, `@anthropic-ai/sdk`,
  `fast-xml-parser`, `aws4fetch` — nothing else without asking.
- **The Script body is Geist on the canvas**; the engine still paginates in Courier
  (`lib/script/pages.ts` draws `Page N` dividers).
- **`revisions` and `comment_threads` have no route** (their routes were cut) but are read by the
  Script route. `character_findings` (`0022`) and `scenes.story_time/beats` are orphaned columns
  awaiting a drop ruling.
- **Production is a pipeline of jobs**: tiers (`Draft · Standard · Cinema`), never model names, in
  UI or schema; every generation a `jobs` row with its cost named before it is spent. Its feature
  doc set (`docs/production/`) was deleted 2026-09-21; AGENTS.md's open decision 14 and its
  Architecture / Feature workflow sections still point at it — treat those pointers as dead.
- **Optional env**: `ANTHROPIC_API_KEY` (assistant composer draws disabled without it; model id is
  `lib/assistant/model.ts`, not env) and the `R2_*` block (portraits, photos, frames).

**Nothing needs a live database** to typecheck, lint, build or unit-test. Signed-in E2E walks
(`apps/web/e2e/*-route.spec.ts`) need `E2E_EMAIL`/`E2E_PASSWORD` and skip without them;
`E2E_PORT` points them at a running dev server (default 3210).

## Commands

```bash
pnpm typecheck   # 6 packages — also a test suite: @ts-expect-error guarantees live in it
pnpm lint        # eslint.config.mjs is AGENTS.md made executable; each ban error carries its reason
pnpm test        # only @folio/script and web have test scripts
pnpm build       # web only; ends with scripts/assert-no-server-secrets.mjs
pnpm test:e2e    # Playwright, web only

pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
pnpm --filter web exec vitest run tests/production-status.test.ts   # one web test (Node >=22.12)
pnpm --filter @folio/db db:generate | db:migrate | db:check          # drizzle-kit
```

Traps that produce a false reading:

1. **`>>> FULL TURBO` means nothing ran.** Force before reporting a suite green:
   `pnpm exec turbo run test --force`.
2. **Root `pnpm test` can abort before `@folio/script` runs** — `web`'s tests need Node
   `>=22.12` (`ERR_REQUIRE_ESM` on older). Run the package directly.
3. **`test -- --coverage` does nothing** — use `pnpm --filter @folio/script test --coverage`.
4. **Windows: vitest prints an `EPERM` forks-worker stack after a passing run.** Read the counts.
5. **Git Bash mangles `//#lint:root` into a path.** `pnpm lint` is fine; prefix
   `MSYS_NO_PATHCONV=1` when using `turbo run` for that task.

## Rules the config enforces

- `tsconfig.base.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — the
  `undefined` guard after an index lookup is required.
- `process.env` is a lint error outside `packages/db/src/env.ts`, `apps/web/lib/env/public.ts`,
  `apps/web/scripts/` and test-runner configs. The split is a security boundary.
- Flat eslint config is last-match-wins; block order is load-bearing.

## Working here

- **Escalate the open decisions in AGENTS.md; do not resolve them.**
- **Any dependency needs approval, every time.**
- Report literally: paste failing output, name assumptions, flag any rule you were tempted to break.
