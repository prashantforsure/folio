# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Only what applies to every task lives here. `packages/script`, `packages/db` and `apps/web` each
have a `CLAUDE.md` that loads when you work there. `docs/` holds the ADRs, `docs/production/`
(the v12 Production spec), `docs/agents/` (the copilot: `integration-plan.md`, `roadmap.md`,
`craft.md`, `tools.md` and `worker.md`) and `docs/remainingroadmap.md`: the route history
(`docs/build-decisions.md`) and the first Production doc set were deleted on 2026-09-22. A route's
spec is now the route as built plus its paragraph in `apps/web/CLAUDE.md`; the reasoning behind an
older ruling is git history (`git log -S'<phrase>'`, or `git show e733475^:docs/build-decisions.md`
for the deleted file).

**Before proposing new work, read `docs/remainingroadmap.md`.** It is the standing list of what
looks unfinished but is deliberately cut (do not rebuild it), what is a known defect (don't mistake
it for a green-field feature), and what is blocked on an open decision rather than engineering
time. It is dated 2026-09-22 and describes the state as of that pass, not a live feed.

**We are building an AI copilot** in an app-wide side panel that can do anything a user can do,
through reviewable proposals — from reading and navigating to drafting a full script and carrying
it through storyboards to video. **For any copilot work, read
[docs/adr/0003-agent-copilot.md](docs/adr/0003-agent-copilot.md) and
[docs/agents/roadmap.md](docs/agents/roadmap.md) first** — the decisions D1 to D19, and the task
list whose working rules bind the session.
[docs/agents/integration-plan.md](docs/agents/integration-plan.md) is the plan,
[docs/agents/craft.md](docs/agents/craft.md) the rules the agent writes to, and
[docs/agents/tools.md](docs/agents/tools.md) every tool it may call.
AGENTS.md's *What we are building* is the short version, and every rule the copilot
changed is dated **2026-09-23** in place there.

**The script is a typed node list and the only hand-authored artefact.** Scenes, characters,
locations, page counts and shot lists are derived views. Nearly every real bug here is some other
surface quietly becoming authoritative.

**The design package is gone.** The v2 mockups (`docs/ui design/`) were the spec; the client
deleted them on 2026-09-20 on purpose — do not read them, not from git history either. Their
tokens live in `packages/ui/src/tokens/palette.css`; their language (plain lower-case-leaning
copy, live counts, both states, both themes) still binds. Production is the one route with a
written spec on disk: `docs/production/production.md` and the runnable mockup beside it.

## AGENTS.md is the contract — read the section for your task, not all of it

Always read **Open decisions** (under "When to ask first") and **Constraints**. Then only what
your change touches. `grep -n '^##' AGENTS.md` gives the line numbers.

| Your change touches | AGENTS.md section |
| --- | --- |
| the node model, an operation, Fountain or FDX | Domain rules → The node model; Exception tables |
| derive, characters, locations, aliases | Domain rules → Derivation; Entity identity |
| pages, the sheet, revisions | Domain rules → Pagination and the sheet |
| a route, a URL, anything visual | Domain rules → Routing; UI fidelity |
| the agent, jobs, credits, a generation | Domain rules → The AI agent; Jobs, credits and cost |
| a table or a query | Domain rules → Tenancy and data access |
| any new import | Tech stack → Adding a dependency |
| naming, layout, commits, reporting | Conventions; Feature workflow; Validation |

## Load on demand

| Before you… | Read |
| --- | --- |
| build or change a route, or touch UI | its paragraph in [apps/web/CLAUDE.md](apps/web/CLAUDE.md); `packages/ui/src/tokens/` and the built routes are the pattern |
| touch Production | [docs/production/production.md](docs/production/production.md) is the spec; the "Implementation" table in [docs/production/README.md](docs/production/README.md) says where each piece lives and lists every deviation |
| answer something the spec leaves open | the open decisions table in AGENTS.md — the only live list |
| build any part of the AI copilot | [docs/adr/0003-agent-copilot.md](docs/adr/0003-agent-copilot.md) and [docs/agents/roadmap.md](docs/agents/roadmap.md) **first**, then [the plan](docs/agents/integration-plan.md), [craft.md](docs/agents/craft.md) and [tools.md](docs/agents/tools.md); AGENTS.md's *The AI agent* is the binding rule set |
| change node identity or the id shape | [ADR 0001](docs/adr/0001-node-identity.md) — both rulings are reversible |
| touch `episodes` or join on one | [ADR 0002](docs/adr/0002-episode-identity.md) — `ep_NNN` is a slug over an opaque key |
| add a table, or ask what may write one | [packages/db/src/schema/index.ts](packages/db/src/schema/index.ts) — every table classified |
| add a colour, a size or a radius | [packages/ui/src/tokens/](packages/ui/src/tokens/) — the one place a hex may be written |
| read or add an environment variable | [.env.example](.env.example) — every variable and its reader; a new one lands in `packages/db/src/env.ts` and there in the same change |

