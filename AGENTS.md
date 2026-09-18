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
| Server state | TanStack Query | Only where Server Components don't fit |
| Validation | Zod, in `packages/contracts` | Every API boundary, shared by web and worker |
| Database | Supabase Postgres | Plain Postgres underneath |
| ORM | Drizzle | Session pooler for the worker, transaction pooler for requests |
| Migrations | drizzle-kit, forward-only | Owned in the repo |
| Auth | Supabase Auth — Google OAuth **and** email + password | `auth.users` is identity; `users`/`memberships` are ours. Confirmation and reset mail goes through Supabase's built-in sender; see Constraints |
| Tenancy | Project-scoped repositories **plus** RLS as defence in depth | Server uses the service-role key, which bypasses RLS |
| Storage | Supabase Storage | Signed URLs for everything |
| Jobs | BullMQ + Redis on a long-running Railway service | |
| Payments | Dodo Payments | Merchant of record; webhooks reconciled idempotently |
| AI | Anthropic API, `@anthropic-ai/sdk` (pinned) | Streaming over a route handler. The assistant panel is a read-only chat over the episode's script (ruled 2026-09-16), and over the whole project on `/characters` (ruled 2026-09-17), `/locations` and `/timeline` (2026-09-18). The Characters drawer's two model actions (`✦ Draft from the script`, `✦ Check for contradictions`, 2026-09-18) use structured outputs (`messages.parse` + `zodOutputFormat`) and write only into an unsaved field or the `character_findings` rows; tool use and proposals are still its next life |
| PDF | `pdf-lib` or `pdfkit` on our own layout engine | |
| FDX | `fast-xml-parser` + custom mapping | |
| Fountain | Custom, in `packages/script` | |
| Fonts | Self-hosted Geist, Geist Mono, Courier Prime | Courier Prime version-pinned - it is the *measured* face (the engine, the cover, the export). Geist is chrome **and** the script body, Geist Mono the counts and refs (the v2 redesign, ruled 2026-09-16, replacing Inter) |
| Tests | Vitest · fast-check · Testing Library · Playwright | |
| Errors / analytics / logs | Sentry · PostHog · pino | |
| Deploy | Railway — `web`, `worker`, `redis` | Private networking between services |

### Adding a dependency requires approval. Every time.

Stop and ask. Name the package, what it does, what it replaces, and its maintenance status.

This is stricter than normal because the **Deliberately not using** list below is a set of design
decisions, not an oversight — and the most tempting additions are precisely the ones that would
silently destroy the product.

**Deliberately not using — do not add these:**

- **Headless Chrome for PDF.** Its text metrics won't match the on-screen sheet, and export must
  agree with pagination exactly.
- **Tailwind's `dark:` variant.** Theme is the cascade under `data-theme`, and islands nest. Use `data-theme`.
- **Tailwind's default `gray` or `slate`.** The palette is one near-black canvas, translucent
  surfaces and a single blue accent, all declared in `packages/ui/src/tokens/palette.css` from
  `docs/ui design/README.md`; a second grey scale beside it is how the look drifts.
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
9. **Read the design bundle before building a route.** Where two bundles disagree on chrome,
   `Route - Script.dc.html` wins.
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
| 2 | The numeric thresholds separating review tiers 1 / 2 / 3 | The whole agent review flow |
| 3 | Whether rename rewrites unlinked prose mentions in action, or only cues, sluglines and `@mentions` | Rename blast radius |
| 4 | ~~The `?lens=` value shape — `lens/<id>` as written, or just `<id>`~~ Moot: Insights was removed with the v2 redesign (2026-09-16). Reopens if a report route returns | — |
| 5 | ~~Whether `/production` is project- or episode-scoped~~ **Ruled: episode-scoped** (`docs/build-decisions.md`, Workspace shell phase) | — |
| 6 | ~~Whether `/build` and `/search` are cut or merely undesigned~~ **Ruled: cut** (`docs/build-decisions.md`, Workspace shell phase) | — |
| 7 | Where project settings `transfer`, `keys` and `episodes` went | Settings |
| 8 | Sheet width for `format: asian` — A4 is ~794px, not 816px | Pagination engine |
| 9 | The `/app/filmmaking` ADR | Anything past a project list |
| 10 | Whether `SCENE_xxx` is a node id or the derived scene record's id. ADR 0001 ruled the latter, in a separate id space — but `packages/script`'s `SceneRecord.id` is implemented as the heading node's own id, so the ADR and the code contradict each other | `?selected=`, any URL naming a scene |
| 11 | The revision colour sequence past green (`nextRevisionColour` refuses at green) | Issuing a sixth revision |
| 12 | Locked-page numbering past the last lock — a judgement call is implemented (the sequence continues unprotected), not ruled | Export, revision compare |
| 13 | Whether an assistant message costs credits, and how much. The panel is real and read-only (2026-09-16) and writes no ledger row; the Characters drawer's `Draft from the script` and `Check for contradictions` (2026-09-18) take the same standing | Charging the assistant; "cost named before it is spent" on its send button and on the two Characters buttons; a rate limit on either |

