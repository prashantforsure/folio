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
  the draft diff (`diffScreenplays`, node id as join key, lines at the sheet measure), the
  outline's reads (`beats.ts`: a beat is an outline `beat` block, numbered by ordinal, its bold
  lead ending at the first colon; headings and word count), and shots (`shots.ts`: the three
  closed vocabularies and `proposeShots`, a deterministic first shot list whose mentions are the
  records the alias table binds — not a model; there is none in the repository), and the timeline
  (`timeline.ts`: story time is `{ day, clock }` authored per scene, `precedesStoryTime` is strict
  and an unknown clock never precedes, `continuityFindings` skips flashbacks when looking back
  and reports a flashback's own jump as `kind: 'flashback'`; `chronology`, `storyJumps`,
  `storySpan`).
- `packages/contracts`, `packages/db` — built: Zod boundary schemas, the Drizzle schema, forward-only
  migrations (all applied to the dev Supabase project; `0003` adds the pagination
  preference to `projects` and `title_pages`; `0004` adds `scenes_touched` / `page_count` to
  `revisions` and the `before_restore` / `restore` version reasons; `0005` adds `beats` — **now
  orphaned**: the Beats route that wrote it was removed 2026-09-12 and the table has no Drizzle
  definition, so the next `db:generate` will emit `DROP TABLE beats` (expected; `scenes.beats`
  stays, opaque); `0006` adds `shots`, `jobs` and `frame_generations` — the job row is
  the status, a shot's frame is its latest generation read with its job; `0007` corrects the
  `credit_balances` view, which double-counted a held reservation; `0008` adds the character
  profile — group, role, age, drives with sources, voice rules, key lines as dialogue node ids —
  `character_relationships.shift`, and `character_arc_turns`, a turn pointing at a heading node or
  at nothing, no FK; `0009` adds `locations.merged_into` — the same tombstone characters carry —
  and `location_arc_notes`, one note per location per episode, keyed by the episode row; `0010`
  **drops the orphaned `beats` table** — the sanctioned drop, alone in its file; `0011` adds
  `story_threads` (name, colour from a closed enum, position) and `scenes.story_day` /
  `story_clock` / `flashback` — `scenes.threads` now holds story thread ids as text, first id =
  grid row, no FK, removed by `array_remove` on delete and dropped on read otherwise;
  `scenes.story_time` is unwritten and stays), project-scoped repositories. **`db:generate`
  needs a TTY** when a table is dropped and another created in one diff; `0010`/`0011` were
  produced through `drizzle-kit/api` from a one-off script (`docs/build-decisions.md`,
  "Timeline route phase") and `db:generate` now reports no changes.
  **The ledger's `settled` excludes `reserve` / `release`**; a reservation is closed by a `spend`
  or a `release`.
- `packages/ui` — tokens as CSS custom properties, plus `Glyph`, `RevisionSwatch`, `Avatar`,
  and the two the entity routes share: `Editable` (a line that edits in place) and `IdentityChip`
  (the round initial chip). Nothing else; no component reads a colour into JavaScript. The six
  `--thread-*` tokens are the Timeline's thread colours (four transcribed, two invented).
- `apps/web` — auth (Google OAuth + email/password), the signed-in home shell and its six routes,
  the project workspace **chrome** (rail, episode nav, param validation), and the **Script route**
  — Plate on Slate mapped one-to-one onto the eight-type union (`lib/script/slate-model.ts` is
  the boundary), server-side pagination drawn as page frames, autosave with last-write-wins, FDX
  and Fountain import, the cover — the **Scenes route** (derived cards over the measurement) and
  the **Revisions route** (`?view=diff|history`: any two drafts on the sheet with asterisks, issue /
  lock / restore through `lib/revisions/actions.ts`), the **Outline route** (a second Plate editor
  over the seven-block union, `lib/outline/slate-model.ts` the boundary, whole-list save, not
  paginated; **there is no Beats route** — built, then removed 2026-09-12 as a second rendering of
  the outline's beat blocks with nothing reading its timing) and the **Storyboard route**
  (`?view=board|canvas|list`: one column per present scene, Auto board
  proposes rows in state `proposed` that the writer accepts or edits, every shot's frame in all
  seven job states, `Draw frame · N cr` reserving `FRAME_GENERATION_COST` — a placeholder — in
  one statement through `lib/storyboard/actions.ts`; a queued job stays queued until a worker
  exists) and the **Characters route** (`/characters` and `/characters/:characterId`, the record's
  UUID; `?view=profile|map|resolve`: the cast column with per-episode presence, the profile with
  the alias table on it, the co-occurrence map, the resolve queue whose Match / Other… / Walk-on
  write `resolve_decisions` and re-derive; the rail badge is open rows *with a proposal*; rename
  is the sanctioned write-back — `renameCharacterCues` in `packages/script`, a `before_rename`
  version per document, one rewrite statement, the diff returned — and merge / delete through
  `lib/characters/actions.ts`) and the **Locations route** (`/locations` and
  `/locations/:locationId`; `?view=record|breakdown|resolve`: the tree column with day/night bars
  and roll-up counts, the record with the alias table, sub-locations, every scene at the set or
  below with eighths from the measurement, an arc note per episode and the `Inside` edge; the
  breakdown per episode; the resolve queue whose Match / Other… / New record settle sluglines and
  whose Attach / Create and attach / Keep separate are the only way the tree is written from a
  proposal. Rename is the second sanctioned write-back — `renameLocationHeadings` in
  `packages/script`, same shape as the cue rename — through `lib/locations/actions.ts`; the
  header count is primary sets) and the **Timeline route** (`/timeline`, project scope;
  `?view=story|chrono|continuity`: the thread column at 250px with create / rename / recolour /
  delete and an eye that dims a row, the grid — threads down, episodes or story days across, a
  `No thread` row, unplaced scenes shown in story order only — the 272px scene panel where story
  time is typed (day, `HH:MM`, flashback) and threads are linked, `Assume continuous` /
  `Continue from Day N` as one bulk `UPDATE`, the continuity list of `order` findings with
  `Retime` / `Flashback` / `Open in Script`; selection and hidden threads are React state in a
  provider the layout mounts, `_timeline/timeline-state.tsx`; writes through
  `lib/timeline/actions.ts`, none of which re-derives or touches a node). Other route bodies are
  unbuilt on purpose.
  `lib/workspace/routes.ts` is the route tree. **The Script autosave is a delta and every write
  it runs is one statement**: over the transaction pooler a parameterised statement costs two
  round trips and cannot be pipelined (`packages/db/src/client.ts`), so on the request path the
  cost is statement count, not row count. Add to an existing statement or defer with
  `deferAfterSave`; never add a sequential query to a save.
- `apps/worker` — empty on purpose. Do not create `apps/sync/`.
- Unwritten and unblocked: **FDX export**.
- **Nothing needs a live database** to typecheck, lint, build or unit-test. The signed-in E2E
  walks (`shell-routes.spec.ts`, `workspace.spec.ts`, `script-route.spec.ts`,
  `revisions-route.spec.ts`, `outline-route.spec.ts`, `scenes-route.spec.ts`,
  `storyboard-route.spec.ts`, `characters-route.spec.ts`, `locations-route.spec.ts`,
  `timeline-route.spec.ts`) need
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