## Repository map

- `packages/script` — the pure core, **no dependencies, keep it that way**: node model,
  operations, Fountain and FDX both ways, derivation, pagination, the draft diff, and one read
  module per derived route (`beats.ts`, `shots.ts`, `timeline.ts`, `continuity.ts`,
  `time-cues.ts`, `sets.ts`, `props.ts`, `rename.ts`, `sides.ts`, `description.ts`), and
  `draft-check.ts`, which holds an agent draft to the bound spellings (the story pipeline). `props.ts` is the odd one: a prop is
  **authored**, so it reads the script back as *evidence* for records the caller hands it and
  never proposes one.
- `packages/contracts` — Zod boundary schemas; `production.ts` holds `MODEL_REGISTRY`, the only
  place a **generation** model is named. The model that reads and drafts is
  `apps/web/lib/assistant/model.ts` — two registries, two owners, neither an environment
  variable (ADR 0003 D12). `packages/db` — Drizzle schema, forward-only migrations `0000`–`0038`
  (which are applied to dev is tracked in its `CLAUDE.md`), project-scoped repositories, the
  Production dev seed. `packages/ui` — tokens as CSS custom properties, the inline SVG icon set, a
  few small components.
- `apps/web` — auth, the account shell and its four routes (`app/(app)/app/(home)/`: New,
  Projects, Trash, Settings; `/app/recents`, `/app/screenwriting` and `/app/filmmaking` redirect
  to Projects since 2026-09-22), workspace chrome (`_chrome/project-shell.tsx`) and all ten
  route bodies: Script, Outline, Storyboard, Scenes, Characters, Locations, Props, Timeline,
  Research, Production. Each is `app/(app)/app/project/[projectId]/_<route>/` plus `lib/<route>/` for its
  actions (thin, cookie-gated) and their core functions (`core.ts`, gate-taking - what the agent's
  tools and the worker call). `lib/workspace/routes.ts` is the route tree; `lib/workspace/views.ts` tables each
  route's `?view=` tabs, drawn in the header's centre. The assistant (`lib/assistant/`) and
  share links (`lib/share/`) are cross-route. `lib/production/pipeline/` is the Gemini spec,
  client and runner.
- `apps/worker` — the queue's runtime over the `jobs` table (roadmap task 4.1, ADR 0003 D6: no
  Redis, no BullMQ): claim, `LISTEN`, heartbeat, stale recovery, drain, `GET /health`, a
  Dockerfile. It owns the loop only; the handlers are web's (`apps/web/lib/worker/`, imported as
  `web/worker`), bundled into `dist/main.mjs` by esbuild. `docs/agents/worker.md` runs and deploys
  it. Do not create `apps/sync/`.

Facts easy to get wrong (history in git):

- **The project list is `/app/projects`** (the account routes pass, 2026-09-22): one route, one
  query, filter chips where three routes used to be. Its filters, sort, layout and selection are
  client state, as is account settings' section nav. `projects.logline` and `projects.archived_at`
  are authored columns (`0029`); archiving is not trashing. Half of account settings is drawn
  disabled with the reason on the control — that is deliberate, and `apps/web/CLAUDE.md` lists
  every one.
- **Only Research still uses `?view=`.** Storyboard, Scenes, Characters, Locations, Props and Timeline
  hold their views as client state (`_<route>/view-state.tsx`, URL unchanged); Production's
  Cards / Columns is a `view_preferences` row. Each was ruled per route; a new `?view=` needs a
  row in `ROUTE_VIEWS` or `tests/workspace-routes.test.ts` fails.