---

## Architecture

```
apps/web/                    Next.js app. UI and server actions only — no logic that belongs in packages/script.
  app/(app)/                 Signed-in shell: sidebar, theme, avatar. Everything user-facing lives under /app.
  app/(app)/project/         Project workspace: rail, writing sidebar and header, the assistant panel, the nine routes.
  lib/                       Web-only glue: auth session, server action helpers, query client. Not domain logic.
apps/worker/                 BullMQ consumers. Long-running. Generation, export, agent runs. Never a serverless fn.
apps/sync/                   Deferred. Do not create this directory until realtime is actually scheduled.
packages/script/             PURE. Node model, parser, derivation, pagination, Fountain. No React, no DB, no I/O.
packages/ui/                 Primitives, tokens, theme. Presentational only — no data fetching, no domain knowledge.
packages/db/                 Drizzle schema, forward-only migrations, project-scoped repositories. The only place SQL lives.
packages/contracts/          Zod schemas shared by web and worker. Types flow from here; do not redeclare them downstream.
docs/                        ADRs, build-decisions.md, roadmap.md. Design bundles (*.dc.html) are read-only reference.
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
- `:episodeId` shares a path position with the project-scoped names. Validate every episode id
  against `characters`, `locations`, `timeline`, `research`, `insights`, `production`,
  `settings`, `assets`, and keep ids to the `ep_NNN` shape. Static-first precedence saves this
  tree by accident; do not rely on it.
- `projectType: 'film'` **hides** the episode segment. The database still stores one episode row.
  The router special-cases the shape; the schema never does.
- Rail order is fixed (`docs/ui design/README.md`, "Rail"): Writing · Characters · Locations ·
  Timeline · Research · Production. Writing stays lit across all four writing routes. Insights
  was removed with the v2 redesign (2026-09-16); its name stays reserved.
- The writing sidebar lists **Script · Storyboard · Outline · Scenes** (ruled 2026-09-17, reversing
  2026-09-16: the header's Write / Storyboard mode pill is gone on every route, Storyboard is a row
  under Script). The header's centre is the **current route's sub-views** - `?view=` tabs, each its
  name beside its icon where the design draws one (`lib/workspace/views.ts`); a route with one view
  has an empty centre. Route toolbars do not draw a second view switcher.
- The rail's Characters icon navigates to `/characters` from every route (re-ruled by the client
  2026-09-16; the writing mockups' 330px peek overlay was built in the first shell pass and
  removed).
- Characters' `Cast · Relationships · Sheet` tabs are **not** `?view=` (ruled 2026-09-16, the
  Script route's precedent): the URL stays `/characters`, the view is React state in the route's
  layout. The Storyboard's `Boards · Canvas · Shot list` and Scenes' `Cards · Index cards · Scene
  list` took the same ruling on 2026-09-17: the URL stays `/storyboard` or `/scenes`, the view is
  a client cell the header and the body share. Locations' `Places · Scenes here · Sheet` took it
  on 2026-09-18: the URL stays `/locations`, the view is React state in the route's layout
  (`_locations/view-state.tsx`). See the exception table.

### UI fidelity

- **The design package is the spec.** `docs/ui design/README.md` and the nine `Route - * v2.dc.html`
  mockups (2026-09-16). Its `:root` token block is `packages/ui/src/tokens/palette.css`, copied
  verbatim; the older token names alias onto it until every route is rebuilt. **Two exceptions:
  ruled 2026-09-17, `Route - Characters v2.dc.html` no longer binds the Characters route** - the
  client retired it (too close to laper.ai, visually weak, not useful); the route is being rebuilt
  in four phases to a written plan, recorded pass by pass in `docs/build-decisions.md`
  ("Characters rebuild") - **and ruled 2026-09-18, `Route - Locations v2.dc.html` no longer binds
  the Locations route** (the same audit found the same shape; "Locations rebuild" in
  `docs/build-decisions.md`). The README's language, tokens and patterns still apply on both.
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
  did (`docs/build-decisions.md`, "Bible route removed").
- Empty meta follows a convention: things that legitimately count to zero show `0`; things that
  either exist or don't show `—`; the script says `empty`.
- Project cards show **real derived metadata** — episode, scene and page counts, last edited —
  never a placeholder string. If a project has no script, the card says so.
- Theme is `dark` by default, via `data-theme`. Revision colours (White → Blue → Pink → Yellow →
  Green) are industry artefacts, not palette tokens, and must survive a theme switch intact.
- Specified copy is specified. The design README's tone: "Plain, specific, lower-case-leaning.
  Labels say what happens: 'Draft from the script', 'It's deliberate', 'Not on the page yet'. No
  exclamation marks, no emoji, no feature marketing." Paraphrasing a specified label breaks the
  argument the screen is making.

### The AI agent

- One assistant, reachable everywhere. The orb in every header opens a **400px panel** (the
  README's; in flow at ≥1200px, over the content below), `⌘J` toggles it, and it persists across
  route changes. It is not a route. Today it is a **read-only chat** over the episode's script
  (`apps/web/lib/assistant/`, `assistant_chats` / `assistant_messages`, migration `0016`): it
  reads, it answers, it writes nothing. On `/characters` it reads the whole project and, with a
  record open, a Focus block for it (ruled 2026-09-17); on `/locations` the location records
  beside the cast (2026-09-18); on `/timeline` every scene's story time, its threads and the
  continuity check's open findings, with the drawer's scene as the Focus (the Timeline rebuild,
  2026-09-18). The Characters drawer's two model actions
  (2026-09-18) are the first steps past the chat and stay inside the rule below: `Draft from the
  script` lands two or three cited sentences in an **unsaved** field the writer keeps with Save,
  and `Check for contradictions` returns pairs of quotes that are kept as rows the writer waves
  through or not (`character_findings`); neither edits a node, and a draft that cites no scene it
  was shown is refused. The lifecycle below is where it goes next.
- Lifecycle: **Brief → Plan → Run → Review → Commit.** One run produces one revision entry.
- **Every write returns a proposal, never a mutation.** Proposals are anchored to node ids and
  rendered as hunks against current node state.
- **The approved plan is the allowlist.** A run may only write the surfaces its plan declared,
  enforced server-side. Client-side checks are decoration.
- **Locks are objects, not prose**: node, cast, outcome, heading, range. A plan that cannot
  succeed without violating one is rejected at planning time.
- **Parser parity** — agent output is parsed exactly like typed text. Ambiguous cues surface in
  the diff as merge / create / alias.
- ~~**Canon pre-flight** — bible conflict checking runs against proposed nodes, before review.~~
  No source for this since the Bible route was cut 2026-09-15 (`docs/build-decisions.md`, "Bible
  route removed") — there is no `canon` status left to check against.
- **One context gate, enforced server-side in the context builder, never in the UI**: the
  per-source research `readable` toggle. (A second gate, bible entry status, existed while the
  Bible route did.)
- A **lens** is four things: a system prompt, a tool allowlist, a readable-source list, and an
  output shape. The allowlist renders to the user as monospace chips, so a read-only lens is
  visibly read-only regardless of what its prompt says.
- **Every lens note cites its sources. A note that cannot cite one is not rendered.**
- **A report never calls a model.** Reports are arithmetic over the node list and derived
  entities. Asking a model to count is slower, costs money, and is less accurate than the code it
  replaced.

### Jobs, credits and cost

- Long-running work is a **job** on the worker: status, cost, cancellable, resumable, survives a
  closed tab.
- **Cost is named before it is spent**, on the button, per frame and per reel.
- **Reserve then execute.** The balance check happens *before* the job is enqueued, never inside
  it.
- The credits ledger is **append-only** and the balance is **computed, never stored**.
- **Failure refunds.** Every generation row links to its job and, on failure, to its refund
  ledger entry.
- `blocked` means moderation refused a shot, and it must show **the refusal reason in the
  writer's terms**.

### Tenancy and data access

- Every table carries `project_id`. Every query is tenant-scoped.
- **Every query goes through a project-scoped repository.** The server uses the service-role key,
  which bypasses RLS entirely — RLS is a safety net, not the mechanism.
- **The service-role key must never reach the browser.** Same for Dodo keys.

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
database columns. Episode ids are `ep_NNN`. Scene ids: open decision 10.

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
| Characters' `cast \| presence \| sheet` | Ruled 2026-09-16 (the client; Presence replaced the Relationships graph 2026-09-18): switching must be instant and the URL must stay `/characters`, as the Script's switches were ruled 2026-09-11 | React state in the route's layout (`_characters/view-state.tsx`), so it survives opening the drawer; `?view=` is an unknown key there |
| the Storyboard's `board \| canvas \| list` | Ruled 2026-09-17 (the client): the same ask - a tab must switch smoothly and the URL must stay `/storyboard`; as a param each click re-ran the page's server read | A client cell the header's tabs and the workspace both reach (`_storyboard/view-state.tsx`, the `coverage.ts` shape - the shared writing layout cannot host one route's provider); resets to the board when the workspace unmounts; `?view=` is an unknown key there |
| Scenes' `cards \| index \| list` | Ruled 2026-09-17 (the client): the same ask again, in the same words - smooth, and the URL must stay `/scenes` | The Storyboard's cell shape (`_scenes/view-state.tsx`); the route's own client `<main>` (`_scenes/scenes-main.tsx`) writes `data-sub-view` and resets the cell to the cards on unmount; `?view=` is an unknown key there |
| Locations' `places \| scenes \| sheet` | Ruled 2026-09-18 (the client), with the rebuild: the same ask, and the URL must stay `/locations` | React state in the route's layout (`_locations/view-state.tsx`, the Characters shape - the route has a layout of its own), so it survives opening the drawer; `?view=` is an unknown key there |
| the Timeline's `story \| chrono \| continuity` | Ruled 2026-09-18 (the client), with the rebuild: the same ask, and the URL must stay `/timeline` | React state in the route's layout (`_timeline/view-state.tsx`, the Locations shape), beside the selected scene and the solo thread - the drawer is not a path (open decision 10); `?view=` is an unknown key there |
| which document the Script shows, the title-page or the script | Component state (ruled 2026-09-11); a scene the sidebar scrolls to is a `#n-<node id>` fragment, never `?selected=` | Not a param |

