# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there — do not read them ahead of time. Route history
lives in `docs/build-decisions.md`, one section per phase — read the phase for the route you touch.

**The script is a typed node list and the only hand-authored artefact.** Scenes, characters,
locations, page counts and shot lists are derived views. Nearly every real bug here is some other
surface quietly becoming authoritative.

## AGENTS.md is the contract — read the section for your task, not all 509 lines

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
| build a route or touch UI | [docs/ui design/CLAUDE.md](docs/ui%20design/CLAUDE.md), then that one route's bundle |
| change a built route | its phase in [docs/build-decisions.md](docs/build-decisions.md) — `grep -n '^## ' docs/build-decisions.md` |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — preamble first; both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| answer something the spec leaves open | [docs/build-decisions.md](docs/build-decisions.md) — "Open, and blocking" is the live list |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |

## Repository map

- `packages/script` — the pure core, done, no dependencies: node model, operations, Fountain both
  ways, FDX import, derivation, pagination, the draft diff, and one read module per derived route
  (`beats.ts`, `shots.ts`, `timeline.ts`, `bible.ts`, `rename.ts`).
- `packages/contracts` — Zod boundary schemas. `packages/db` — Drizzle schema, migrations
  `0000`–`0013` (forward-only, all applied to the dev Supabase project), project-scoped
  repositories. `packages/ui` — tokens as CSS custom properties plus five small components.
- `apps/web` — auth, the home shell, the workspace chrome, and the built route bodies: Script,
  Scenes, Outline, Storyboard, Characters, Locations, Timeline, Bible. Each has an
  `app/(app)/app/project/[projectId]/_<route>/` directory and a `lib/<route>/` with its actions.
  `lib/workspace/routes.ts` is the route tree. Other route bodies are unbuilt on purpose.
- `apps/worker` — empty on purpose. Do not create `apps/sync/`.
- Unwritten and unblocked: **FDX export**.

Rulings that supersede AGENTS.md (details in `docs/build-decisions.md`):

- Pagination is **six lines per inch** (ruled 2026-09-11; AGENTS.md still says twelve).
- **There is no Beats route** — built, then cut 2026-09-12; do not rebuild it. A beat is still an
  outline `beat` block. The `beats` table was dropped in `0010`; `scenes.beats` stays, opaque.
- **There is no Revisions or Notes route** — both built (Notes as an empty shell only), then cut
  2026-09-14; do not rebuild either. The workspace is **eleven routes**, the episode nav **four
  rows** (AGENTS.md still says thirteen and six). The `revisions` and `comment_threads` tables and
  their `@folio/db` reads stay — the Script route's right panel reads both independently.
- `fast-xml-parser` is approved and used in `apps/web` for FDX import.
- **The Script route has no element type bar** (retired 2026-09-13 on the client's instruction; the
  bundle still draws one). `/` opens a slash menu over the eight types and `⌘1`–`⌘8` stay; do not
  restore the bar.
- **Both editors are Tiptap 3 on ProseMirror** (Script ruled 2026-09-13; the Outline ported the
  same day; AGENTS.md still says Plate). `@tiptap/{core,pm,react,suggestion}` and `@floating-ui/dom`
  are approved in `apps/web`; **`platejs` is uninstalled** and lint bans it under both editors. The
  boundaries are `lib/script/pm-model.ts` and `lib/outline/pm-model.ts`; the document lives in the
  editor, never in React state. The Outline has no block toolbar and nothing in its left margin:
  `/` opens its slash menu, `⌘0`–`⌘3` / `⌘⇧Q/R/B` stay. FDX export is built.
- **The Characters route is the client's laper.ai shape, not the repo's bundle** (ruled
  2026-09-14; "Characters route, second pass" in `docs/build-decisions.md`). `Route -
  Characters.dc.html` and `screenshots/characters.png` are the old design and are not this
  route's reference. No cast column; `?view=overview | relationships | casting`;
  `/characters/:uuid` is the edit drawer over the grid; unmatched cues are ghost cards, never a
  screen. Migration `0013` dropped the first pass's drives, arc turns, voice rules and key lines
  (client ruling). Portraits are on Cloudflare R2 through `apps/web/lib/storage/r2.ts`
  (`aws4fetch` approved), gated on the optional `R2_*` env block. `character_relationships` is
  kept as a derivation read and nothing writes it. Generate (the look-sheet job) is not built.

**Nothing needs a live database** to typecheck, lint, build or unit-test. The signed-in E2E
walks (`apps/web/e2e/*-route.spec.ts`) need `E2E_EMAIL`/`E2E_PASSWORD` and skip without them;
`E2E_PORT` points them at a running dev server.

## Commands

```bash
pnpm typecheck   # 6 packages — also a test suite: @ts-expect-error guarantees live in it
pnpm lint        # eslint.config.mjs is AGENTS.md made executable; each ban error carries its reason
pnpm test        # only @folio/script and web have test scripts
pnpm build       # only web

pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
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

- **Escalate the open decisions; do not resolve them.** Blocking now: A4 sheet width, page
  numbering past the last lock, revision sequence past green, the `SCENE_xxx` id shape (blocks
  `?selected=`), the `?lens=` value shape.
- **Any dependency needs approval, every time.** `packages/script` has none — keep it that way.
- Report literally: paste failing output, name assumptions, flag any rule you were tempted to break.
