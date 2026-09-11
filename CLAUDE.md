# CLAUDE.md

Guidance for Claude Code in this repository. This file holds only what applies to every task.
`packages/script`, `packages/db` and `apps/web` each have their own `CLAUDE.md` that loads when
you work there — do not read them ahead of time.

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
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — preamble first; both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| answer something the spec leaves open | [docs/build-decisions.md](docs/build-decisions.md) — "Open, and blocking" is the live list |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |

## Repository state

- `packages/script` — the pure core, done: node model, seven operations, Fountain both ways, FDX
  import (callable from `apps/web` through `fast-xml-parser`, approved in the Script phase),
  derivation, pagination at **six lines per inch** (ruled 2026-09-11; AGENTS.md still says twelve),
  and the draft diff (`diffScreenplays`, node id as join key, lines at the sheet measure).
  20 test files, 408 tests.
- `packages/contracts`, `packages/db` — built: Zod boundary schemas, 31-table Drizzle schema, five
  forward-only migrations (all applied to the dev Supabase project; `0003` adds the pagination
  preference to `projects` and `title_pages`; `0004` adds `scenes_touched` / `page_count` to
  `revisions` and the `before_restore` / `restore` version reasons), project-scoped repositories.
- `packages/ui` — tokens as CSS custom properties, plus `Glyph`, `RevisionSwatch`, `Avatar`.
  Nothing else; no component reads a colour into JavaScript.
- `apps/web` — auth (Google OAuth + email/password), the signed-in home shell and its six routes,
  the project workspace **chrome** (rail, episode nav, param validation), and the **Script route**
  — Plate on Slate mapped one-to-one onto the eight-type union (`lib/script/slate-model.ts` is
  the boundary), server-side pagination drawn as page frames, autosave with last-write-wins, FDX
  and Fountain import, the cover — the **Scenes route** (derived cards over the measurement) and
  the **Revisions route** (`?view=diff|history`: any two drafts on the sheet with asterisks, issue /
  lock / restore through `lib/revisions/actions.ts`). Other route bodies are unbuilt on purpose.
  `lib/workspace/routes.ts` is the route tree. **The Script autosave is a delta and every write
  it runs is one statement**: over the transaction pooler a parameterised statement costs two
  round trips and cannot be pipelined (`packages/db/src/client.ts`), so on the request path the
  cost is statement count, not row count. Add to an existing statement or defer with
  `deferAfterSave`; never add a sequential query to a save.
- `apps/worker` — empty on purpose. Do not create `apps/sync/`.
- Unwritten and unblocked: **FDX export**.
- **Nothing needs a live database** to typecheck, lint, build or unit-test. The signed-in E2E
  walks (`shell-routes.spec.ts`, `workspace.spec.ts`, `script-route.spec.ts`,
  `revisions-route.spec.ts`) need
  `E2E_EMAIL`/`E2E_PASSWORD` and skip without them; `E2E_PORT` points them at a running dev
  server. The Script walk imports the golden corpus and diffs the rendered page map against it.

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

- **Escalate the open decisions; do not resolve them.** Blocking now: A4 sheet width, 12 vs 6
  lines per inch, page numbering past the last lock, revision sequence past green, the
  `SCENE_xxx` id shape (blocks `?selected=`), the `?lens=` value shape.
- **Any dependency needs approval, every time.** `packages/script` has none — keep it that way.
- Report literally: paste failing output, name assumptions, flag any rule you were tempted to break.
