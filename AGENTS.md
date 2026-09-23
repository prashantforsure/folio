# AGENTS.md

Read this before touching anything. It is the contract, not a summary.

---

## Role

Behave like a senior TypeScript engineer building a professional tool for a paying client, to a
written spec, on a small team. The spec is more considered than it looks — where it seems
arbitrary, assume it is load-bearing and ask rather than improve it.

**Optimise for one thing: the script staying the single source of truth.** Every bug in this
codebase that actually matters is a bug where some other surface quietly became authoritative.
Performance, elegance and cleverness are all subordinate to that.

---

## Project overview

Folio is a workspace for writing a screenplay and carrying it through to production. The
screenplay is the only artefact authored by hand — scenes, characters, locations, page counts,
timeline threads and shot lists are all views derived from the script's typed node list, never
separate documents. It exists because a writers' room otherwise keeps the same facts in five
places — script, character bible, beat sheet, continuity doc, shot list — and they drift within
days.

---

## What we are building

Folio is getting an **AI copilot in an app-wide side panel** — one assistant that can do anything
a user can do, from reading and navigating the workspace to drafting a full script from a story and
carrying it through storyboards to video. It is not a second product surface: it is the same
actions, the same gates and the same records, driven by a model instead of a cursor.

**Every write it makes is reviewable.** Script, outline and record edits arrive as proposals —
hunks against current node state, or before/after values where a record has no hunk — and anything
with no diffable form asks for explicit confirmation instead. *The AI agent* below is the binding
rule set; where the copilot changed a rule, the change is dated in place.

The plan is [docs/agents/integration-plan.md](docs/agents/integration-plan.md), which carries these
rulings and its own five build phases. The decisions are
[ADR 0003](docs/adr/0003-agent-copilot.md) — its D1, D2 and D3 close open decisions 2, 16 and
13 below, and D8 closes 10 — and the task list is
[docs/agents/roadmap.md](docs/agents/roadmap.md), whose working rules bind every session that
builds any of it. The craft rules the agent writes to are
[docs/agents/craft.md](docs/agents/craft.md), and every tool it may call is
[docs/agents/tools.md](docs/agents/tools.md) — a tool that is not in that file does not exist.

---

## Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, `strict` | No `any` anywhere. Absolutely none in `packages/script` |
| Runtime | Node 22 LTS | |
| Package manager | pnpm workspaces | |
| Build | Turborepo | |
| Framework | Next.js App Router + React | Server Components for reads, Server Actions for mutations |
| Styling | Tailwind + CSS variables | Tokens as variables; theming via `data-theme` |
| Editor | Tiptap 3 on ProseMirror | Typed nodes only, never React state. **Pagination is ours, not the editor's** |
| Client state | URL first, then React state | Zustand only for the agent window rect and session flags |
| Server state | TanStack Query | **Planned, not installed.** Reads are Server Components + `cache()` + `router.refresh()` today; this is where it would go if they stop fitting |
| Validation | Zod, in `packages/contracts` | Every API boundary, shared by web and worker |
| Database | Supabase Postgres | Plain Postgres underneath |
| ORM | Drizzle | Session pooler for the worker, transaction pooler for requests |
| Migrations | drizzle-kit, forward-only | Owned in the repo |
| Auth | Supabase Auth — Google OAuth **and** email + password | `auth.users` is identity; `users`/`memberships` are ours. Confirmation and reset mail goes through Supabase's built-in sender; see Constraints |
| Tenancy | Project-scoped repositories **plus** RLS as defence in depth | Server uses the service-role key, which bypasses RLS |
| Storage | Cloudflare R2 over its S3 API, signed with `aws4fetch` | `apps/web/lib/storage/r2.ts` is the one module. Callers store the object **key** and compose the URL at read, from a **public** origin. **Signed read URLs are intended and not built** — anything uploaded or generated is readable by anyone holding the URL |
| Jobs | A worker over the Postgres `jobs` table | **Superseded 2026-09-23** (the copilot pass): BullMQ and Redis are **out** — the worker is built in **roadmap Phase 4** on the table that already exists, because a queue we own is one fewer dependency and the ledger is transactional beside it. **Ruling R6 built 2026-09-23** (roadmap task 4.1): `apps/worker` claims from `jobs` with `FOR UPDATE SKIP LOCKED`, wakes on `LISTEN folio_jobs` over the session pooler (`0036`'s trigger) with a 5 s poll, heartbeats every 15 s, requeues a job silent for 2 min and fails it at its third attempt, drains on `SIGTERM` and answers `GET /health`; its handlers are web's (`apps/web/lib/worker/`), bundled in by esbuild (approved for this, 2026-09-23). No Redis, no BullMQ. [docs/agents/worker.md](docs/agents/worker.md) is how to run and deploy it. **Since task 4.3** it runs Production's generations (`production_generation`, queued in the statement that reserves the credits - no more `after()`) and Storyboard's frames (`frame_generation`), with a reaper every 10 min that releases what nothing will close and an R2 sweeper that only logs unless `R2_SWEEP_DELETE=true` |
| Payments | Dodo Payments | Merchant of record; webhooks reconciled idempotently |
| AI — assistant | Anthropic API, `@anthropic-ai/sdk` (pinned) | Streaming over a route handler. The assistant panel is a read-only chat over the episode's script (ruled 2026-09-16), and over the whole project on `/characters` (ruled 2026-09-17), `/locations` and `/timeline` (2026-09-18); on `/production` it carries that route's chips (2026-09-22). The Characters drawer's two model actions (`✦ Draft from the script`, `✦ Check for contradictions`, 2026-09-18) were removed with the route's fourth pass (2026-09-20); their caps stay in `lib/assistant/model.ts` for the next action of that shape. **Updated 2026-09-23** (the copilot pass): it stays read-only until **roadmap Phase 3**, and writes through proposals from there — the proposal surface is that phase's work, not a later ambition. **Updated 2026-09-23** (roadmap Phase 2): the turn is a tool-use loop (`lib/agent/`) streaming `application/x-ndjson` events, with the read tools of `docs/agents/tools.md` and no write tool. **Shipped 2026-09-23** (roadmap Phase 3, ruling R8's second half): the write tools of `tools.md` are live and every one **proposes** - `agent_proposals` / `agent_proposal_ops` (`0035`), a card the writer applies or rejects, a run undone in one step; script and outline edits land through the open editor or a compare-and-swap (ADR 0003 D10); each person's autonomy is `review` (default) or `auto`, and confirm or paid operations always ask (D1) |
| AI — generation | Google Gemini over `fetch`, no SDK (client ruling, 2026-09-22) | Production only: `apps/web/lib/production/pipeline/gemini.ts`, keyed by `GEMINI_API_KEY`. The image and video model ids are `MODEL_REGISTRY` in `packages/contracts/src/production.ts` and nowhere else; the writer sees tiers. The model that *reads and drafts* is a different decision with a different owner and lives in `apps/web/lib/assistant/model.ts` (ADR 0003 D12). Veo is not on the free tier — a shoot the key cannot make fails and refunds |
| PDF | `pdf-lib` on our own layout engine | **Built 2026-09-24** (roadmap task 5.3): `pdf-lib` and `@pdf-lib/fontkit` (ADR 0003's two pre-approved packages, and nothing else). `packages/script`'s `printPages` lays every line out from the **measurement record** - the stored one when its digest matches, one measured on the server when stale - and `apps/web/lib/script/pdf.ts` only draws it, with the title page first; asian refuses (open decision 8); page labels are printed as measured (open decision 12 stays open). Courier Prime and a Noto Sans Devanagari fallback are embedded from `apps/web/assets/fonts/` (TTF, OFL); `lib/script/pdf-fonts.ts` supplies the regenerator runtime fontkit 1.1.1's Indic shaper expects, rather than a new package |
| FDX | `fast-xml-parser` + custom mapping | |
| Fountain | Custom, in `packages/script` | |
| Fonts | Self-hosted Geist, Geist Mono, Courier Prime | Courier Prime version-pinned - it is the *measured* face (the engine, the cover, the export); the PDF embeds its TrueType files and Noto Sans Devanagari as the fallback for lines Courier Prime has no glyphs for (`apps/web/assets/fonts/`, server-only, 2026-09-24). Geist is chrome **and** the script body, Geist Mono the counts and refs (the v2 redesign, ruled 2026-09-16, replacing Inter) |
| Tests | Vitest · fast-check · Testing Library · Playwright | |
| Errors / analytics / logs | Sentry · PostHog · pino | **Planned, not installed.** Failure paths are `console.error`-and-swallow today, and `lib/auth/session.ts` says so at the point it swallows one |
| Deploy | — | **Not deployed yet**. The web host is unchanged and has no manifest in the repo; the worker is a **separate container** with its own image (`apps/worker/Dockerfile`, built from the repository root, since 2026-09-23) and deploy steps in [docs/agents/worker.md](docs/agents/worker.md); **no Redis** — see the Jobs row |

### Adding a dependency requires approval. Every time.

Stop and ask. Name the package, what it does, what it replaces, and its maintenance status.

This is stricter than normal because the **Deliberately not using** list below is a set of design
decisions, not an oversight — and the most tempting additions are precisely the ones that would
silently destroy the product.

**Ruled 2026-09-23** (the copilot pass): the rule is unchanged, and ADR 0003 pre-approves exactly
two packages — `pdf-lib` and `@pdf-lib/fontkit`, for the PDF engine. Nothing else is pre-approved
by it, and the copilot work is expected to need no other dependency: the worker runs on the
Postgres `jobs` table and tool use comes from the `@anthropic-ai/sdk` already installed.

**Deliberately not using — do not add these:**

- **Headless Chrome for PDF.** Its text metrics won't match the on-screen sheet, and export must
  agree with pagination exactly.
- **Tailwind's `dark:` variant.** Theme is the cascade under `data-theme`, and islands nest. Use `data-theme`.
- **Tailwind's default `gray` or `slate`.** The palette is one near-black canvas, translucent
  surfaces and a single blue accent, all declared in `packages/ui/src/tokens/palette.css` (copied
  from the v2 design package's `:root` block before the client retired that package on
  2026-09-20); a second grey scale beside it is how the look drifts.
- **Any icon library.** Icons are inline stroke SVGs hand-written in `packages/ui/src/icons.tsx` from
  the design package, and nothing else. (The routes built before the v2 redesign still print the
  older Unicode glyph set as text until each is rebuilt.)
- **A component library with opinions** (MUI, Chakra, Ant, shadcn). The design system is written
  and specific; a themed library fights it.
- **Serverless functions as queue consumers.** Jobs are long-running and stateful.
- **Supabase client libraries for data access in server code.** Drizzle against the Postgres
  connection. The Supabase JS client is for auth and storage only.
- **A transactional email provider** (Resend, Postmark, SES). Supabase Auth's built-in SMTP
  sender covers address confirmation and password reset, and nothing else. Adding a real provider
  is a dependency decision *and* a product one, because it would make asynchronous notification
  possible — and notification is cut. See Constraints.
- **Plate, Slate, or any `@platejs/*` / `@udecode/*` package.** Both editors were rebuilt on
  Tiptap 3 over ProseMirror (2026-09-13); `platejs` is uninstalled and lint bans the whole family
  under both editors. Do not reintroduce it for a third editor either.

`packages/script` takes **zero** new runtime dependencies without an explicit decision. It must
run identically in the browser, in server code, in the worker and in tests.

---

## Development philosophy

1. **Derive, never duplicate.** Before adding a column, ask whether it is a function of the node
   list. If it is, it is a cache — and it must be reproducible by re-derivation.
2. **Purity first.** `packages/script` has no React, no database, no `fetch`, no `process.env`,
   no `Date.now()` and no `Math.random()`. Determinism is what makes speculative derivation —
   and therefore blast radius and review tiers — possible.
3. **The URL is the state container.** Route, episode, sub-view and selected record all come from
   the URL. The exceptions are named in the *Sub-views are query params — except* table below.
4. **Both states always.** Populated and empty ship together. A new project opens into the empty
   state, so it is the first screen most users see. A route without its empty state is not done.
5. **The server enforces; the client discloses.** Scope, tool allowlists, cost checks and research
   readability are all enforced server-side. The UI's job is to show that enforcement honestly —
   the scope chip, the capability chips, the cost on the button.
6. **Make illegal states unrepresentable.** Prefer a discriminated union over a boolean plus a
   comment. The eight element types are a closed set; keep them closed.
7. **Thin vertical slices.** Schema → contract → pure logic → repository → server action → UI,
   one route at a time. Never build four routes to 80%.
8. **Test where correctness is load-bearing**, not uniformly: the parser, derivation, node
   identity, pagination, and the agent's allowlist enforcement.
9. **Read the route's spec before building it.** Since the design package was retired
   (2026-09-20) and `docs/build-decisions.md` deleted (2026-09-22), the spec is the route as
   built plus its paragraph in `apps/web/CLAUDE.md`; for Production it is
   `docs/production/production.md` with the mockup beside it. The shell's shape is set in UI
   fidelity below and is the same on every route.
10. **Never invent a product decision.** Unresolved questions are listed below. Escalate them;
    do not quietly pick one.

---

## When to ask first

Stop and ask before you:

- Add, remove or upgrade a dependency.
- Change the **node schema** — it is the join key for comments, proposals, provenance and every
  derived entity. This needs an ADR, not a commit.
- Make a breaking change to `packages/contracts`.
- Write derived data back into the document. Exactly two operations are sanctioned; see the
  exception table.
- Add a route segment or a query param, or change what an existing param accepts.
- Touch credits, the ledger, refunds, or anything Dodo.
- Widen what the AI can read or write, in any direction.
- Edit schema in the Supabase dashboard. (The answer is always no. Migrations live in the repo.)
- Delete or purge user data, or write a migration that drops a column.
- Change the revision colour sequence or locked-page renumbering behaviour.
- Resolve one of the open decisions below.

### Open decisions — do not resolve these on your own

| # | Question | Blocks |
| --- | --- | --- |
| 1 | ~~Which node id survives a split, and what happens on merge and paste~~ **Ruled, by delegation: [ADR 0001](docs/adr/0001-node-identity.md)** — each position is reversible; Q3's id-shape ruling is the one flagged for a human look | — |
| 2 | ~~The numeric thresholds separating review tiers 1 / 2 / 3~~ **Ruled 2026-09-23: ADR 0003 D1** (the copilot pass) — the review flow could not be specified around an open number | — |
| 3 | Whether rename rewrites unlinked prose mentions in action, or only cues, sluglines and `@mentions` | Rename blast radius |
| 4 | ~~The `?lens=` value shape — `lens/<id>` as written, or just `<id>`~~ Moot: Insights was removed with the v2 redesign (2026-09-16). Reopens if a report route returns | — |
| 5 | ~~Whether `/production` is project- or episode-scoped~~ **Ruled: episode-scoped** (the workspace shell pass; the v12 route keeps it, `docs/production/README.md`) | — |
| 6 | ~~Whether `/build` and `/search` are cut or merely undesigned~~ **Ruled: cut** (the workspace shell pass) | — |
| 7 | Where project settings `transfer`, `keys` and `episodes` went | Settings |
| 15 | What duplicating a project copies — `@mention`s are bound to character and location ids, so a copied node list points at the original's records; and what becomes of its notes, revisions and its append-only ledger. The control is drawn on the Projects route and refuses in words (`lib/projects/actions.ts`) | `Duplicate`, on a card and in the bulk bar |
| 16 | ~~Whether a role means anything~~ **Ruled 2026-09-23: ADR 0003 D2** (the copilot pass), and **implemented the same day** (roadmap task 1.2) — an agent's permissions cannot be "whatever the user can do" while that sentence means "anything". The matrix is one table, `apps/web/lib/auth/roles.ts`, applied by the gates in `apps/web/lib/script/gate.ts` and `lib/projects/actions.ts` to every server action and to `ask()` | — |
| 8 | Sheet width for `format: asian` — A4 is ~794px, not 816px | Pagination engine |
| 9 | The `/app/filmmaking` ADR | Anything past a project list. The list is `/app/projects` since 2026-09-22; `/app/filmmaking` redirects to it and a filmmaking project still opens there |
| 10 | ~~Whether `SCENE_xxx` is a node id or the derived scene record's id~~ **Ruled 2026-09-23: ADR 0003 D8** (the copilot pass) — a scene's identity is its **heading node id**, which is what `packages/script` and six tables always did. [ADR 0001](docs/adr/0001-node-identity.md) Ruling 3 is amended to match, the `scene_` prefix is retired, and the ADR and the code no longer contradict each other | — |
| 11 | The revision colour sequence past green (`nextRevisionColour` refuses at green) | Issuing a sixth revision |
| 12 | Locked-page numbering past the last lock — a judgement call is implemented (the sequence continues unprotected), not ruled | Export, revision compare |
| 13 | ~~Whether an assistant message costs credits, and how much~~ **Ruled 2026-09-23: ADR 0003 D3** (the copilot pass) — an agent that calls a model many times per task made this urgent. The panel wrote no ledger row from 2026-09-16 until this ruling | — |
| 14 | The Production feature set's escalations — the credit unit and margin, refund on cancel-while-running, the costs the v12 spec does not price (shot frame 4, scene image 40, AI shotlist 0, propose 0 are provisional; so is the location plate at 40, added 2026-09-24 by roadmap task 5.1 at the client's request, its price left by them to decide), the stale rules. The D-1 … D-21 list went with the first doc set (deleted with `docs/build-decisions.md`, 2026-09-22); the v12 pass took provisional answers, each listed under "Implementation" in `docs/production/README.md` | Changing a cost, a refund rule or a stale rule in `apps/web/lib/production/` or `packages/contracts/src/production.ts` |