- **Characters is a canvas** (fourth pass 2026-09-20, laper.ai's shape): `Characters · List`, no
  sidebar, a card per record with authored relationships as threads between cards
  (`character_relationships`, one row per pair, two directional labels, migration `0024`). The
  Relationships graph tab was removed 2026-09-21 as a second view of the same fact;
  `lib/characters/graph.ts` stays, tested, partly unread. `✦ Generate · 40 cr` draws the character's
  look as their portrait (roadmap task 5.2, in the first episode's art style); the three-angle look
  sheet is still drawn disabled.
- **Locations reads the script back as evidence** at request time (`packages/script/src/sets.ts`),
  never stored. **Timeline** never reads a slugline as a date: `time-cues.ts` *proposes*, the
  writer accepts; `✦ Suggest placements` is still not built, though its blocker is gone (open
  decision 13 closed by ADR 0003 D3).
- **Both editors are Tiptap 3**; the document lives in the editor, never React state. Boundary
  files: `lib/script/pm-model.ts`, `lib/outline/pm-model.ts`. Approved `apps/web` deps (plus
  `pdf-lib` and `@pdf-lib/fontkit`, ADR 0003 D17, installed with task 5.3):
  `@tiptap/{core,pm,react,suggestion}`, `@floating-ui/dom`, `@anthropic-ai/sdk`,
  `fast-xml-parser`, `aws4fetch` — nothing else without asking. Gemini is called over `fetch`,
  no SDK.
- **The Script body is Geist on the canvas**; the engine still paginates in Courier
  (`lib/script/pages.ts` draws `Page N` dividers).
- **`revisions` and `comment_threads` have no route** (their routes were cut) but are read by the
  Script route. `character_findings` (`0022`) and `scenes.story_time/beats` are orphaned columns
  awaiting a drop ruling.
- **Production is v12** (built 2026-09-22 from the handoff in `docs/production/`; migration
  `0025` dropped v1). Tiers (`Draft · Standard · Cinema`), never model names, in UI or schema;
  every generation a `generations` row with its cost named before it is spent, reserved on the
  shared `credit_ledger`. **`reel_shots` is Production's shot table; `shots` is the
  Storyboard's.** Scenes are keyed by `scene_node_id`; cast and lines are derived at read time.
- **Optional env**: `ANTHROPIC_API_KEY` (assistant composer draws disabled without it; model id is
  `lib/assistant/model.ts`, not env), `GEMINI_API_KEY` (every Production generate button draws
  disabled without it; `✦ AI Shotlist` falls back to the rule-based proposal) and the `R2_*`
  block (portraits, photos, frames, Production media — the image and video buttons need both).

**Nothing needs a live database** to typecheck, lint, build or unit-test. Signed-in E2E walks
(`apps/web/e2e/*-route.spec.ts`) need `E2E_EMAIL`/`E2E_PASSWORD` and skip without them;
`E2E_PORT` points them at a running dev server (default 3210); `E2E_PRODUCTION_URL` points the
Production walk at a seeded project.

## Commands

```bash
pnpm typecheck   # 6 packages — also a test suite: @ts-expect-error guarantees live in it
pnpm lint        # eslint.config.mjs is AGENTS.md made executable; each ban error carries its reason
pnpm test        # only @folio/script, web and worker have test scripts
pnpm build       # web (ends with scripts/assert-no-server-secrets.mjs) and the worker's bundle
pnpm test:e2e    # Playwright, web only
pnpm eval        # the story-to-script evals (apps/web/evals) - on demand, never CI: a model, money, EVAL_USER_EMAIL

pnpm --filter @folio/script exec vitest run src/paginate.test.ts    # one file
pnpm --filter @folio/script exec vitest run -t "the first id wins"  # one test
pnpm --filter web exec vitest run tests/production-derive.test.ts   # one web test (Node >=22.12)
pnpm --filter @folio/db db:generate | db:migrate | db:check          # drizzle-kit
pnpm --filter @folio/db seed:production -- --user <email>            # a dev project in every Production state
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
6. **`db:migrate` hides the failing statement** — run `drizzle-orm/postgres-js/migrator` directly
   to see it (`packages/db/CLAUDE.md`).

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