### The agent may write anywhere — except

| Surface | Reason | Rule |
| --- | --- | --- |
| Research | Source material must stay trustworthy | Read-only |
| ~~Bible~~ | Route cut 2026-09-15 (`docs/build-decisions.md`, "Bible route removed") | — |
| Settings, people, billing, keys, export | Not creative surfaces | Never |

### Every route ships both states — no exceptions

There is no case where an empty state is optional. A new project is entirely empty states.

---

## Constraints — what this version deliberately does not do

- **No transactional email provider — but email sign-in exists.** Auth is Google OAuth **and**
  email + password, with address confirmation and password reset both delivered by **Supabase
  Auth's own built-in SMTP sender** — rate limited project-wide to a handful of messages an hour,
  and documented by Supabase as unsuitable for production. That cost was named and accepted, not
  discovered; full history in [docs/build-decisions.md](docs/build-decisions.md), "Auth phase:
  email sign-in, and what it cost." The sender is reachable only through Supabase's own auth
  templates — the app has no way to compose mail — so every consequence below still holds:
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
  `apps/sync` are deferred; do not scaffold them.
- **`/app/filmmaking` is a project list and a creation entry point. Stop there.** It needs an ADR
  first. A project with no Writing section is a generation surface with no script behind it, and
  "the screenplay is the source of truth" stops holding.
- **Project `/settings` is a stub.** No design exists.
- **Cut, do not build:** Community, writing leaderboard, activity heatmap. The sidebar credits
  card, once on this list, is built (2026-09-16, the v2 design draws it): the same per-project
  balance the Production header spends, read from the ledger.
- **Presence and the Read button are not built.** The v2 mockups draw presence avatars and a
  `Read` (read-through) button in the writing header; presence needs the realtime that is cut,
  and Read was left out by ruling (2026-09-16).
- **No `short` project type.** `film` and `series` only.

---

## Feature workflow

1. **Locate the route** in the route document and read its design bundle. Where two bundles
   disagree on chrome, `Route - Script.dc.html` wins.
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
pnpm --filter @folio/script test -- --coverage
pnpm --filter @folio/db drizzle-kit check
pnpm --filter web test:e2e
```

The E2E smoke test walks all nine routes in both themes and both states. It is not optional
coverage — it is the thing that catches a route shipped without its empty state.

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