---

## Architecture

```
apps/web/                    Next.js app. UI and server actions only — no logic that belongs in packages/script.
  app/(app)/                 Signed-in shell: the 238px account sidebar, theme, the account menu. Everything user-facing lives under /app.
  app/(app)/app/(home)/      The account routes: new, projects (+ three redirects), trash, settings.
  app/(app)/app/project/     Project workspace: rail, writing sidebar and header, the assistant panel, the ten routes.
  lib/                       Web-only glue: auth session, server action helpers, query client. Not domain logic.
apps/worker/                 A worker over the Postgres jobs table. Long-running. Generation, export, agent runs.
                             Never a serverless fn, and NO Redis and NO BullMQ (superseded 2026-09-23, the copilot
                             pass): built 2026-09-23 (roadmap task 4.1) on the table that already exists - claim, LISTEN,
                             heartbeat, stale recovery, drain, GET /health, a Dockerfile. Its handlers are web's
                             (apps/web/lib/worker/, bundled in); docs/agents/worker.md runs and deploys it.
apps/sync/                   Deferred. Do not create this directory until realtime is actually scheduled.
packages/script/             PURE. Node model, parser, derivation, pagination, Fountain. No React, no DB, no I/O.
packages/ui/                 Primitives, tokens, theme. Presentational only — no data fetching, no domain knowledge.
packages/db/                 Drizzle schema, forward-only migrations, project-scoped repositories, the dev seed. The only place SQL lives.
packages/contracts/          Zod schemas shared by web and worker. Types flow from here; do not redeclare them downstream.
                             production.ts holds MODEL_REGISTRY — the only place a *generation*
                             model is named. The assistant's is apps/web/lib/assistant/model.ts
                             (ADR 0003 D12: two registries, two owners, neither an env var).
docs/                        adr/, production/ (the v12 spec: production.md, the runnable mockup, its data and runtime),
                             agents/ (the copilot: integration-plan.md, and roadmap.md once written) and
                             remainingroadmap.md (defects, open-decision impact, unbuilt surface, as of 2026-09-22 -
                             read it before proposing new work, it names what's already known). build-decisions.md and
                             the design bundles are deleted; their reasoning is git history.
```

`packages/script` importing anything framework- or database-shaped is a **lint error, not a code
review comment**. Keep the rule enforced in CI.

---

## Domain rules

### The node model

- A script is an **ordered list of typed nodes**, not a text blob.
- Eight element types, a closed set: **Scene · Action · Character · Paren · Dialogue ·
  Transition · Comment · Subtitle**.
- Every node has a **stable id** that survives splits, merges, type changes and reorders.
- **There is no `page` attribute on a node. Ever.** Pagination is computed at render.
- **Generated text never enters the node stream.** `(MORE)`, `CHARACTER (CONT'D)` at a page
  split, and speaker `(CONT'D)` are computed at render and stripped on import. Authored `(V.O.)`,
  `(O.S.)` and `(O.C.)` *are* stored, as node attributes. Conflate the two and every `.fdx`
  round-trip doubles the continueds.
- **Comment nodes occupy zero page space.** Their presence can never change a page count, and
  they never reach an export.
- Every node records provenance: **typed or agent**, and which run.
- The Outline is a **different document kind in the same table** with a different, tiny, closed
  block set (Body, H1, H2, H3, Quote, Rule, numbered beats). Do not widen the screenplay schema
  to hold an `H2` — rejecting anything outside the eight types is that schema's entire job.
- **Neither editor has a persistent element-type bar** (the Script route's was retired
  2026-09-13). `/` opens a slash menu over the closed type set and `⌘1`–`⌘8` (Script) /
  `⌘0`–`⌘3` (Outline) select one directly. Do not restore a type bar.

### Derivation

- Derivation is a **pure function over a node list**. It runs against a saved snapshot in normal
  operation and against a **speculative** node list to compute blast radius. Same function.
- **Derivation is one-way.** See the exception table for the only two sanctioned write-backs.
- **Records survive deletion.** A name removed from the script keeps its record with zero
  occurrences. `0 appearances · record kept` is a designed, valid state.
- Derivation **reconciles; it never rebuilds.** Authored data hanging off derived rows — resolve
  decisions, synopses, beat links, story time, threads — must survive a full re-derive intact.
- A malformed heading does not silently become a scene. `INTERCUT - PHONE CALL` is not an
  interior scene at location `ERCUT`.

### Entity identity

The hardest correctness problem in the app. Get this wrong and the product is worthless.

- A character is a **stable UUID with a name attribute**. It is *not* its cue text.
- Matching goes through an **alias table** — `MEERA` 79, `MEERA (V.O.)` 3, `YOUNG MEERA` 2 —
  never by hashing the string. This is what makes `मीरा` and `MEERA` one person.
- **Delivery modifiers are parsed off before lookup** and never create a second person:
  `(V.O.)`, `(O.S.)`, `(CONT'D)`, `(O.C.)`.
- A **record-level** rename rewrites every cue in every episode and keeps bio, portrait,
  relationships and casting. A **cue-level** rename asks first: rename everywhere, or create a
  new character?
- A location is a **tree, not a list**. Sub-sets hang off a primary set, each with its own
  sluglines and counts. Breakdown and scheduling count shooting days **by set**, and a flat list
  cannot answer "how many days in the chawl".
- **The resolve queue is rows, not a computed view.** A rejected proposal must not reappear
  identically on the next derivation pass.

### Pagination and the sheet

- Computed **server-side**, so client, print and export agree. Results go on a **measurement
  record**, never onto a node.
- US Letter is 816px at 96dpi. Courier Prime 12pt, **six** lines per inch (`LINES_PER_INCH` in
  `sheet.ts`; ruled 2026-09-11 against the design bundle's sheet — moves page count by roughly
  2×, so re-ruling it needs a human, not a commit). `format` is an **input to the engine**, not a
  print preference — it changes line width, page count, page numbers and eighths.
- Two rendering modes plus a cadence flag: **`pageMode: paged | continuous`** and
  **`liveRepaginate: boolean`**. Not three peer modes.
- Break rules the engine owes: `(MORE)` at a split, `(CONT'D)` on the continuation, no orphaned
  scene headings, no stranded single dialogue lines, at least two lines of dialogue before a
  legal break.
- **Locked pages must not renumber.** That is the entire point of the colour system.

### Routing

- Everything under `/app/`. One prefix for the signed-in product.
- Sub-views are **query params**, never separate routes. Each defaults to its first value.
- The account routes are **`/app/new`, `/app/projects`, `/app/trash`, `/app/settings`** (the client's
  handoff, 2026-09-22). `/app/recents`, `/app/screenwriting` and `/app/filmmaking` were three views
  over one query; they are now **redirects to `/app/projects`**, where the kind is a filter chip.
  The three paths stay because links to them exist outside this app and because open decision 9
  names `/app/filmmaking`. The Projects route's filters, sort, layout and selection, and the
  Settings route's section nav, are **client state** - the URL never moves (the exception table).
- `:episodeId` shares a path position with the project-scoped names. Validate every episode id
  against `characters`, `locations`, `timeline`, `research`, `insights`, `production`,
  `settings`, `assets` - and `props`, **appended** by the Props pass, since this sentence was
  written before that route existed - and keep ids to the `ep_NNN` shape. Static-first precedence
  saves this tree by accident; do not rely on it.
- `projectType: 'film'` **hides** the episode segment. The database still stores one episode row.
  The router special-cases the shape; the schema never does. So there are **two URL shapes for the
  same ten routes** — series `/app/project/:projectId/:episodeId/<route>`, film
  `/app/project/:projectId/<route>` — and the film half is a **duplicated static tree** under
  `(film)/`, because Next has no optional segment. **Build every workspace URL through
  `apps/web/lib/workspace/hrefs.ts`**, which holds the shape distinction; `enterEpisodeRoute`
  canonicalises a URL for the project's type. A concatenated path 404s on half the projects.
- Rail order is fixed (the v2 design's "Rail", retired 2026-09-20 - the order stands): Writing · Characters · Locations ·
  **Props** · Timeline · Research · Production. Writing stays lit across all four writing routes. Insights
  was removed with the v2 redesign (2026-09-16); its name stays reserved. **Props** was added by
  the Props pass, after Locations - the rail then reads as the shoot reads (who, where, what
  with, then when, what it is about, how it is made) and the v2 order is otherwise untouched. It
  is project-scoped, has no episode segment, and its name is reserved in
  `RESERVED_PROJECT_SEGMENTS` - **appended** to the eight this document names above, which were
  written before the route existed.
- The writing sidebar lists **Script · Storyboard · Outline · Scenes** (ruled 2026-09-17, reversing
  2026-09-16: the header's Write / Storyboard mode pill is gone on every route, Storyboard is a row
  under Script). The header's centre is the **current route's sub-views** - `?view=` tabs, each its
  name beside its icon where the design draws one (`lib/workspace/views.ts`), or the same-shaped
  buttons a state route hands in; a route with one view has an empty centre. Route toolbars do not
  draw a second view switcher. Research is the only route still on `?view=`.
- The rail's Characters icon navigates to `/characters` from every route (re-ruled by the client
  2026-09-16; the writing mockups' 330px peek overlay was built in the first shell pass and
  removed).
- Characters' `Characters · List` tabs (the fourth pass, 2026-09-20; the Relationships tab
  between them was removed 2026-09-21) are **not** `?view=` (ruled 2026-09-16, the Script route's
  precedent): the URL stays `/characters`, the view is React state in the route's layout. The
  Storyboard's `Boards · Canvas · Shot list` and Scenes' `Cards · Index cards · Scene list` took
  the same ruling on 2026-09-17: the URL stays `/storyboard` or `/scenes`, the view is a client
  cell the header and the body share. Locations' `Places · Scenes here · Sheet` and the
  Timeline's `Story · Chronology · Continuity` took it on 2026-09-18, as React state in each
  route's layout. Production's `Cards · Columns` (2026-09-22) is a `view_preferences` row, per
  the v12 spec. See the exception table.

### UI fidelity

- **The account routes were built from a handoff that is not in the repository.**
  `handoff-account-v2/` (three `Route - *.dc.html` files, `support.js` and a README, the
  client's, 2026-09-22) was supplied with the brief and never committed — the same standing the
  v2 design package ended with, so **the spec for `/app/projects`, `/app/new` and `/app/settings`
  is the routes as built plus their paragraphs in `apps/web/CLAUDE.md`**, and comments naming
  `handoff-account-v2/` name that artefact, not a path. It was a design, not a product decision:
  where it drew a control this product has no store for, the control is drawn **disabled with the
  reason on it** or refuses in words, and every such deviation is listed in `apps/web/CLAUDE.md`.
  Its `--sheet` / `--sheet-ink` map onto this palette's `--sunk` / `--read`; nothing else in it
  was a new colour.
- **The design package was the spec, and is retired.** The v2 design package (`docs/ui design/`,
  a README and nine `Route - * v2.dc.html` mockups, 2026-09-16) was the spec for the shell and the
  routes rebuilt to it; the client deleted it on 2026-09-20, on purpose, and it is not to be read
  back from git history. Its `:root` token block lives on as `packages/ui/src/tokens/palette.css`,
  copied verbatim; its language, tokens and patterns (plain lower-case-leaning copy, live counts,
  both states, both themes) still bind every route. The written route record
  (`docs/build-decisions.md`) was deleted on 2026-09-22 as well, so **route by route the spec is
  the route as built and its paragraph in `apps/web/CLAUDE.md`**; the reasoning behind a ruling is
  git history. Four routes left their mockup before that: **Characters** (ruled 2026-09-17 - the
  client retired the mockup as too close to laper.ai; rebuilt to a written plan, **then a fourth
  pass on 2026-09-20 to laper.ai's route shape by the client's ruling** - a canvas of cards, a
  List, a form drawer; the Relationships graph came and went 2026-09-21), **Locations** and the
  **Timeline** (both 2026-09-18, the same audit, each rebuilt to a written plan), and
  **Production** (ruled 2026-09-19; **the v12 handoff is its spec, 2026-09-22:
  `docs/production/production.md` plus the runnable mockup beside it**, the one route with a spec
  on disk - "Implementation" in its `README.md` lists where each piece lives and every deviation).
- **Icons are inline stroke SVGs** from `packages/ui/src/icons.tsx` - 18px, 1.35 stroke, the
  mockups' own paths. The routes built before the redesign still print the older Unicode glyph
  set as text: `✎ ◍ ⌖ ◷ ▧ ▶ ☾ ☀ ⚙ ▤ ⋮ ▥ ▢ ⇄ ❝` (`⧗` left with Beats, `◈` with Bible, `◎` with
  Insights). Substituting a lookalike is refused in either set.
- The shell is one shape on every route: rail **56px**, writing sidebar **236px** (a floating
  card), header **60px**, panels **400px** in flow at ≥1200px and over the content below it,
  where an open panel forces the sidebar closed - solved in the shell, never in a child. Rail
  active state is the `--s2` fill with full ink; the older accent bar is gone.
- The writing routes have **no status bar**; the record routes' 28px bar is per their mockups.
- **The script body is Geist, not paper.** Text on the canvas in a column capped at 818px, page
  breaks drawn as `Page N` dividers from the measurement record (`lib/script/pages.ts`). The
  engine still measures in Courier; the screen no longer wraps where it wraps, by ruling
  (2026-09-16) - counts, eighths and export are the engine's, the divider is where a page
  begins.
- Badges are **live counts**, never placeholders: Characters = unresolved cues · Locations =
  unmatched sluglines. A third badge, Bible = open canon conflicts, existed while the Bible route
  did (cut 2026-09-15).
- Empty meta follows a convention: things that legitimately count to zero show `0`; things that
  either exist or don't show `—`; the script says `empty`.
- Project cards show **real derived metadata** — episode, scene and page counts, last edited —
  never a placeholder string. If a project has no script, the card says so. Since the account
  routes pass (2026-09-22) the card also draws the script's **own opening lines** as its
  thumbnail (the node list, mentions resolved to names), the people on it (`memberships`), and a
  live chip only while a generation is queued or running. A stage is derived from what exists —
  never a draft number, which this schema does not have.
- Theme is `dark` by default, via `data-theme`. Revision colours (White → Blue → Pink → Yellow →
  Green) are industry artefacts, not palette tokens, and must survive a theme switch intact.
- Specified copy is specified. The design README's tone: "Plain, specific, lower-case-leaning.
  Labels say what happens: 'Draft from the script', 'It's deliberate', 'Not on the page yet'. No
  exclamation marks, no emoji, no feature marketing." Paraphrasing a specified label breaks the
  argument the screen is making.

### The AI agent

- One assistant, reachable everywhere. The orb in every header opens a **400px panel** (the
  README's; in flow at ≥1200px, over the content below), `⌘J` toggles it, and it persists across
  route changes. It is not a route. **Updated 2026-09-23** (roadmap task 2.2): it is mounted once in
  `app/(app)/layout.tsx`, so it also survives a move between projects and is hidden, never unmounted,
  when closed; outside a project it is a launcher (ADR 0003 D15) that stores no chat. It began as a **read-only chat** over the episode's script
  (`apps/web/lib/assistant/`, `assistant_chats` / `assistant_messages`, migration `0016`): it
  reads, it answers, it writes nothing. **Updated 2026-09-23** (roadmap Phase 2): "reads" now
  includes **read tools** - it searches, counts, reads a scene, runs the continuity check, takes the
  writer to a page (`navigate`) and hands them an export - through a tool-use loop recorded on
  `agent_runs` (`0034`); every number it states comes from a tool (R4), and it sees the route and
  the Script or Outline selection (as node ids, read back from the stored script). **Updated 2026-09-23** (the copilot pass): it stays
  read-only **until roadmap Phase 3**, and from there it writes — through the proposals above,
  never directly — because the panel is the copilot's surface and there is no second one.
  **Shipped 2026-09-23** (roadmap Phase 3): it writes. Every write tool queues an operation; a
  step's operations become one proposal (a confirm-mode one stands alone), drawn as a card with
  hunks or before/after values; applying snapshots `before_agent_run` versions with the run id,
  runs each operation through the same action the UI calls and writes an `agent:<tool>`
  `activity_log` row; Undo run reverses a run and proposes, rather than overwrites, whatever
  changed since (`lib/agent/apply.ts`). Research stays read-only (R3); the prompt carries the
  craft rules and a tool policy (`lib/assistant/context.ts`). On `/characters` it reads the whole project and, with a
  record open, a Focus block for it (ruled 2026-09-17); on `/locations` the location records
  beside the cast (2026-09-18); on `/timeline` every scene's story time, its threads and the
  continuity check's open findings, with the drawer's scene as the Focus (the Timeline rebuild,
  2026-09-18). The Characters drawer's two model actions (2026-09-18: `Draft from the script`
  into an **unsaved** field, `Check for contradictions` into `character_findings` rows) were the
  first steps past the chat; the route's fourth pass removed them on 2026-09-20 (the drawer is a
  form now), `character_findings` is orphaned and kept, and the rule below still binds whatever
  comes next. The lifecycle below is where it goes next. **Shipped 2026-09-23** (roadmap task 4.4,
  ADR 0003 D4/D5/D7/D14): **background runs**. A turn hands work past its 12 steps to
  `start_background_task`, which writes a run, a chat of its own and an `agent_run` job; the worker
  runs it with the same loop and registry, as its starter, re-opening the gate before every step;
  every step is stored first, so a crashed run resumes from its transcript; it waits for the writer
  (`waiting_for_user`) on a confirmation, after 40 steps or at the daily token cap, and their reply is
  its next job. Two live (`queued` or `running`) per project. The panel polls it every 2 s; only its
  starter replies, its starter or an owner cancels (`lib/agent/background.ts`, `runs.ts`).
  **Shipped 2026-09-24** (roadmap task 4.5): **the story pipeline**. `story_to_script` (confirm)
  starts a background run that expands the story (a checkpoint), proposes the characters and
  locations as one proposal and the outline as another (a checkpoint), lists the scenes (a
  checkpoint), drafts each scene against the craft rules with a critic pass and one rewrite, and
  proposes them in chained batches of five; once the writer has applied them it re-derives,
  measures, checks continuity and proposes story days, synopses and threads. Each stage's output
  is stored (`agent_run_stages`, `0038`) so the run resumes stage by stage. The model never writes
  a cue or a heading: it names a bound character or a bible location, code writes the bound
  spelling, and `checkDraft` (`packages/script`) repairs or refuses the rest
  (`lib/agent/story/`). **Shipped 2026-09-24** (roadmap task 5.1): **it spends, and only when
  asked**. The paid tools `generate_images` (plates, scene images, sheets, frames) and `shoot_reel`
  price each call from `GENERATION_COSTS`; the card shows the price and the balance; confirming
  grants the run exactly that budget (ADR 0003 D3 - it starts at 0 and nothing else raises it) and
  each image or shoot spends from the grant before it starts. `script_to_production` (confirm) starts
  a background run that proposes the settings and a reel per scene, drafts a shotlist per reel,
  stops for the writer to accept the shots, asks about locations with no photo (upload one, or have a
  plate drawn from its description), shows the cost table with the balance, and asks **once for the
  images and separately for the shoots** (`lib/agent/production/`). **Shipped 2026-09-24** (roadmap
  task 5.2): `generate_character_look` (paid) and the Characters card's `✦ Generate · 40 cr` draw a
  character's look from their appearance, age and gender, in the project's **first episode's** art
  style (client ruling), and store it as the portrait - the appearance reference Production draws
  them from; the pipeline's images include a look for anyone in a reel without one. **Shipped
  2026-09-24** (roadmap task 5.4): the panel's **History** tab lists every run of the project with
  its proposals, each operation in code's words with where it stands and when it was undone, a link
  to what it changed, the tokens it used and the credits it was granted and spent - read from
  `agent_runs`, `agent_proposals` and `activity_log` (`lib/agent/history.ts`) - with **Undo run**
  where there is something left to put back.
- Lifecycle: **Brief → Plan → Run → Review → Commit.** One run produces one revision entry.
- **Every write returns a proposal, never a mutation.** Proposals are anchored to node ids and
  rendered as hunks against current node state. **Narrowed 2026-09-23** (the copilot pass): this
  binds writes to the **script, the outline and the records** — hunks, or before/after values
  where a record has no hunk. An action with **no diffable form** (an upload, a generation, a
  canvas move) takes **explicit confirmation** instead, because a diff of it would be theatre.
  Confirmation is not a weaker proposal: it still names what will happen before it happens.
- **The approved plan is the allowlist.** A run may only write the surfaces its plan declared,
  enforced server-side. Client-side checks are decoration.
- **Locks are objects, not prose**: node, cast, outcome, heading, range. A plan that cannot
  succeed without violating one is rejected at planning time.
- **Parser parity** — agent output is parsed exactly like typed text. Ambiguous cues surface in
  the diff as merge / create / alias.
- ~~**Canon pre-flight** — bible conflict checking runs against proposed nodes, before review.~~
  No source for this since the Bible route was cut 2026-09-15 — there is no `canon` status left
  to check against.
- **One context gate, enforced server-side in the context builder, never in the UI**: the
  per-source research `readable` toggle. (A second gate, bible entry status, existed while the
  Bible route did.)
- A **lens** is four things: a system prompt, a tool allowlist, a readable-source list, and an
  output shape. The allowlist renders to the user as monospace chips, so a read-only lens is
  visibly read-only regardless of what its prompt says.
- **Every lens note cites its sources. A note that cannot cite one is not rendered.**
- **A report never calls a model.** Reports are arithmetic over the node list and derived
  entities. Asking a model to count is slower, costs money, and is less accurate than the code it
  replaced. **Clarified 2026-09-23** (the copilot pass): the agent may *call* a report tool and
  phrase what comes back in its own words — **the numbers always come from code**, never from the
  model, and an answer that states a count the code did not produce is a bug.

### Jobs, credits and cost

- Long-running work is a **job** on the worker: status, cost, cancellable, resumable, survives a
  closed tab. Since roadmap task 4.3 that is literal: a generation or a frame is a `jobs` row the
  worker claims, never `after()`; a cancel of a running job is `cancel_requested_at`, heard on
  the worker's next heartbeat; a job the stale sweep gives up on is failed as "interrupted" and
  its credits come back.
- **Cost is named before it is spent**, on the button, per frame and per reel.
- **Reserve then execute.** The balance check happens *before* the job is enqueued, never inside
  it.
- The credits ledger is **append-only** and the balance is **computed, never stored**.
- **Failure refunds.** Every generation row links to its job and, on failure, to its refund
  ledger entry.
- `blocked` means moderation refused a shot, and it must show **the refusal reason in the
  writer's terms**.
- **The generation pipeline is specified, not improvised** (ruled 2026-09-19; built as
  `apps/web/lib/production/pipeline/spec.ts`, 2026-09-22): every job carries a provider-neutral `spec` (the assembled prompt, role-tagged
  reference inputs, the film-settings snapshot, a `source_hash`) and a `route` (what the worker
  chose); the registry in `packages/contracts` is the **only** place a model is named; the writer
  sees tiers (`Draft · Standard · Cinema`). Consistency is reference discipline: the kept character
  Look, the location plate and the Art Style prefix go into every generation, and an output whose
  `source_hash` no longer matches is **stale**, never silently regenerated. Cost is quoted from the
  registry at click, held on submit, settled on success, refunded or released otherwise.

### Tenancy and data access

- Every table carries `project_id`. Every query is tenant-scoped.
- **Every query goes through a project-scoped repository.** The server uses the service-role key,
  which bypasses RLS entirely — RLS is a safety net, not the mechanism.
- **The service-role key must never reach the browser.** Same for Dodo keys.
- **Every server action opens with a gate, and there are four** — `openEpisode`,
  `openEpisodeWith` (which runs one extra read inside the same `Promise.all`) and `openProject`
  in [`apps/web/lib/script/gate.ts`](apps/web/lib/script/gate.ts), plus `requireUser` in
  `lib/auth/session.ts` for the account routes and page loaders. The order is **parse → identity
  → membership → scope**, and a non-member and a non-existent project get the *same* refusal, so
  there is no existence oracle. A gate returns a `ProjectScope` or a refusal; it never throws.
  **Updated 2026-09-23** (roadmap task 4.2): the three cookie gates are identity plus
  `openEpisodeAs` / `openProjectAs` in `apps/web/lib/script/actor-gate.ts`, which make the same
  checks for a known actor with no cookie - so the worker opens a gate as a run's starter (ADR
  0003 D4) and is refused exactly as the browser is. Every action a tool wraps is a thin action
  over a **core function** (`lib/<route>/core.ts`, `<action>With(gate, …)`) that checks its own
  capability; the tools and the worker call the cores, never the actions.
  **`openProjectForRequest` checks nothing about the actor** — the scope guarantees a query
  cannot cross projects, not that the caller was entitled to this one. The gate is the only
  entitlement check, which is why a repository call that skips it skips authorisation entirely.
- **Every table is AUTHORED, DERIVED CACHE or MEASUREMENT, and the class decides who may write
  it.** The list is
  [`packages/db/src/schema/index.ts`](packages/db/src/schema/index.ts), which classifies all of
  them. It is structural, not a convention: the derivation writer holds a handle that reaches only
  the derived tables, so clobbering a synopsis is not a mistake to avoid — it is a query that does
  not compile. A page number may live only on a measurement record. Authored data hanging off a
  derived row must survive a full re-derive; see *Derivation* and the exception tables.

### Export

- Comments never enter an export. Notes never enter an export.
- The title page is a separate document on the same sheet geometry, exported with the script.
- Export must agree with on-screen pagination exactly. This is why the layout engine is ours.

---

## Conventions

**Typing.** `strict` everywhere. No `any`, no non-null `!` to silence the compiler, no
`as unknown as`. Types flow out of `packages/contracts`; do not redeclare a shape downstream.
Zod schemas are `XSchema`, with `type X = z.infer<typeof XSchema>`.

**Naming.** `camelCase` for values, `PascalCase` for types and components, `snake_case` for
database columns. Episode ids are `ep_NNN`. A scene's id **is** its heading node id, with no
prefix — [ADR 0003](docs/adr/0003-agent-copilot.md) D8.

**Imports.** Workspace packages by name — `@folio/script`, `@folio/ui`, `@folio/db`,
`@folio/contracts`. Never reach across a package boundary with a relative path. No default
exports except where Next.js requires them (pages, layouts, route handlers).

**Errors.** Pure functions in `packages/script` do not throw for expected conditions — a
malformed heading is *data*, not an exception, and it must be representable in the return type.
Server actions return a discriminated result, never a bare throw across the boundary. Log with
pino, structured, with a trace id. Report to Sentry on both client and server.

**Files.** Route UI colocates under its route directory. Anything used by two routes moves to
`packages/ui`. One component per file where the component is exported; local subcomponents may
share a file.

**Styling.** Tokens as CSS custom properties. Theme via `data-theme` on an ancestor. Never
`dark:`. Never a hardcoded hex outside the token definitions.

---

## Exception tables

### Derivation is one-way — except

| Case | Reason | Do this |
| --- | --- | --- |
| Character record rename | Cues are the character's occurrence in the document | Explicit rewrite operation, returns a diff, single undo entry |
| Location record rename | Rewrites every scene heading that uses it | Same — explicit, diffed, undoable in one step |
| Anything else | — | There is no third case. Escalate |

### Nothing is stored that can be computed — except

| Case | Reason | Do this |
| --- | --- | --- |
| Page number and eighths | Client, print and export must agree, and recompute is expensive | Store on a **measurement record**. Never a node attribute |
| Credit balance | The ledger is the truth | Compute from the append-only ledger. Never store a balance |
| Derived entity rows | Cross-episode queryability | Treat as a cache. Must be reproducible by re-derivation |
| Resolve-queue decisions | Must survive re-derivation | These are **authored input**, not derived output. Real rows |
| Continuity findings (`character_findings`, 2026-09-18) | A model's answer, not a function of the node list; the writer's verdict on it must survive a re-check | Store the two quotes, the claim and the verdict as rows, marked as the assistant's. Never treat them as derived, never as a bible |

### Generated text is never in the node stream — except

| Case | Reason | Do this |
| --- | --- | --- |
| `(V.O.)` `(O.S.)` `(O.C.)` | Authored by the writer | Store as node attributes |
| `(MORE)`, `(CONT'D)` at a split, speaker `(CONT'D)` | Layout artefacts | Compute at render. Strip on import |

### Sub-views are query params — except

| Case | Reason | Do this |
| --- | --- | --- |
| `pagination` | Two rendering modes plus a cadence flag, not three peer modes | `pageMode` + `liveRepaginate`, per project, not in the URL |
| `script.content=empty` | A data state, not a switch | Derive it from whether a script exists |
| `production.state` | The generation job's status | Drive it from the job row. All six states get built |
| theme, zoom, panels, palette, aiScope | Per user or per session | localStorage or session state |
| the assistant panel | The same panel on every route | `assistantOpen` is session state |
| Characters' `canvas \| list` | Ruled 2026-09-16 (the client; the views were renamed by the fourth pass, 2026-09-20, and its `relationships` graph removed 2026-09-21 as a second view of the canvas's own threads): switching must be instant and the URL must stay `/characters`, as the Script's switches were ruled 2026-09-11 | React state in the route's layout (`_characters/view-state.tsx`), so it survives opening the drawer; `?view=` is an unknown key there |
| the Storyboard's `board \| canvas \| list` | Ruled 2026-09-17 (the client): the same ask - a tab must switch smoothly and the URL must stay `/storyboard`; as a param each click re-ran the page's server read | A client cell the header's tabs and the workspace both reach (`_storyboard/view-state.tsx`, the `coverage.ts` shape - the shared writing layout cannot host one route's provider); resets to the board when the workspace unmounts; `?view=` is an unknown key there |
| Scenes' `cards \| index \| list` | Ruled 2026-09-17 (the client): the same ask again, in the same words - smooth, and the URL must stay `/scenes` | The Storyboard's cell shape (`_scenes/view-state.tsx`); the route's own client `<main>` (`_scenes/scenes-main.tsx`) writes `data-sub-view` and resets the cell to the cards on unmount; `?view=` is an unknown key there |
| Locations' `places \| scenes \| sheet` | Ruled 2026-09-18 (the client), with the rebuild: the same ask, and the URL must stay `/locations` | React state in the route's layout (`_locations/view-state.tsx`, the Characters shape - the route has a layout of its own), so it survives opening the drawer; `?view=` is an unknown key there |
| the Timeline's `story \| chrono \| continuity` | Ruled 2026-09-18 (the client), with the rebuild: the same ask, and the URL must stay `/timeline` | React state in the route's layout (`_timeline/view-state.tsx`, the Locations shape), beside the selected scene and the solo thread - the drawer is not a path (open decision 10); `?view=` is an unknown key there |
| which document the Script shows, the title-page or the script | Component state (ruled 2026-09-11); a scene the sidebar scrolls to is a `#n-<node id>` fragment, never `?selected=` | Not a param |
| Props' `overview \| list` | Ruled with the route (the Props pass): the same ask a sixth time - smooth, and the URL must stay `/props` (or `/props/:id` with the drawer open) | React state in the route's layout (`_props/view-state.tsx`, the Locations shape - the provider must be in the layout or opening the drawer resets the tab); `?view=` is an unknown key there |
| the Projects route's filter, sort, grid \| list and selection | Ruled 2026-09-22 (the client's account-routes handoff): they are a view over one array already in memory, not a sub-view of a route - and the three kind routes they replaced *were* routes | `useState` in `_projects/projects-workspace.tsx`; the counts are counts of the same array. `?view=` and `?filter=` are unknown keys there |
| account settings' section nav | The same ruling, the same day: seven sections of one page | `useState` over `lib/settings/sections.ts`; the URL stays `/app/settings` |

### The agent may write anywhere — except

| Surface | Reason | Rule |
| --- | --- | --- |
| Research | Source material must stay trustworthy | Read-only. **Reaffirmed 2026-09-23** (the copilot pass) *over* the integration plan's tool catalogue: `add_source`, `clip_line` and `send_clip` come out of it — a model that can edit the evidence cannot be used to check itself |
| ~~Bible~~ | Route cut 2026-09-15; its tables dropped in `0015` | — |
| Settings, people, billing, keys | Not creative surfaces | Never |
| Export | **Ruled 2026-09-23** (the copilot pass): a download is a read, and refusing it made the agent less useful than the UI beside it | **Allowed, read-only**, and only for the **requesting user** — it produces a file they could have clicked for themselves, and writes nothing |

### Every route ships both states — no exceptions

There is no case where an empty state is optional. A new project is entirely empty states.

---

## Constraints — what this version deliberately does not do

- **No transactional email provider — but email sign-in exists.** Auth is Google OAuth **and**
  email + password, with address confirmation and password reset both delivered by **Supabase
  Auth's own built-in SMTP sender** — rate limited project-wide to a handful of messages an hour,
  and documented by Supabase as unsuitable for production. That cost was named and accepted, not
  discovered (the auth pass; the reasoning is git history). The sender is reachable only through
  Supabase's own auth templates — the app has no way to compose mail — so every consequence below
  still holds:
  - **Nothing notifies asynchronously.** No "your export is ready", no "@mentioned you", no
    digest, no reminder, no failure alert.
  - **Job completion is in-app only.** A closed tab means you find out when you come back.
  - **Team invites are share links** generated in-app and copied by the inviter, never sent by
    Folio. Built 2026-09-16: `share_links` (migration `0016`), the header's Share popover, and
    `/share/:token`, which writes a membership with `invited_via: share_link`.
  - **No magic links** — passwordless sign-in over email would make the rate-limited sender
    load-bearing for *every* sign-in, not just the rare recovery.

  Adding a real provider unlocks the notification surface above, so it is a dependency decision
  *and* a product decision — When to ask first applies twice over.
- **No Beats, Revisions, Notes, Bible or Insights route.** The first four were built, then cut on
  the client's instruction (Beats 2026-09-12, Revisions and Notes 2026-09-14, Bible 2026-09-15);
  Insights was removed with the v2 redesign (2026-09-16) — do not rebuild any of them. A beat is
  still an outline `beat` block. The `revisions` and `comment_threads` tables stay: the Script
  route draws threads inline under their blocks and the revision list in its title menu; `beats`
  was dropped in migration `0010`, and `scenes.beats` stays as an opaque column.
  Bible's five tables and three enums were dropped outright in migration `0015` — nothing was
  left reading them once the rail badge stopped calling into `bible.ts`.
- **No realtime collaboration.** Last-write-wins with a conflict banner. Loro CRDT and
  `apps/sync` are deferred; do not scaffold them. **Reaffirmed 2026-09-23** (the copilot pass):
  an agent's script edits apply **in the writer's own open editor**, or through a
  **compare-and-swap** on save — so the copilot needs no realtime either, and the race where an
  agent and a writer both hold the whole node list is closed by the CAS, not by a CRDT.
- **`/app/filmmaking` is a redirect, nothing more.** Since the account-routes pass (2026-09-22) it
  has no page of its own — `app/(app)/app/(home)/filmmaking/page.tsx` is a one-line `redirect('/app/projects')`.
  `film`-type projects are a filter chip on `/app/projects`, not a separate list. Do not rebuild a
  project list, a creation flow or anything else under this path — open decision 9 (an ADR) blocks
  going past the redirect at all. The same applies to `/app/recents` and `/app/screenwriting`.
- **Project `/settings` is a stub.** No design exists. **Account `/app/settings` is built**
  (2026-09-22) and is a different route: profile, plan and credits, editor defaults,
  notifications, collaborators, integrations, security. Half of it is drawn disabled with the
  reason on the control - there is no plan table, no mail provider, no per-person editor store,
  no third-party integration and no device list - and deleting an account refuses in words, like
  deleting a project. Nothing on it is a placeholder that looks live.
- **A project card's `logline` and `archived_at` are authored columns** (migration `0029`). A
  logline is the writer's sentence about the project; archiving is not trashing - an archived
  project is still live, still openable and still in the ledger, and the two states are two
  columns because a writer may do both.
- **Cut, do not build:** Community, writing leaderboard, activity heatmap. The sidebar credits
  card, once on this list, is built (2026-09-16, the v2 design draws it): the same per-project
  balance the Production header spends, read from the ledger.
- **Presence and the Read button are not built.** The v2 mockups draw presence avatars and a
  `Read` (read-through) button in the writing header; presence needs the realtime that is cut,
  and Read was left out by ruling (2026-09-16).
- **No `short` project type.** `film` and `series` only.

---

## Feature workflow

1. **Locate the route** in `lib/workspace/routes.ts` and read its spec: its paragraph in
   `apps/web/CLAUDE.md` and the route as built. For Production the spec is
   `docs/production/production.md` (v12) with the mockup beside it — click the mockup through,
   never import it; where the two disagree the spec wins.
2. **Check the open decisions table.** If the feature depends on one, stop and ask — do not pick.
3. **Schema first** if the data is new: a forward-only drizzle-kit migration, in the repo. Never
   the Supabase dashboard.
4. **Contract next**: the Zod schema in `packages/contracts`, before anything consumes it.
5. **Pure logic in `packages/script`**, with its tests, before any UI exists. Property-test node
   identity under paste, split, merge and reorder.
6. **Repository function** in `packages/db`, project-scoped.
7. **Server action or route handler.** Every gate is enforced here — scope, allowlist, cost,
   research readability, tenancy.
8. **UI last**, and both states in the same change: populated and empty.
9. **Check both themes** before calling it done.
10. **Run validation.** All of it.
11. **Report** in the style below.

---

## Validation

Run all of these before saying anything is finished:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Scoped runs while iterating:

```bash
pnpm --filter @folio/script test
pnpm --filter @folio/script test --coverage
pnpm --filter @folio/db db:check
pnpm --filter web test:e2e
pnpm --filter @folio/db seed:production -- --user <email>   # a dev project in every Production state, for the walk
```

The signed-in walks are **one Playwright spec per route** — `apps/web/e2e/*-route.spec.ts`, ten of
them — and each **self-skips** without `E2E_EMAIL` / `E2E_PASSWORD`, so a green run proves nothing
unless they were set. They are not optional coverage: they are the thing that catches a route
shipped without its empty state, and no server action has a unit test anywhere.

`e2e/smoke.spec.ts` is **not** that walk and says so in its own header — it is signed-out route
protection and the theme, with nobody logged in.

---

## Communication style

- **Lead with what changed and where.** File paths as clickable links, not prose descriptions.
- **Report test results literally.** If something failed, paste the output. Never describe a
  suite as passing without having run it.
- **Name every assumption you made** and every gap you papered over, at the point you made it —
  not in a footnote.
- **Never call a route done** without both states and both themes.
- **Flag any rule in this file you were tempted to break**, and why. That tension is usually
  information about the spec, and it should reach a human rather than get resolved in a commit.
- No preamble. Do not restate the request back before answering it.
