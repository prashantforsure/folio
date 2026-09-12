# Build decisions

Running record of decisions that are too small for an ADR but too consequential
to leave in a commit message. ADRs live in [`docs/adr/`](./adr/).

## Pagination: two modes and a cadence flag

`pageMode: paged | continuous` plus `liveRepaginate: boolean`. Both live per
project; neither is in the URL. That is AGENTS.md's shape and it is now
implemented in [`paginate.ts`](../packages/script/src/paginate.ts) as
`PaginationOptions`.

The design bundle disagrees, and the disagreement is the interesting part.
[`Route - Script.dc.html`](./ui%20design/Route%20-%20Script.dc.html) exposes
`pagination` as a three-value enum — `minimal | paged | live` — rendered as a
three-way segmented control with a note under each:

| bundle value | note in the bundle |
| --- | --- |
| `minimal` | No page breaks drawn |
| `paged` | Printed page breaks |
| `live` | Repaginates on every keystroke, including collaborators'. Heavier on long drafts. |

Read the notes rather than the labels and the third one is not a peer of the
other two. `minimal` and `paged` describe **what the engine computes**: whether
the sheet is divided into pages at all. `live` describes **how often the caller
runs it**. Its note does not say what the page looks like; it says how much work
it is. That is a cadence, and it composes with the other two rather than
excluding them.

### Why three peer modes would be wrong in the model

Three values in one enum makes two claims that are both false:

1. **That `minimal` and `live` are mutually exclusive.** They are not. A writer
   who wants no page breaks drawn *and* wants derived counts kept current on
   every keystroke is asking for a coherent thing, and a three-way enum cannot
   express it. The two-plus-a-flag shape has four states and all four are
   meaningful.
2. **That switching to `live` changes the output.** It does not. Same nodes,
   same format, same measurement record — asserted directly in
   [`paginate.test.ts`](../packages/script/src/paginate.test.ts): *"liveRepaginate is a
   cadence flag: it changes nothing but its own field."* If it were a rendering
   mode it would have to change something.

The three-way enum is right for the control the writer sees — one row of three
buttons, one choice, which is a good control. It is a **design-file prop**, and
mapping it to the model is the UI's job at the boundary:

| bundle prop | `pageMode` | `liveRepaginate` |
| --- | --- | --- |
| `minimal` | `continuous` | `false` |
| `paged` | `paged` | `false` |
| `live` | `paged` | `true` |

The fourth state — `continuous` with `liveRepaginate: true` — has no button in
the current design. It is representable, which is the point; a model that could
not represent it would have to be widened later, and widening the model is the
expensive direction.

### Why `continuous` is a mode and not a second engine

In the engine, `continuous` is the same walk with an unbounded page: one
constant, `capacity`, is either `sheet.linesPerPage` or infinity. Every break
rule, every measurement, every eighth is the same code. That is the test of
whether something is a mode — if `continuous` needed its own layout pass, the
two would drift and the sheet the writer sees in minimal mode would stop
agreeing with the one they print.

Eighths in particular are still computed in `continuous`: a scene's length in
eighths is a property of the sheet, not of whether the breaks are drawn, so the
Scenes route shows the same `2/8` in either mode.

### What is per project and what is not

Per project, and not in the URL. AGENTS.md's *Sub-views are query params —
except* table already rules this and gives the reason: it is not a sub-view, it
is a rendering preference the whole project shares.
`packages/script` does not know where they are stored. It takes them as inputs,
carries them on the measurement record so a consumer can see what produced it,
and consults exactly one of them.

## Pagination: results go on a measurement record, never on a node

Not a decision so much as AGENTS.md enforced twice more. `paginate` takes
`readonly ScreenplayNode[]` and returns a `MeasurementRecord` whose per-node row
is `{ id, type, runs, lines }` — ids, never nodes. There is no expression in the
engine that has a node to write to, which is the structural version of the rule
rather than a promise about it.
[`type-guarantees.test.ts`](../packages/script/src/type-guarantees.test.ts) holds the
compile-time proof; `read.ts` still rejects a page number at the wire.

## Pagination: the golden page maps are a contract, not a snapshot

[`src/testing/golden/us-letter.json`](../packages/script/src/testing/golden/us-letter.json)
is checked in and is what the PDF exporter will have to reproduce. It is
deliberately **not** a Vitest snapshot: `vitest -u` rewrites a snapshot as a side
effect of a test run, which is precisely the property a contract must not have.
On a mismatch the test prints the complete replacement file to stdout and fails;
a human pastes it in and commits it as its own change, so the diff is read
before it is accepted.

There is no golden map for `format: asian`, and that absence is asserted. See
below.

## Open, and blocking

**AGENTS.md open decision 8 — the sheet width for `format: asian`.** A4 is
793.7px at 96dpi; the design bundle draws one 816px sheet for both formats and
changes only the label. `resolveSheet('asian')` **refuses**, returning the two
candidate widths as evidence and neither as a choice. Nothing downstream has a
default to fall back to, so an unruled A4 cannot silently paginate at Letter
width. Everything else about the format is wired: it is an engine input, the
record carries it, the golden maps are per format.

**Lines per inch — 12 or 6.** AGENTS.md says "12 lines per inch"; the design
bundle draws the sheet at `font-size:16px;line-height:16px`, which is 6 at
96dpi, and lays its blank gaps out in 16px and 32px steps to match.
[`docs/ui design/README.md`](./ui%20design/README.md) lists this as one of its two
open rows. The engine implements **12, as AGENTS.md writes it**, in one constant
(`LINES_PER_INCH` in [`sheet.ts`](../packages/script/src/sheet.ts)); nothing else
hard-codes a line count, and the golden maps regenerate in one step. It moves
the page count for a feature by roughly a factor of two, so it needs a ruling
rather than an inference.

**Locked-page numbering past the last lock.** AGENTS.md says locked pages must
not renumber and puts changing that behaviour behind an explicit decision. What
it does not say is what happens to pages *after* the last locked one.
[`revision.ts`](../packages/script/src/revision.ts) continues the sequence there —
new paper at the end of the script becomes 105, 106, not 104A, 104B — because
there is no later number left to protect. Pages between two locks do take
A-page suffixes. Both halves are implemented; the second half is a judgement
call and is flagged as one. Collisions and missing anchors are reported on the
record as `lockIssues` rather than resolved.

**The revision sequence past green.** `nextRevisionColour('green')` refuses.
The industry sequence continues into goldenrod, buff, salmon and cherry, but
AGENTS.md names five and puts the sequence behind an explicit decision, so a
sixth is not invented here. A production reaching a sixth revision is a real
thing that will happen and it needs a ruling.

## Schema phase: judgement calls that are not ADRs

Written down here because each is a decision somebody could reasonably have made
differently, and none is big enough for its own ADR. Episode identity *was*,
and is [ADR 0002](./adr/0002-episode-identity.md).

### The node order key is text, not a number

Appendix A of the design handoff sketches node ordering as
`order: number  // fractional index, so insert never renumbers`. The idea is
right and the carrier is wrong. Repeatedly inserting between the same two
neighbours halves the gap each time, and a double runs out of mantissa after
roughly fifty splits at one point — a writer breaking the same paragraph over
and over will get there. When they do, the two keys compare equal and document
order becomes whatever the index feels like. **Document order is the one thing
AGENTS.md says the script actually is**, and the failure is silent.

So the key is base-62 text compared lexicographically
([`order.ts`](../packages/db/src/order.ts)): between any two distinct strings
there is always another, because a string can always get one character longer.

The alphabet is in ASCII order and the column is plain `text`, so Postgres and
JavaScript sort it identically. **If an index on `order_key` ever gets a
collation, it must be `"C"`** — a locale-aware collation sorts `a` before `B`
and breaks the invariant.

Flagged rather than settled: the appendix says `number`, and nobody has ruled
this specific point.

### Comment threads are `comment_threads`, not `threads`

The brief for the schema phase says "Threads with FOUR ANCHOR KINDS". Appendix A
already uses `Thread` for a different entity — the Timeline's story threads,
`Thread { id, projectId, name, color, episodeIds[] }` — and `SceneAuthored.threads`
in `packages/script` refers to *those*. Two different things called `threads`
in one schema is a bug waiting for whoever writes the Timeline route.

So comment threads are `comment_threads` and `thread_comments`, leaving
`threads` free for the Timeline entity. This renames what the brief asked for,
which is why it is recorded here.

### `users` is the one table without `project_id`

AGENTS.md says every table carries `project_id`. `users` cannot: a person exists
before they belong to a project and belongs to many, so the column would be null
or a lie. AGENTS.md's own stack table is what forces this — "`auth.users` is
identity; `users`/`memberships` are ours" — a users table is *for* the thing that
spans projects.

The exception is enforced rather than documented. `users` has no such column, so
it is not assignable to `ProjectScopedTable` and cannot be passed to a scoped
query at all; [`scope-guarantees.ts`](../packages/db/src/scope-guarantees.ts)
asserts that it does not compile. Reads of it live in
[`repositories/users.ts`](../packages/db/src/repositories/users.ts), where every
function takes the `UserId` it filters on.

### A thread has many comments

Appendix A models a note as one immutable `body`. The brief says "threads", and
the Notes route is described as an inbox of open/mine/resolved comments. A thread
with one body is not a thread, so the body is a second table. **Nobody has
specified reply behaviour** — whether a reply can be edited, whether the first
message is special, what a resolved thread does with a new reply — and none of
that is decided.

### Two columns need an argument for existing at all

AGENTS.md's "nothing is stored that can be computed" exception table says its
list is complete. Two columns are not on it and are not obviously derived:

- **`versions.node_count`.** A snapshot is immutable, so this is a property of a
  frozen artefact and cannot drift from it. It exists so the version list renders
  without deserialising a feature-length node list per row.
- **`revisions.lines_added` / `lines_deleted`.** These describe the diff between
  two frozen snapshots, so recomputing can only ever return the same answer at
  the cost of materialising two node lists.

Both are measurements of immutable things rather than caches of live data. If
that reasoning is rejected, the replacement for the second is a view over the two
versions.

### Storyboard shot anchors have no foreign key

`comment_threads.anchor_shot_id` is a bare `uuid` with nothing behind it, because
shots are not a table. The fourth variant of the anchor union is modelled anyway
— widening a union after rows exist is the expensive direction. Closing the gap
is one forward migration and one brand.

## Open, and blocking — added by the schema phase

**The `SCENE_xxx` contradiction.** [ADR 0001](./adr/0001-node-identity.md) Ruling
3 says `SCENE_xxx` is the derived scene record's id, "in a different id space"
from node ids, and its Consequences say a node id "appears in no URL".
`packages/script`'s `entities.ts` then made `SceneRecord.id` **be the heading
node's id**, deliberately, so that moving a scene does not detach its synopsis.

Both cannot hold. Either a scene record's id is a node id and node ids do appear
in URLs, or a scene needs a second minted id and the ADR's separate id space is
real. `packages/contracts` codifies neither — there is no `SceneRecordIdSchema`,
and `scenes.scene_node_id` is the node id, matching the implemented core. It
becomes a real problem when the Scenes route needs a URL.

**Open decision 7 — `transfer`, `keys`, `episodes`.** No table for any of them.
`episodes` ships regardless because it is core rather than a settings sub-route;
`project_transfers` and `project_api_keys` are not invented. Every question they
raise — key scope, rotation, who may transfer, what happens to the ledger on a
transfer — is unanswered.

**Membership roles are stored and enforced nowhere.** `memberships.role` holds
`owner | writer | reader`. Nothing reads it: not the repositories, not the RLS
policies, which check membership only. AGENTS.md, Development philosophy 5 puts
enforcement in the server action, and there are no server actions yet — so the
column is a placeholder for a capability model nobody has specified.

## Auth phase: email sign-in, and what it cost

**Ruled by the client, not inferred.** AGENTS.md's Constraints section said "No email provider.
Therefore: Google OAuth only, no password accounts, no magic links, no email confirmation." The
client overrode it and asked for Google OAuth **and** email login.

The question put back before anything was built was which of three email logins was meant, because
without a provider they are three different products:

| Option | What it costs |
| --- | --- |
| Password, **no** confirmation and **no** reset | Zero email, zero dependency. A forgotten password is a permanently dead account; an unverified address is not an identity, so anyone can register somebody else's, and email cannot be used for invites or dedupe |
| Magic links | Do not function at all without transactional email. Not a deviation from the constraint — a reversal of it: a provider, an API key, custom SMTP, and a deliverability surface to own |
| **Supabase's built-in SMTP** ← chosen | No dependency, works today. Rate limited project-wide to a handful of messages an hour, from Supabase's own address, with poor deliverability, and documented by Supabase as unsuitable for production. It degrades **silently** — the symptom is "the link never arrived" |

### What was built

Google OAuth, plus email + password with address confirmation and password reset, both delivered by
the built-in sender. Magic links were **not** built: they would make the rate-limited sender
load-bearing for every sign-in rather than for the rare recovery, so one throttled hour would lock
out every email user.

### Where the cost is visible

Not buried. `apps/web/lib/auth/actions.ts` detects the rate limit and says what it is — that Folio
sends through Supabase's built-in email, that it is rate limited, and to wait an hour or use
Google. "Please try again" is wrong advice for a limit measured in hours. The sign-up and
forgot-password pages say the mail is slow *before* the form is filled in, rather than after it is
submitted.

### What this does not change

Everything downstream of "no email provider" still holds, and AGENTS.md, Constraints now says so
explicitly: no asynchronous notification of any kind, job completion in-app only, team invites as
share links copied by the inviter. The built-in sender is reachable only through Supabase's own
auth templates; the application has no way to compose a message.

### The unresolved part

**Nobody has decided what happens at production scale.** The rate limit is not a development
inconvenience that disappears on deploy — it is the same limit in production, and it is reached by
a few dozen sign-ups an hour. The options are a real provider through Supabase's custom SMTP
setting (a dependency decision *and* a product one, because it unlocks the notification surface
that is cut), or accepting that email sign-up is throttled. This needs a human before launch, not
before the next phase.

## Auth phase: `pageMode` and `liveRepaginate` still have no home

AGENTS.md's exception table puts them **per project**, which is a database row shared with
collaborators. The schema phase did not create one, and this phase did not either — a migration is
a question (AGENTS.md, When to ask first).

The trap is that the schema *looks* like it has a home. `measurements.page_mode` and
`measurements.live_repaginate` exist, and they are a different thing wearing the same name: a
measurement is the **output** of `paginate()` for one document under one format under one mode, and
`page_mode` is part of `measurements_document_format_mode_key`. A project with two measurements has
two values and no rule for which wins; a project that has never been paginated has none.

So the next person to wire the toggle will find the column, use it, and ship something that works in
development — where there is one measurement — and reverts to the wrong mode in production the
first time a project is measured at a second format.

`apps/web/lib/state/project-preferences.ts` is where this is written down, next to the types, with
the three design questions underneath it: whether the row is a `project_preferences` table or two
columns on `projects`; whether it is really per project or per project per episode (AGENTS.md says
project, the Script bundle draws the control inside an episode); and who may change a setting that
is shared with collaborators, given that `memberships.role` is stored and read by nothing.

**Do not solve it with a Zustand field or a localStorage key.** Either makes the setting
per-person, and two writers on one script then disagree about how many pages it is.


## Shell routes phase: judgement calls, and one edit to a past migration

### `projects.kind` was renamed to `project_type`, and `kind` now means screenwriting or filmmaking

The `/app/new` brief collects three axes - `kind: screenwriting | filmmaking`,
`projectType: film | series`, `format: hollywood | asian` - and AGENTS.md's own
word for the film-or-series axis is "project type" (Routing, Constraints). The
schema phase had named that column `kind`, after the design handoff's Appendix
A. Migration `0002` renames it and adds the other two columns; the SQL is
hand-written as a rename because drizzle-kit's generated diff re-typed the
column through a cast that fails on any existing `film` or `series` row. The
snapshot is drizzle-kit's own. `format` is on the project, not the episode, so
every episode of a series is measured at one sheet width.

### Migration `0000` was reordered, before it had ever been applied anywhere

The first attempt to apply the migrations to a real Postgres failed inside
`0000`: drizzle-kit writes every foreign key before every index, and the
composite key `nodes (document_id, document_kind) -> documents (id, kind)`
references a unique *index* created sixty statements later. Postgres refuses
with "there is no unique constraint matching given keys for referenced table".
The one `CREATE UNIQUE INDEX` was moved ahead of the FK block. This is an edit
to a past migration and forward-only forbids that in general; it is recorded
here because the file had never been applied to any database (the dev
project's `__drizzle_migrations` was empty and the failed attempt rolled back),
and because as generated it could never have been applied anywhere. `db:migrate`
reports this class of failure as a bare exit 1 with no message; the error was
found by running `drizzle-orm`'s migrator directly.

### The migrations are now applied, to the development Supabase project

All three, in order, during this phase. The project also has one auth user,
`folio-e2e@example.com`, created through the admin API for the signed-in
Playwright walk. Both are recorded so nobody rediscovers them.

### Creation writes one episode row, titled after the film or `Episode 1`

The brief specifies the row, not its title. A film is one document, so its
episode carries the film's title; a series' first episode is `Episode 1` until
the episode board renames it.

### A filmmaking project opens on its list

Open decision 9. Which route a filmmaking project lands on is the substance of
the missing ADR, so `workspaceHref` sends it back to `/app/filmmaking` rather
than presuming a `script` route. When the ADR lands, that is the one branch to
change.

### Project cards: what is read, and from where

`episodes` from `episodes`; `script` from `documents`; `scenes` from
`scene_derivations` where present; `pages` from `measurements.total_pages` at
the project's format in `paged` mode, `null` when unmeasured; `lastEditedAt` as
`greatest(projects.updated_at, max(documents.updated_at))`. The episode count
is shown for a series only. Assembled by one query, `listProjectsFor`; the
component computes nothing. No grid/list toggle and no sort control, because
each is a sub-view and a sub-view is a query param, which is behind a question.

### Account settings: credits are per project, and there is no account ledger

`credit_ledger` carries `project_id` like every table. The settings page shows
each project's balance from `readBalance` and a sum labelled as a sum. If
credits are meant to belong to a person, that is a ledger with a `user_id` - a
schema change and a credits decision. Profile is display only: the
`folio_sync_auth_user` trigger rewrites `display_name` from the auth claims on
every `auth.users` update, so an edit here would not survive a sign-in. Plan
and billing show `—`; nothing is wired to Dodo.

### Purge: proposed, not built

`purgeProject` gates on membership and `owner` role and then refuses. Proposed
semantics, awaiting a ruling: hard delete of the `projects` row with
`ON DELETE CASCADE` taking every content table; `credit_ledger` is
`ON DELETE RESTRICT`, so a project with billing history cannot be hard-deleted
and would keep a tombstoned row; not recoverable; no auto-purge on a timer.
Restore gates on membership only, because `memberships.role` is enforced
nowhere and choosing `owner` here would begin a capability model nobody has
specified.

## Workspace shell phase: three rulings, and what was built on them

**Ruled by the client, not inferred.** Three open items landed on the workspace chrome and were
put back as questions before anything was built.

| Item | Ruling | Consequence |
| --- | --- | --- |
| AGENTS.md open decision 5 — `/production` scope | **Episode-scoped** | `/app/project/:projectId/:episodeId/production` (film: `/app/project/:projectId/production`). Eight episode routes, six project routes. Production is its own rail section; it does not get the episode nav, it gets the README's 250px column |
| AGENTS.md open decision 6 — `/build`, `/search` | **Cut** | Not routes, not reserved. The route tree is fourteen and the smoke test asserts fourteen |
| `assets` in the reserved list | *"keep if it's there in the route"* | Read as: keep it reserved. It is in AGENTS.md's routing rule and in no route tree, so `RESERVED_PROJECT_SEGMENTS` is unchanged, the validator refuses it, and no route is built. Reversible in one array entry |

The evidence for decision 5 was split and is recorded so the ruling can be revisited: the
Production bundle's status bar reads `ep_001/production` (episode), while the README's width table
groups Production with the project routes at 250px and the rail lists it beside them.

### The fourteen

`script outline beats storyboard scenes revisions notes production` (episode-scoped) and
`characters locations timeline bible research insights` (project-scoped). Project `/settings` is
a stub and is not counted. `apps/web/lib/workspace/routes.ts` is the list; `WORKSPACE_ROUTE_COUNT`
is asserted in a unit test and in `apps/web/e2e/workspace-routes.ts`.

### The film shape is two static route trees, not a rewrite

`projectType: 'film'` collapses the episode segment. Next has no optional path segment, so the
collapsed URLs are a second, static tree — `(film)/(writing)/script/page.tsx` and so on — whose
pages are one-liners over the same shell. Static segments win over `[episodeId]`, which is why a
film's `/script` reaches the film tree and a series' `/ep_001/script` reaches the episodic one.
Each page then makes the URL canonical for the project's shape: a film reached through
`/ep_001/notes` is redirected to `/notes`, a series reached through `/notes` to
`/ep_NNN/notes`. The database has one episode row for a film and the schema never branches
(`createProjectFor` writes exactly one row for either type).

### The episode validator is explicit, and it runs at creation too

`parseEpisodeSegment` in `@folio/contracts` checks the reserved list **by name, first**, then the
`ep_NNN` shape. `[episodeId]/layout.tsx` runs it before any lookup. Every episode insert runs the
same function through `assertCreatableEpisodeSlug` in `@folio/db`, and Postgres has
`episodes_slug_shape` underneath both. Static-first precedence would keep `characters` out of
`[episodeId]` for `/characters`; it does nothing for `/characters/script`, which is the URL the
smoke test uses to prove the validator, not precedence, is doing the work.

### Judgement calls in this phase, each reversible

- **"Last opened episode" is a per-project cookie the browser writes.** No table exists for a
  per-person-per-project value and a migration is a question. `lib/workspace/last-episode.ts`.
- **`script.doc` (Script / Cover) is wired as Script's sub-view param.** The README's interaction
  table says a header segment switches a sub-view. The alternative is session state. *Withdrawn
  2026-09-11, Script route phase: the segment is client state and the URL is the bare route.*
- **`insights.lens` accepts both candidate spellings** (`showrunner` and `lens/showrunner`) and
  yields the id, so open decision 4 is not resolved by the parser. It defaults to `showrunner`
  because every param defaults to its first value.
- **`?selected=` is not wired.** Its value shape is the `SCENE_xxx` contradiction above.
- **An unknown sub-view value is a 404**, not silently the default.
- **A script that exists but has never been measured prints `—`**, not `0pp` and not `empty`.
- **Beats count the outline's `beat` nodes; shots are always `—`.** Neither is a table.
- **The bible badge is `0` by construction**: no bible table, so no canon entry to conflict with.
- **The Script bundle draws six nav rows and no Beats.** The brief and AGENTS.md's glyph set say
  seven, with `⋮` Outline and `▥` Storyboard; the six other episode bundles draw `▥`/`▦`. Seven,
  brief glyphs.
- **A film's nav group label is the episode title alone**, without `Ep 1 ·`.
- **`⋯` "Project actions" links to the settings stub**; no menu is specified anywhere.
- **The episode board's open/closed state is component state**, not persisted.
- **The `＋` New episode button is wired** to a server action that refuses for a film. It is the
  one mutation in the chrome and the only way to make the board show more than one row.

## Scenes route phase: one ruling, three upstream bugs, and what the route reads

### Ruled by the client: there is no `/scenes/:sceneId`

Asked, before anything was built, what `:sceneId` in `/:episodeId/scenes/:sceneId` is — the
`SCENE_xxx` contradiction above. The answer was a product decision rather than an id shape: **the
route is `/app/project/:projectId/:episodeId/scenes` only; clicking a scene opens a detail card in
place; nothing navigates.** So scene selection is React component state, `?view=` is the route's
only URL state, and the contradiction is **still open** — side-stepped, not resolved. `?selected=`
on Storyboard still needs it.

### Three bugs found by the first real import, none of them in the route

The brief called this route "the end-to-end proof that derivation and measurement actually work
against a real document". Nothing had been imported through the app before this phase, and the
first feature-length import (`featureLengthScript(220)` from `@folio/script`'s corpus, pushed
through `replaceNodes` → `measureAndDerive` into project `test 1`) found three things in
`packages/db`. Each is fixed where it lives, with a header comment saying how it was found.

1. **`commitDerivation` could not write a scene.** `scene_derivations.scene_node_id` is a foreign
   key to `scenes.scene_node_id`, and nothing created the authored `scenes` row —
   `persistMintedRecords` covers characters and locations, and a scene mints nothing. The first
   derivation over any script with a heading failed the constraint. `ensureSceneRecords`
   (`repositories/scenes.ts`) now runs between minting and commit; `onConflictDoNothing`, so the
   row is created empty once and is the writer's from then on.
2. **`ORDER BY order_key` returned the script in the wrong order.** `order.ts` documents that the
   base-62 alphabet only sorts correctly under `C` collation and says the column must have it; the
   column is plain `text` (migration `0000`), so it takes the database default, which on the dev
   project is `en_US.UTF-8` — locale-aware, `k` before `U`. Every node read came back starting at
   the 3,000th key. Derivation, which reads through the repository, numbered the 220 scenes in
   that order while the measurement record, computed over the list as imported, numbered them in
   the real one, and 172 of 220 cards disagreed with themselves. **Read-side fix:** `byOrderKey`
   in `order.ts`, `COLLATE "C"`, used at every node read. **The durable fix is a forward
   migration putting the collation on the column** so an index or an ad-hoc query cannot fall
   back to the locale. That is a schema change and is left for a ruling; the read-side fix makes
   it safe to wait.
3. **Every derivation pass minted a second `MEERA`.** `derive.ts` binds a cue only by "an exact
   key match against an authored bound cue", and the record it builds for a mint carries
   `boundCues: [mint.cue]`. `persistMintedRecords` wrote the name and not the cue, so the next
   pass found `MEERA` *resembling* an unbound record — the proposal case — and minted a fresh
   one beside it. Three passes, three `ARJUN`s, every scene's cast pointing at whichever one that
   pass had minted. It now writes `character_bound_cues` / `location_bound_sluglines` for the
   minting text, which is what the pure core's own output says exists. Verified: passes two and
   three over the same script mint nothing.

Also seen and not fixed: `measurements.node_digest` is computed over the in-memory list before
the write, and read back after; with bug 2 in place it never matched, and the route's "measured
against an earlier draft" notice would have shown permanently. With the collation fix the round
trip is byte-identical and the digest matches. Worth a test in the Script phase.

### What the route reads, table by table

`lib/scenes/server.ts` is a join and never a computation. Number, heading, I/E, time, dialogue
node count, cast size and cast ids: `scene_derivations`. Cast names: `characters.name` through
`readMentionLabels`. Synopsis: `scenes.synopsis`. Page, page range, eighths, lines on the page:
`measurement_scenes`, on the `measurements` row at the project's format in `paged` mode — the
same row the nav and the project card count from — and `—` on every card when there is none.
The excerpt: the node list, cut at the headings derivation accepted (`lib/scenes/excerpt.ts`,
tested), so a demoted heading stays inside the scene it was in as the text the writer typed.
Scene-typed nodes with no derived row are listed as *not read as a scene*, with the parser's own
reason, and are never a card.

### Judgement calls in this phase, each reversible

- **The bundle's `＋ New scene`, `＋ New card`, drag-to-reorder, "Colour by" and act columns are
  not built.** A scene is never created here; reordering renumbers the script and is a document
  write; acts are not a table; the colour palettes are hexes outside the tokens.
- **`⤒ Export scene report` is not drawn.** Export is a queued job that does not exist.
- **The empty-synopsis button reads "No synopsis yet · write one"**, not the bundle's
  "summarise from the page" with a `✦`. Scene-level AI belongs to a later phase.
- **The view tabs carry no glyphs.** The bundle's `▦ ▣ ▤` are outside AGENTS.md's eighteen and
  `▤` already means Script in the nav. Text only, until someone rules on widening the set.
- **The canvas toolbar is Fit / − / ＋ only**, as text; the bundle's `⌖` select and `✋` pan
  tools have no canvas to act on, and `⛶` has an emoji form. Card zoom is React state, not the
  session store's `zoom`, which is the sheet's.
- **"Show nav" / "Hide nav" is not on the footer.** The episode nav is a layout with no toggle
  wiring in this phase.
- **`N chars` on a card is `scene_derivations.cast_size`** (speaking plus mentioned), titled
  "Cast size"; the bundle titles it "Speaking characters". The chips beside it are the same list,
  so the number and the chips agree.
- **The list view's Status column is `Ready` / `Draft` from whether a synopsis exists**, as the
  bundle computes it. It is a display of authored data, not a stored state.
- **Four type steps were added to the tokens** — 6.5, 7, 16 and 20px — because the Scenes bundle
  uses them and the README's list did not name them. The route's own header is 21px like every
  other, not the bundle's 19px act header.
- **The header title is `Scenes`**, not the bundle's "Scene Board": `ROUTE_TITLE`, the nav and the
  smoke test all say `Scenes`, and the Script bundle wins on chrome.


## Script route phase: eight rulings, and where Slate meets the union

**Ruled by the client, not inferred.** Everything the brief said to stop on was put back as a
question before anything was built, and answered on 2026-09-11.

| Item | Ruling | Consequence |
| --- | --- | --- |
| AGENTS.md open decision 1 — node identity | Treated as **ruled by ADR 0001** (Accepted, delegated, implemented). The table row is still marked open because amending the contract is a separate call | The editor implements head-wins split, first-wins merge, tombstoned delete, preserve-if-absent paste — see below |
| `?panel=collab` | **Threads + revision list, no presence** | The bundle's Collaborators section (`Scene 12 · Dialogue`, `idle 4m`, live dots) is not drawn. AGENTS.md's "no realtime" stands |
| `?panel=composer` | **Not a value.** `panel=info\|collab` only | The composer is a floating window (AGENTS.md; the design file's own `sideTab` prop agrees). The footer button is drawn as the bundle draws it and disabled. `?panel=composer` is a 404 |
| Comment node authoring | **`⌘7` / the type bar only.** Enter at the end of a comment creates an Action; Tab never cycles into Comment; no `[[` shortcut | `lib/script/keyboard.ts`, as `Record<ScreenplayNodeType, …>` tables |
| Lines per inch | **Six.** AGENTS.md's "12 lines per inch" is superseded | `LINES_PER_INCH = 6` in `sheet.ts`; the golden page map regenerated (58 → 115 pages for the feature corpus). See below |
| Dependencies | **`platejs@53.3.11`** (one package; bundles Slate) and **`fast-xml-parser@5.11.1`**, both in `apps/web` only | No other `@platejs/*` package. `packages/script` still has zero dependencies |
| Migration `0003` | **`projects.page_mode` + `projects.live_repaginate`**, per project, any member may write | The pair AGENTS.md's exception table specifies finally has a home. `lib/state/project-preferences.ts` is the control ↔ model boundary |
| `?doc=cover` | **A `title_pages` table**, one row per episode, Fountain's title-page keys as columns, editable | Part of migration `0003`. Not a `documents` row: it has no node list |

### Lines per inch: why the sheet forced the ruling

The engine was at 12 (AGENTS.md's figure) and the bundle at 6 (`font-size:16px;line-height:16px`
on a 96dpi sheet). Until a sheet was drawn the disagreement was a page-count question. Drawing one
made it a rendering impossibility: 12pt Courier is 16px tall, and on a 12-lpi grid the glyphs
overlap, or the page is 1920px tall, or the visual line count disagrees with the record. Six is
the industry single-spaced metric (54 lines to a Letter page) and what the bundle draws. The
constant moved, `sheet.test.ts` asserts six, `paginate.test.ts` had its page-relative literals
rewritten against `LINES_PER_PAGE`, and the golden regenerated with a 346-/289-line diff that was
read before it was pasted in. **AGENTS.md still says twelve; amending it is a separate call.**

### Where Slate's shape meets the union, and what stops them drifting

`apps/web/lib/script/slate-model.ts` is the whole of the contact. `toSlateValue` runs on load,
`fromSlateValue` on save, and the second goes through `readScreenplayNode` — the strict wire
reader in `@folio/script` that refuses an unknown type, an unknown field, a pagination field, an
empty or duplicate id. A shape Plate introduced cannot be saved; the save refuses and the banner
names the defect. `ScriptElement.type` is `ScreenplayNodeType`, not `string`; the eight block
plugins are built from `SCREENPLAY_NODE_TYPES` so the list cannot be longer or shorter than the
union; every keyboard table is a `Record` over the union. **Plate's core `NodeIdPlugin` is off**
(`nodeId: false`) — it would mint `nanoid(10)` ids on split and paste — and
`lib/script/identity.ts` on `editor.apply` is the only minter, replaying ADR 0001 at the one door
every Slate transform, undo, redo and paste goes through. Tested headless in
`apps/web/tests/script-identity.test.ts`.

### Pagination on the sheet

The record is the server's. `loadScript` runs `paginate` over the rows it is about to render and
`saveScript` runs it again and stores it; the client never invents a page. The sheet is one
contiguous editable, so a page is not a box blocks live in: `lib/script/layout.ts` turns the
record into each block's top margin (including the jump across a page boundary), a gap inside a
split block carrying `(MORE)` and the continued cue, and absolutely positioned page frames behind
the flow. Blocks are `white-space: pre` and never wrap on their own — the line ends are the
engine's, computed by `lib/script/lines.ts` (the same algorithm as `wrapText`, walked with editor
offsets) and drawn as decorations. `script-lines.test.ts` asserts exact agreement with `wrapText`.
`liveRepaginate` runs the same `paginate` in the browser on every change; the server's record
replaces it on the next save.

### Ruled by the client, later the same day: the tabs leave the URL

The brief specified `?doc=script|cover` and `?panel=info|collab`, and both were built as query
params - first as navigations, then (a first ruling that a tab click "must not leave the route")
as `history.pushState` with the workspace reading `useSearchParams` back. The client then ruled
again, on seeing it: clicking Cover, Info or Collaboration must be instant **and the address must
not change** - "on the URL it's still `/script`, not `/script?doc=cover`" - and the same for
Pagination and Format in the panel.

So the Script route now has **no sub-view params**. `SUB_VIEW_SCHEMAS.script` is `z.object({})`;
`?doc=` and `?panel=` are unknown keys, ignored like `?content=`, never a 404. The design README's
URL-shape table already wrote the route as the bare path, and its state table already put
`rightPanelTab` in session; the brief's `?panel=` was the override, and this withdraws it.

| Switch | Where it lives now | Why there |
| --- | --- | --- |
| `▤ Script / ▣ Cover` | Component state in `script-workspace.tsx` | The route opens on the script; the cover is looked at and left. Same reading as the Scenes ruling: selection is state, not a URL |
| `Info / Collaboration` | `useSession().sideTab` | Where AGENTS.md's exception table ("panels ... session state") and the README always had it; survives Outline and back, dies with the tab |
| Pagination, Format | The project row, applied ahead of the write | See the judgement call below |

What it costs: a cover cannot be linked to. Nothing in the product linked to one, and the
`title_pages` row is reachable from the tab in one click. What it keeps: both sheets stay
mounted, the one not showing `hidden`, so the Plate editor's state and a pending autosave survive
a look at the cover. The tabs are `<button role="tab">`, not links (`_script/view-tab.tsx`); the
`data-sub-*` attributes on `<main>` are gone with the params, and `data-doc-tab` /
`data-panel-tab` carry the state for the walk.

### Judgement calls in this phase, each reversible

- **Autosave is 1.5s after the last change; a `versions` snapshot is requested at most every five
  minutes and on `⌘S`.** Nothing specifies either cadence.
- **Saves write only the rows that changed** (`reconcileNodes`: longest-increasing-subsequence over
  existing order keys, re-keying the rest). `replaceNodes` is kept for import.
- **`⌘1`–`⌘8`, not bare digits**, as the bundle writes them; a bare `3` in dialogue is a `3`.
- **The Format control is live** (writes `projects.format`); **the Project type control is
  shown disabled** — film ↔ series reshapes every URL and is not a panel toggle.
- **`?content=` is not a param.** `empty` is `loadScript` finding no document. Unknown keys are
  ignored, so a stale `?content=empty` link is neither honoured nor a 404.
- **The Info panel's Pagination and Format controls move the sheet before the row is written.**
  The workspace keeps the row's three settings as it last knew them, re-paginates in the browser
  with the new one on the click (the same `paginate` the live mode runs), and calls the action
  behind it; a refused write snaps the setting back and the panel says why. The two actions no
  longer `revalidatePath` - that re-ran `loadScript` over every node for a one-column update, and
  the client did not apply the returned measurement anyway (it is seeded once). The stored
  measurement is re-cut on the next save, as before. `lib/state/project-preferences.ts` still
  forbids a per-person copy of these; what the workspace holds is the row, ahead of a write.
- **In `continuous` mode the server also computes the `paged` record**, because the bundle's copy
  says the page count stays live in minimal mode and export needs it.
- **The cover's fields are Fountain's keys** laid out the conventional way; nothing in the bundle
  draws a title page.
- **Derivation runs on every save, project-wide**, and persists — with the three fixes the Scenes
  phase found in the same day. The Info panel's numbers are that pass's; Beats and Shots are typed
  as the literal `0`.
- **The Info panel's Dialogue / Subtitle rows print `—`.** The bundle shows `Hinglish` /
  `देवनागरी`; no language setting exists anywhere.
- **The episode nav is not revalidated on autosave.** Its page count follows the next navigation.
- **Two writers still cannot be told apart by role.** `memberships.role` is read by nothing; the
  gate is membership. Unchanged from every earlier phase and flagged again.
- **A second E2E account exists on the dev Supabase project:** `folio-script-e2e@example.com`,
  created through the admin API for the Script walk (the shell phase's `folio-e2e@example.com`
  password was not recorded anywhere). Its password is not in the repo either. Each run of
  `script-route.spec.ts` leaves one project behind on that account.

## Revisions route phase: the diff, the restore, and two more counts on a row

**Nothing here needed a ruling; everything that was open stayed open.** The four decisions
AGENTS.md puts behind a human — the colour sequence past green, locked-page numbering past the
last lock, the A4 sheet width, `SCENE_xxx` — were left exactly where the schema phase left them.
The route refuses at each: `Issue revision` past green shows `nextRevisionColour`'s own refusal
before the write; a `format: asian` project's compare view reports the unresolved sheet rather
than laying anything out; lock issues are printed under the diff as `numberPages` reports them,
never resolved.

### What the route is built on

- **`diffScreenplays` in `packages/script`** ([diff.ts](../packages/script/src/diff.ts), 20 tests).
  The node id is the join key (ADR 0001); lines are compared at the sheet's measure, so the format
  is an input as it is to `paginate`; comments are not on the paper and are not compared; a moved
  node is a deletion where it was and an addition where it is, flagged `moved`. Within a node
  present in both drafts, a run of removed lines directly followed by an equal run of new ones
  reads as `changed`, one for one; unequal runs read as struck-then-tinted. That rule is a
  judgement call and is stated in the header.
- **Migration `0004`**: `revisions.scenes_touched` and `revisions.page_count`, and `version_reason`
  gains `before_restore` and `restore`. The two columns lean on the same argument as `lines_added`
  — a measurement of an immutable pair — and `page_count` is additionally *the paper as issued*:
  a later re-ruling of lines per inch changes what a new revision counts, not what a production
  office was already handed. Both are defended at their definition in `schema/history.ts`.
- **`cutRevision` now moves `episodes.revision_colour`** in the same transaction. The status bar's
  `Rev. Blue` and the newest revision row cannot disagree. The design README's "snapshot a revision
  + colour bump" is one write.
- **`reviveNodeIds`** lifts the tombstones on ids a restore brings back. ADR 0001 Q4 is the
  argument: the tombstone exists *so that* undo can bring the node back as itself. Reuse — a
  different node taking an old id — is what the ADR forbids; this is the same node taking its
  own, and the caller can only revive ids that appear in an immutable snapshot. It does not
  re-anchor a comment thread whose anchor the foreign key nulled; that is the *detached* state Q4
  leaves as a product decision.

### Restore, as built

`restoreRevision` is three writes in order: a `before_restore` version of the document as it
stands; the restored list through `reconcileNodes`, so surviving rows and their anchors
(locked pages, threads) are kept and only the difference is written; a `restore` version of the
result. No revision row is touched and no version row is deleted. "Restore creates a new version.
It never destroys history." is therefore two rows, and the first is what makes the second
reversible.

### Judgement calls in this phase, each reversible

- **The pair being compared is component state**, not `?base=&head=`. The Scenes ruling (selection
  is state, not a URL) was read across; adding two query params is AGENTS.md "ask first". The
  route's default is *latest revision → current* — what changed since the last issue — where the
  bundle's mock shows *Draft 4 → Draft 5*. A history card's click and `Compare to current` set the
  pair and switch to `?view=diff`.
- **A version is not a draft.** The pickers list revisions and `Current` only. Versions stay in
  the Script route's Collaboration tab; the brief's first rule is why.
- **The bundle's `Drafts` timeline in the episode nav is not drawn.** The nav is chrome and
  `Route - Script.dc.html` wins on chrome; the pickers and the history list cover selection.
  `Snapshot current draft` (the nav footer) is not drawn either: it is a `versions` write the
  Script route's `⌘S` already makes, and issuing a revision takes one anyway. Both flagged.
- **The asterisk is drawn in the right margin.** The bundle's copy says "Revised pages carry an
  asterisk in the right margin"; its markup draws the mark at `left:52px`. The copy is what a
  production office reads and matches convention, so the copy stands and the mark moved. A
  revised page also carries `*` beside its page number. **A bundle contradiction, resolved in the
  copy's favour — flag for the designer.**
- **A deleted node is drawn on the page of the entry before it**, and a node split across a page
  break is drawn whole on the page it starts on. The diff is a review surface; the sheet's
  splits with `(MORE)` / `(CONT'D)` are the Script route's and export's business.
- **"Changes only" keeps context**: every entry that is not `same`, plus the scene heading it is
  under and the cue above a changed line of speech. The bundle's mock filters to changed lines
  alone; a diff with no heading is a diff nobody can place.
- **`N lines differ on this page`** is the page most in view (an `IntersectionObserver` over the
  sheets), so the specified copy stays true with more than one page.
- **The Issue form is not in the bundle** — it draws the button and nothing after it. The form
  collects what the row holds (label defaulting to `Draft N`, note, tags, `Lock pages`) and shows
  the next colour rather than asking for it. `⊕` and `≡` are outside AGENTS.md's glyph set and are
  left off, as the Scenes header left off `▦ ▣ ▤`; `⇄` is drawn. `⤒ Export revision pages` is not
  drawn: export is a queued job that does not exist.
- **`Lock pages` is offered on any unlocked revision**, not only the latest; the pagination reads
  the *latest locked* revision's pages, as `lib/script/server.ts` already did, so an earlier lock
  taken later changes nothing until it is the latest. A revision's own pages are numbered under the
  locks in force *before* it, so an earlier lock's A-pages are locked under the labels they print.
- **Membership, not role.** Anyone who can open the project can issue, lock and restore.
  Unchanged from every earlier phase and flagged again.

### Verified end to end

`apps/web/e2e/revisions-route.spec.ts` against the dev Supabase project, with the Scenes phase's
E2E account: both empty states in both themes; `?view=grid` is a 404; issuing `Draft 1` writes a
`manual` version and a White row with `+16 −0 · 3 scenes touched · 1 pp`; two real edits on the
Script route (a typed line, a merged speech) come back on the sheet as a tinted line, a noted cue
and a struck line, each with its asterisk and the page label `1.*`; `Draft 2` is Blue and locked in
the same act and the Script status bar reads `Rev. Blue`; restoring `Draft 1` writes versions
`before_restore` (14 nodes) and `restore` (15 nodes), puts the old text back on the Script route,
keeps both revision rows and the Blue lock's anchor, and leaves `Draft 1 → Current` with zero
differing lines; `Draft 1 → Draft 2` through the pickers prints counts that reconcile with the
row's stored `+2 −2`. Six tests, nine minutes against the dev server. One run was hit
mid-restore by another session's in-flight rewrite of `reconcileNodes` (a `jsonb_to_recordset`
parameter passed unserialised); it passed once that landed.

Two things the walk turned up that are not this route's: a cross-type merge on the Script route
(Backspace at the start of a speech folds it into the cue) writes no tombstone for the loser's
id — `node_tombstones` stayed at zero rows through the whole walk — and the last keystroke of a
burst typed straight after a click can land before Slate has taken the click's selection, so
the walk waits between the two. Both flagged in the phase report.

## Script route, second pass: the save path measured, and what it now costs

Brief: finish the Script route's backend and make writing on the sheet feel immediate, end to
end against the dev database. The route's body was built; what was not finished was the cost of
a keystroke reaching a row. Measured 2026-09-12 from a machine ~400ms from the dev pooler
(`aws-0-ap-southeast-2`):

- A parameterised statement over the transaction pooler is **two** round trips, not one, and
  cannot be pipelined: `prepare: false` (mandatory - Supabase's connection guide: "Transaction
  mode does not support prepared statements") makes postgres.js `Describe` every statement
  before it can `Bind`. Every tenant-scoped query has a parameter. So `BEGIN` + N statements +
  `COMMIT` is 2 + 2N round trips, and one keystroke's autosave ran **nineteen statements**
  (sequential gate, per-row updates in `reconcileNodes`, seven for `writeMeasurement`, fourteen
  for `commitDerivation`): seven to fourteen seconds of "saving…" per keystroke.
- A fresh pooler connection costs ~4s (DNS, TCP, TLS, auth); `idle_timeout: 20` dropped the pool
  every time a writer paused for twenty seconds and charged it to their next save.
- A feature is ~2,950 nodes and half a megabyte as a list; every autosave sent all of it up and a
  400 KB measurement record back down.

### What changed, and the rule each change keeps

- **Statement count is the unit of cost**, so every write the save runs is one statement built
  from `WITH` clauses: `commitNodePlan` (id-reuse gate, deletes, tombstones, inserts, updates,
  document stamp), `writeMeasurement` (header upsert, children upserted and pruned),
  `commitDerivation` (six caches upserted and pruned), `persistMintedRecords`. Each is still one
  atomic write of the same rows the transaction produced. `derived.ts` still names no authored
  table; the tenant predicate in the raw SQL is still `scoped()`'s.
- **A plan is computed in TypeScript, in one place** (`packages/db/src/node-plan.ts`, unit-tested),
  and it chooses keys that collide with no stored key - including the rows the same statement
  deletes - because a delete and an insert in one statement share a snapshot. The concurrent
  `reconcileNodes` transaction is now read + plan + one statement; the revisions route's restore
  calls it unchanged.
- **The gate's reads run at once** (`openEpisodeWith`): identity first and alone, then membership,
  project, episode *and the save's own reads* in one round trip; membership is still checked
  before anything is acted on, and a non-member still gets the same `REFUSED`. The profile row is
  no longer read on the action path - no action needs a display name.
- **The request is a delta; the write is still a node list.** The client sends the nodes that
  changed and the id order only when it changed; the server lays that over its rows and validates
  the whole list before planning. With `liveRepaginate` the client also sends a digest of the
  record it drew - same engine, same inputs, now including locked pages and the revision colour -
  and the server answers "same" instead of the record. Pagination is still computed server-side on
  every save; only transport changed.
- **What the answer does not carry runs after it** (`after()`, `deferAfterSave`): storing the
  measurement and re-deriving the project. Both are caches replaced whole on the next save, both
  serialised per key in-process with newest-wins, so two `⌘S` cannot interleave a derive's read
  with the previous derive's commit (the duplicate-mint bug `persistMintedRecords` records). One
  Next instance is one lock; a second instance would not share it - flagged, not solved.
- **Every deleted id gets its tombstone in the same statement as its delete**, derived server-side
  from the plan; the client's retirements only say what an id was merged into. This closes the
  Revisions phase's finding that a cross-type merge wrote no tombstone.
- **The pool stays warm** (`idle_timeout` 300s, `max` 10 - a derivation reads nine tables at once).
- **On the client**, a keystroke no longer renders every block: the layout sits in a per-block
  subscription store (`layout-context.tsx`), line wrapping is cached per block object, the forced
  redecorate is keyed on page gaps rather than the layout, a queued save reads the value through a
  ref (the old closure re-saved the value the first save had started with - a real loss until the
  next keystroke), a save that throws clears its in-flight flag, and a hidden tab flushes a pending
  save.

### Not done, and why

- `prepare: true` over Supavisor ran a forty-statement probe with zero errors and would halve
  every statement's cost; the product docs say the opposite of the Supavisor blog and "under load
  and not in development" is the wrong place to learn which is right. Left off, documented in
  `client.ts`.
- `getUser()` is ~0.3-0.9s per action, the one fixed cost left. `getClaims()` would verify the JWT
  locally against the project's JWKS; that touches the auth boundary and is a decision, not a
  tuning.
- The dev database is in Sydney. Nothing in code moves it; wherever the server is deployed should
  be next to it.

### Verified end to end

`apps/web/e2e/script-route.spec.ts` against the dev Supabase project through the running dev
server, with a dedicated confirmed E2E account created through the Admin API: the whole existing
walk, plus a test that types a sentence into the middle of the 220-scene corpus and records
keystroke-to-paint (Event Timing), keystroke-to-"saved", and the bytes each autosave sent and
received, to `test-results/script-latency.json`. The spec's `?panel=composer` → 404 assertion
predated the 2026-09-11 ruling that Script has no sub-view params; it now asserts what the
ruling says (200, the script, the Info tab). On the final code: seven of seven on a fresh project in
8.8 minutes, and the Revisions walk - which restores through `reconcileNodes` and
`measureAndDerive` - six of six in 7.9 minutes, both against the dev server on port 3000.

Two later adjustments in the same pass, both measured on the production build against the
2,951-node walk project: the autosave pause is **one second** rather than 1.5 (a save is a delta
and one statement now; last keystroke to "saved" is ~4s warm, ~7s when the pool is cold), and the
server keeps the rows it last wrote per document, validated by `documents.updated_at`
(`lib/script/row-cache.ts`), so a keystroke save transfers nothing but the delta in either direction.
Typing on that script costs ~46ms of main-thread work per keystroke in production (Playwright's own
floor is ~3ms), down from over 140ms in development before this pass; the slowest keystroke measured
by the Event Timing API fell from 360ms to ~110ms. Plate's chunk size is 100 blocks (from its
default 1,000) so a change re-renders four pages of blocks rather than a third of the feature.

## Outline and Beats phase: one document kind, and a beat is one of its blocks

**Nothing here needed a ruling and nothing open was resolved.** The two routes sit entirely on
decisions already made: the Outline is "a different document kind in the same table" with the
seven-block set (AGENTS.md, The node model; `packages/script`'s `outline.ts`; the `nodes` check
constraint), and `@folio/contracts`' `EpisodeNavMeta` already counted the nav's Beats row from
"`nodes` of `type = 'beat'` in the episode's outline document... the outline's numbered beats are
the only beats that exist." Both routes are built on that sentence rather than around it.

### A beat is an outline `beat` block

The Beats route invents no beat. Its number is the block's ordinal among the outline's beat blocks
(`outline.ts` ruled the number is never stored); its name and one-line are the block's text; add,
rename, reorder and delete are document writes through `planNodeWrite` / `commitNodePlan` with
`kind = 'outline'`, so "Reordering here renumbers the beat sheet; it never moves a scene in the
script" is true by construction - nothing in `lib/beats/actions.ts` can name a screenplay node.
What the outline cannot say - a duration, a minute position, a spot on the unplaced canvas - is
authored data hung off the block by node id in a new table, on `scenes.scene_node_id`'s pattern.

- **Migration `0005`: `beats`** (`beat_node_id` PK = the block's node id, `duration_minutes`,
  `placed_at_minute`, `canvas_x` / `canvas_y`; applied to the dev project 2026-09-12). No foreign
  key to `nodes`, deliberately, as `scenes`: a block deleted and brought back by undo is the same
  beat and finds its timing where it left it. **`placed_at_minute IS NULL` is *unplaced*** - the
  brief's status is one nullable column, not a status that could disagree with a position. No
  row is created on read; the first timing write upserts it.
- **Scene links live on `scenes.beats`.** The column was declared for "beat links" and is
  carried through every re-derive; the route writes beat node ids into it (`linkBeatScene`,
  `array_append` if absent; `unlinkBeatScene`, `array_remove`, one statement each) and reads it
  back inverted. One home for the fact, the one that was already reserved for it. Still not a
  foreign key: a deleted block leaves its id in the array and the route lists only links whose
  block exists.
- **The headline convention** (`packages/script`'s `beats.ts`, 12 tests): a beat block's text
  splits at the **first colon** into the name and the line - the outline bundle's bold lead and
  run of text are the beats bundle's name over its line, one block, two renderings. A name cannot
  contain a colon; `writeBeatHeadline` replaces one with a dash rather than refusing. Editing the
  name or line on the Beats route writes the block as plain text runs, so a mention inside a beat
  block would be flattened to its label - the outline editor offers no `@` combobox this phase,
  so no block can carry one yet; flagged.

### The Outline editor

`lib/outline/slate-model.ts` is the twin of `lib/script/slate-model.ts` over the other closed
union, and deliberately not a generalisation of it: two files, two unions, no shared element
type, so an `h2` cannot reach the Script editor through a shared mapping any more than it can
reach its table through a shared enum. Same four guards (the discriminant is the union's, the
save goes through `readOutlineNode`, a `Record` over the union proves coverage, Plate mints
nothing and `lib/script/identity.ts` on `apply` is the only minter). A `rule` is a Slate void
with one empty text and loses its children on the way out, because the reader refuses
`content: []` on a rule. Tested in `apps/web/tests/outline-slate-model.test.ts`.

The save sends the whole list - an outline is tens of blocks - and the server plans the fewest
rows (`saveOutline`: gate + rows in one round trip, then one statement). Last-write-wins with the
conflict banner, `⌘S` for a `manual` snapshot, autosave at one second. No measurement, no
derivation, nothing after the response: the outline is not paginated ("Prose · not paginated")
and changes no entity. A save returns the H1 and beat counts and the workspace writes the nav's
`Outline` and `Beats` rows in place, so the chrome stays honest without a layout revalidation per
keystroke.

### Judgement calls in this phase, each reversible

- **Beat is a seventh button on the outline's block toolbar.** The bundle draws six; the closed
  set has seven and the Beats route lists the seventh. `⌘⇧B` is its shortcut, by analogy with
  the bundle's `⌘⇧Q` / `⌘⇧R`.
- **Bold and Italic are not drawn.** `InlineRun` has no mark; a `bold: true` on a text node is
  an unexpected field the save refuses. Adding a mark to the inline model is a node-schema change
  (AGENTS.md, When to ask first). Flagged for a ruling.
- **The `@` mention combobox is not on the outline.** Stored mentions are drawn; new ones cannot
  be typed here. The Script route's combobox creates records and is a separate lift.
- **H2 is 18px, H3 16px.** The bundle sizes only H1 (20px). Two type steps added to the tokens:
  `--text-18` and `--text-34` (the sheet title).
- **The nav column keeps the shared episode nav.** The Outline bundle's `In this outline` map and
  `Overall worldview` groups and the Beats bundle's draggable beat list and `Runtime placed` card
  are not drawn - the Revisions precedent: the nav is chrome and `Route - Script.dc.html` wins on
  chrome. Reorder is `⌥↑↓` on either sheet, as both bundles' hint rows say.
- **The Beats sheet's fields.** Name and line are inputs drawn as the sheet's type and written on
  blur; the minutes in the placement label are a field; `＋ Scene` opens a picker over the
  episode's present scenes and each chip carries an `×`; `Delete beat` retires the block. None of
  these controls are in the bundle, which draws a finished sheet with no way to make one.
- **The caret line reads "Type to add a beat"**, not the bundle's "…or press / for a template".
  Templates are not built and a placeholder promising one would be a placeholder.
- **The sheet's title is the bundle's `Beat Editing`**, with the outline document's creation date.
- **Placed cards are positioned by minute** (`left = 16 + start × 62px`, width `duration × 62px`,
  no narrower than an unplaced card), so the tick row means something; the bundle lays its mock
  cards out in a flex row. Drag is pointer events with capture; a drop on the track places at the
  card's left edge, a drop on the canvas unplaces and remembers the spot. Two beats placed at the
  same minute overlap; flagged.
- **Beat colour bars are `--accent` (placed) and `--note` (unplaced)**, not the bundle's six
  oklch hues - hexes outside the tokens, the Scenes precedent for "Colour by".
- **The canvas toolbar is Fit / − / ＋ as text**, per the Scenes precedent; `⌖` / `✋` / `⛶` / `?`
  are left off.
- **The Outline panel's Format control is shown, not live.** It writes an engine input the outline
  does not use; the Script route's panel is where it is changed. Project type is disabled as there.
- **The Script route's Info panel still prints `Beats: 0`.** Counting beat blocks there would add
  a sequential read to the save path (`ScriptStats.beats` is the literal `0` for that reason).
  The Outline's own panel counts them from its blocks. Left, flagged.
- **`shots` in the Outline's statistics is `0`** - the Storyboard phase was landing its table in
  the same working tree while this was built; wiring the count is a one-line change once it has.
- **Membership, not role.** Anyone who can open the project can edit the outline and the beats.
  Unchanged from every earlier phase and flagged again.

### Verified end to end

`apps/web/e2e/outline-beats.spec.ts` against the dev Supabase project through the running dev
server on port 3000, with the Scenes phase's E2E account: both empty states in both themes (no
outline; the Beats route's `No beats yet`); `?view=grid` on Beats is a 404; starting the outline
writes the document and the nav reads `0 acts` / `0`; `⌘1`, prose and a beat through the slash
menu autosave and a reload reads the three blocks back typed as `h1 / body / beat` with the bold
lead on the beat; the nav reads `1 act` / `1`; the Beats route lists the outline's beat with name
and line split at the colon; a beat added there is block `2` of the outline; a duration typed on
the sheet, a card dragged onto the track at the `6'` mark (`6'–12'`, footer `6m of 16m`) and a
card dragged back to the canvas all survive a reload; with a two-scene script imported, linking
a scene prints `Scene 1 · pg 1` on the beat and `1 of 2` under `Beats linked` on the Outline's
panel, and unlinking removes it. Five tests, ~7.5 minutes. One run failed mid-walk on another
session's in-flight edit to `packages/contracts/src/enums.ts` (`SHOT_SIZES is not defined`) and
passed once that landed; the same session committed this phase's files mid-work as
`ace66b4 phase 10 building`, throwaway smoke script included (since deleted).

## Storyboard route phase: the first job, the first reservation, and a ledger bug it found

### What was built, table by table

Three authored tables in migration `0006` (`packages/db/src/schema/storyboard.ts`, RLS on, the
member-all policy, `anon` revoked), all applied to the dev Supabase project:

- **`shots`** — a scene does not say how it is shot. Keyed by `scene_node_id`, the heading node's
  id, on the pattern of `scenes` and `beats`: no foreign key to `nodes`, so a heading brought back
  by undo finds its shots. Ordered by a fractional `order_key` declared `COLLATE "C"` from birth
  (the Scenes phase's collation finding; a new column can carry the right collation without a
  ruling on the old one). `description` is inline content as JSON, so an `@mention` is a record
  id. `origin` (`typed | auto_board`) and `state` (`proposed | accepted`) are the brief's
  "proposed, then accepted"; a typed shot is born accepted, and the database checks the pair.
- **`jobs`** — the job row *is* the status (AGENTS.md's exception table on `production.state`).
  `cost` is what the ledger's `reserve` entry for the same `job_id` holds. **There is still no
  queue library and `apps/worker` is still empty**: a dependency needs approval, so a job written
  here is `queued` and stays so, visibly, until a worker exists. `cancel_requested_at` is how a
  running one will be asked to stop. `credit_ledger.job_id` keeps no foreign key to `jobs` —
  adding a constraint to the append-only money table is a ledger change and is behind a question.
- **`frame_generations`** — "every generation row links to its job and, on failure, to its refund
  ledger entry": two foreign keys and the frame's address. A shot's frame is its latest row here
  read with its job, folded into the seven `FrameState`s the route draws. Nothing on `shots`
  mirrors it.

The nav's Storyboard row now counts accepted shots joined through a present heading to the
episode's screenplay: `—` with no script, `0 shots` with a script and no accepted shot, `N shots`
otherwise. Proposals are not shots yet and are not counted anywhere a count is printed.

### "Propose shots for this scene" is a pure function, and says so

`@folio/script`'s `shots.ts` owns the three closed vocabularies (size, movement, camera angle) and
`proposeShots`: a **rule-based, deterministic** first shot list — establishing wide naming the
resolved location, a two-shot when two or more people speak, one medium close-up per speaker
(first-appearance order, at most four) quoting their first line, a closing wide when the scene ends
on action after dialogue. Every character reference is a structural `@mention` to the record the
cue resolves to through the alias table's bound cues (`canonicalKey(readCue(raw).name)`, exactly
`derive`'s lookup), so `(O.S.)` never makes a second person and an unbound cue is text, never a
minted record. The scene is cut at the next heading derivation accepted, as the Scenes excerpt is,
so a demoted `INTERCUT` line stays inside its scene as action.

A model would make a better proposal. This package cannot call one, and there is no model
integration anywhere in the repository (a dependency, and the agent's own phase). The *shape* of a
proposal — `ShotSpec`, mentions as ids, accepted by the writer per shot or all at once, edited
means accepted — is what a later agent-backed proposer keeps. 13 tests, including a property that
the same scene always proposes the same list.

### Reserve then execute, in one statement — and the bug the first reservation found

`queueFrameGeneration` (`repositories/storyboard.ts`) is one statement: the shot's checks (this
project's, a present scene's of this episode's screenplay, accepted), the balance, the job insert
conditioned on `available >= cost`, the `reserve` entry from the job's returned id (idempotent on
`reserve:job:<id>`), the generation row. A short balance writes nothing and returns the balance it
saw, so the banner prints the numbers. `cancelJob` is one statement the same way: a queued job is
cancelled and its reservation released; a running one gets `cancel_requested_at`. Two clicks racing
on the last credits can both pass under READ COMMITTED — an advisory lock needs the session pooler
a request does not have — and over-reserve by one cost; flagged, not hidden.

**`readBalance` and the `credit_balances` view double-counted a held reservation.** Both summed
*every* entry into `settled` (which already contains the negative `reserve`) and then added the
held reservations again for `available`: a grant of 8 with one 4-credit job queued read as
**0** available. Nothing had ever written a `reserve` before this route, so the arithmetic had never
run against a real row; the E2E walk found it on its first reservation. Corrected in
`repositories/credits.ts` and in migration **`0007`** (`CREATE OR REPLACE VIEW`, same columns,
same `security_invoker`, applied to dev): `settled` is every kind except the provisional pair
`reserve` / `release`; a reservation is closed by a `spend` or a `release`; a failed job that
consumed the work is a `spend` closing it plus a `refund`. This is a read-model correction on the
ledger — no write path changed, no price decided — and AGENTS.md puts the ledger behind a question,
so it is called out here rather than folded in quietly.

**`FRAME_GENERATION_COST = 4` is a placeholder**, one constant in `@folio/contracts`, named on the
button (`Draw frame · 4 cr`), the subheader (`Frame · 4 credits each`), the reservation and the
job row. Pricing is unruled; the E2E walk reads the number off the page rather than asserting it.

### Judgement calls in this phase, each reversible

- **Proposals are `shots` rows in state `proposed`**, not a separate proposals table. They are
  drawn as amber dashed frames with `Accept` / `Discard`, counted as `N proposed` beside the real
  count, never as shots, and have no frame button. Auto board on a scene replaces a proposal still
  waiting and never touches an accepted shot.
- **Editing a proposal accepts it.** A writer who changed a proposal has taken it.
- **Selection is component state**, per the Scenes ruling; `?selected=SCENE_xxx` is not read and
  waits on the id-shape decision.
- **Reorder is `↑` / `↓`**, not the bundle's drag. The subheader says so. Fractional keys mean a
  move is one `UPDATE`.
- **The description is edited as text** and parsed back to inline content through the label book
  (`lib/storyboard/mentions.ts`, tested): `@Meera` becomes a reference, longest label first,
  case-insensitively; `@Nobody` stays text. The codec never creates a record.
- **The canvas's `Storyboard` / `Lens` ports are labels**, as the bundle draws them; a lens is a
  later phase's object. `Generate` there is the same frame job as the board's tile and is disabled
  while one is in flight.
- **The shot list's columns are not sortable.** A shot list's order is the shot order.
- **Credits print in the route header as a link to Production**, where AGENTS.md puts them; the
  button beside every frame names the cost and the balance in its title.
- **`⤒ Export boards` and `Display options` are not drawn** — export is a job that does not exist,
  and the display menu had nothing to switch.
- **The nav's `Boards drawn 1 / 3` footer block is not drawn**: the nav is the Script bundle's
  chrome, shared by seven routes.
- **Membership, not role**, as everywhere.

### Verified end to end

`apps/web/e2e/storyboard-route.spec.ts` against the dev Supabase project through the running dev
server on port 3000, with the Scenes phase's E2E account: the empty state in both themes, the nav
reading `—`, `?view=grid` a 404; a two-heading import with an `INTERCUT - PHONE CALL` line gives
two columns and `0 shots`; Auto board on scene 1 proposes five shots (establishing with a location
mention, a two-shot with two character mentions, two medium close-ups quoting first lines, a
closing wide), counted as `5 proposed` and `0` shots; discarding one and accepting the rest reads
`4` on the header, the footer and the nav, and again after a reload; editing a shot's lens and a
description typed with `@Meera` (resolved) and `@Nobody` (text) saves; moving, adding by hand
(born accepted, at the end) and removing renumber the column; with `0 credits` the frame button
still says `Draw frame · 4 cr` and the server refuses with `0 available, 4 needed`; after a
`grant` of 8 written to the ledger as a purchase would, a click queues the job and the balance
reads `4 credits`, still queued and still `4` after a reload, `cancelled` and `8 credits` after
cancelling, and two more reservations exhaust the grant so a third is refused with the numbers;
the canvas and the shot list draw the same rows in both themes. Five tests, ~6.5 minutes.

`apps/web/e2e/scenes-route.spec.ts` was written in the same phase — the Scenes route had no walk of
its own: the empty state in both themes and a 404; the same import gives two cards with real
excerpts, `pg 1`, eighths from the measurement record, `2 chars · 2 lines` and cast chips, and the
`INTERCUT` line inside scene 1's excerpt rather than a third card; a synopsis written in the detail
card survives a reload; the index and list views agree, `Ready` / `Draft` following the synopsis.
Four tests, ~4 minutes. The existing workspace, smoke and glyph walks (24 tests) pass unchanged
alongside, with the nav's Storyboard row now live.

## Characters route phase: the alias table on screen, and the first sanctioned write-back

### What was built, table by table

Migration **`0008`** (`packages/db/src/schema/derived.ts`, applied to the dev Supabase project) adds
the authored half the spec calls "profile, arc and relationships authored on top". No derived table
changed and no derivation path writes any of it:

- **`characters`** gains `group` (`principal | supporting`, default `supporting`), `role`, `age`,
  the three drives each with a `_source` line (`wants` / `wants_source` …), `voice_rules text[]`,
  and `key_lines uuid[]` — dialogue node ids the writer picked, **not a foreign key**: the text is
  read from the node at render and a line the script has lost is dropped on read, never shown from
  a copy.
- **`character_relationships`** gains `shift` beside `what`. The shared-scene count on the row is
  derived (the two records' `scenes` arrays intersected); the words are the writer's.
- **`character_arc_turns`** — one turn per row, `position`-ordered, `scene_node_id` nullable and
  **not a foreign key** on the pattern of `scenes` and `shots`: a heading brought back by undo finds
  its turn. A turn with no present scene is the spec's "unwritten" flag, read from the join, never
  stored. RLS on, the member-all policy, `anon` revoked.

The route reads the authored tables beside the derived caches (`repositories/characters.ts`) and
joins by id in `lib/characters/server.ts`. Nothing recombines the halves into a row.

### The alias table, and what each button on the route writes

Every rule in AGENTS.md, Entity identity is a write the writer can make and see:

- **Match** in the queue binds the cue's spelling to the proposed record (`bindCue`: one statement,
  gated on the `(project_id, cue)` unique index — a spelling somebody else holds is refused, never
  tie-broken) and records an `accepted` decision. **Other…** binds to a record the writer picks, or
  records `accepted new-record` so the next pass mints. **`＋ alias`** on the profile binds any
  spelling by hand — the Devanagari spelling of a name is the E2E walk's example — and `×` unbinds,
  refusing the last one.
- **Walk-on** is one act: `matchCharacters` (new in `@folio/script`'s `derive.ts`, the queue's own
  scoring over the same pool a pass builds) lists every record the cue resembles, and the action
  records a rejection of each and of `new-record` in one insert. The row then stands open with no
  proposal — the state the pure core keeps for "never ask again" — listed under **Walk-ons** in the
  column, and out of the badge.
- **The rail badge is the pending count**: open rows *with a proposal*. `readRailBadges` was
  counting every open row, which would have kept a walk-on in the badge forever; the spec says
  "pending" and a walk-on is answered.
- **Rename** is the sanctioned write-back, built as AGENTS.md's exception table specifies:
  `renameCharacterCues` (`@folio/script`'s new `rename.ts`, 10 tests) rewrites every cue whose name —
  modifiers taken off — has the old name's key, keeping the modifiers where they were, and leaves
  every other bound alias alone; `renameCharacterRecord` swaps the name and the name's alias-table
  row in one statement, refusing a spelling another record holds ("merge instead"); a
  `before_rename` version is taken of every document that changes; `rewriteCueNodes` writes the
  changed nodes across every document in one statement, ids and order untouched, so every anchor
  survives; the diff comes back as *N cues across M episodes* and is printed. The profile asks first
  and says the number.
- **Merge into…** is one statement: the loser's bound cues, relationships (both directions,
  de-duplicated), arc turns and key lines move to the winner; the loser keeps its row with
  `merged_into` set, a tombstone anything pointing at it can follow (the route redirects a merged
  id to the survivor). **Delete** is refused while the record is present in the script — a record
  deleted under a live cue would be minted again on the next pass, which is not what Delete means.

Profile fields, relationships, arc turns and key lines are authored and re-derive nothing;
binding, deciding, merging and renaming each **await** a project-wide pass before answering,
because what the writer sees next is that pass's output.

### `/characters/:characterId`, as the spec writes it

The route spec names both `/characters` and `/characters/:characterId`, and the id is the record's
UUID — a character is "a stable UUID with a name attribute" — so the URL survives every rename and
there is no slug to mint or to go stale. That is the difference from the Scenes ruling: a scene's
URL id was the open `SCENE_xxx` shape; a character's is not open. `/characters` shows the first
record in nav order on the profile view; `map` and `resolve` are project-wide and name no record.
A merged id redirects; an unknown UUID is a 404; a non-UUID segment is a 404 before any lookup.
`?view=profile | map | resolve` is the sub-view param as every route's is.

### Judgement calls in this phase, each reversible

- **Group defaults to `supporting`.** A minted record is somebody until the writer says who; forty
  principals on import would say nothing. The nav's groups are the writer's.
- **A rename rewrites the cues that *are* the name, not every bound alias.** `YOUNG MEERA` bound to
  Meera stays `YOUNG MEERA` when Meera Pawar is renamed; it is a row the writer chose. The reading
  of "rewrites every cue in every episode" taken here is every cue *that is the name*, in every
  episode. Flagged: the other reading rewrites aliases too.
- **The cue spelling of a name is its invariant uppercase** (`cueSpelling`), which a script with
  no case passes through unchanged.
- **Scene refs print the rank within the episode** (`E2 Sc 9`), not `scene_derivations.number`,
  which `derive` assigns across the whole project in reading order. **Finding, not fixed:** the
  Scenes route prints that project-wide number, so on a series' second episode its cards are
  numbered from the first episode's last. That is `derive`'s to change and is escalated here.
- **Voice share is project-wide** ("N% of the dialogue across K episodes"), not the bundle's
  `· E1`: per-episode lines per character are not a stored fact and would mean walking every node
  on every render.
- **The presence gap is reported from five absent scenes up** (`GAP_SCENES`), inside one episode,
  between two appearances; the threshold is named in `figures.ts`.
- **"What stands out" lists principal pairs with no shared scene**, computed; the bundle's card is
  fixture prose. Nothing on the route calls a model.
- **Key lines are picked from the character's own dialogue** (`listDialogue`, a read-shaped action
  that walks the script on demand, capped at 400 lines), with the scene each sits in found by order
  key under `COLLATE "C"`.
- **Elsewhere** links to Bible, Timeline, Insights and Production with `—` where nothing exists to
  count, the computed gap on Insights · Presence, and the bundle's `not yet` on Production · cast.
- **The portrait box is drawn and says why it does nothing** in its title — there is no file storage.
  **`Cast report · PDF` is not drawn** — export is a job that does not exist (the Scenes precedent).
  The map tab's `▦` and the profile tab's `▤` are drawn as the Storyboard route drew its own.
- **Chip hues are `--chip-1..6` in `packages/ui`**, the six the bundle writes inline on its fixture,
  picked by a stable hash of the record id so one person is one colour everywhere.
- **The cue-level rename prompt ("rename everywhere, or create a new character?") is the Script
  editor's**, not this route's, and is not built: a changed cue reaches this route as a queue row,
  where Match / Other… / Walk-on is the same question asked after the fact.
- **`ContextColumn` gained `action` and `footer` slots** so the column's `＋` and the derivation
  legend could be drawn without a second column component; `Hide nav` now hides a context column as
  it hides the episode nav.
- **Membership, not role**, as everywhere.

### Verified end to end

`apps/web/e2e/characters-route.spec.ts` against the dev Supabase project through the running dev
server on port 3000, with the Scenes phase's E2E account: the empty state in both themes with no
badge, `?view=grid` and `/characters/not-a-uuid` both 404; an import with `MEERA`, `MEERA (V.O.)`,
`MEERA PAWAR`, `SURESH KADAM`, `SURESH`, `YOUNG MEERA` and `CLERK` derives exactly three records
and three queue rows — `likely`, `possible`, `likely` — with the badge, the column row and the tab
all reading `3`; Match binds `MEERA PAWAR` and the badge reads `2`; Walk-on on `YOUNG MEERA` reads
`1` and lists it under Walk-ons; Other… → a new character mints `SURESH`, the badge is gone and all
of it survives a reload; a role, a drive, an arc turn (unwritten, then pointed at `E1 Sc 2`) and a
Devanagari alias are authored and survive a reload; renaming `MEERA` to `Meera Pawar` asks, says
`3 cues will be rewritten`, reports `3 cues rewritten across 1 episode`, and the Script route then
shows `MEERA PAWAR` on every cue that was the name with the `(V.O.)` kept and `YOUNG MEERA` untouched,
the role, turn and alias still on the profile; merging `SURESH` into `SURESH KADAM` lands on the
survivor with `SURESH × 1` among its cues and three records; Delete is disabled on a present record;
the map draws three rows in both themes. Seven tests.

## Beats route removed: a second rendering of the outline with nothing reading it

**Ruled by the client, 2026-09-12: the `/beats` route is cut.** Not redesigned, not deferred -
removed. The question put was whether a writer needed it; the answer was that it was "making
things too much messy" and did not serve a purpose, and that is the ruling.

### Why it did not earn its place

The Outline and Beats phase built the route on one sentence - "a beat is an outline `beat` block" -
and that sentence is what made the route redundant. Add, rename, reorder and delete were already
the Outline's (`⌘⇧B` is a block button). What the route added that the Outline could not say was a
typed duration, a free minute position on a track, an `x/y` spot on an unplaced canvas, and a
beat → scene link on `scenes.beats`. None of those numbers was anchored to anything: a beat "placed
at 6'" was a number the writer made up and the app could not check, and **no designed consumer
read any of it** - the Insights bundle's pacing and presence views, Timeline and Storyboard mention
no beat. The only surface it reached outside itself was the Outline panel's `Beats linked · N of M`
row. A route whose unique data nothing reads is a second rendering of the outline with a table
attached, and that is what was cut.

### What went

- The route in both shapes (`[episodeId]/(writing)/beats` and `(film)/(writing)/beats`), `_beats/`,
  `lib/beats/`, `?view=beats|arrangement` from `SUB_VIEW_SCHEMAS`, the `beats` row of the episode
  nav and `EpisodeNavMeta.beats`, the `⧗` glyph (AGENTS.md's set is seventeen), `@folio/contracts`'
  `beats.ts`, `packages/db`'s `schema/beats.ts` and `repositories/beats.ts`, the `.folio-beat-*`
  classes, and the three Beats tests of `outline-beats.spec.ts` - the two Outline tests survive as
  `outline-route.spec.ts`.
- The Outline panel's `Beats linked` row (the bundle draws it; the route was the only thing that
  linked one), the outline save's `beats` count (it fed the nav row), and `writeBeatHeadline` (the
  route was the only writer of a `Name: line` block).
- The workspace is **thirteen routes**; the episode nav is **six rows**, Storyboard still above
  Scenes. Every count in `routes.ts`, the unit tests, the E2E contract and AGENTS.md was moved.

### What stays, and one thing left undone

- **The outline's `beat` block is untouched.** It is one of AGENTS.md's seven, the toolbar still
  makes one, its number is still its ordinal, and its bold lead still ends at the first colon
  (`packages/script`'s `beats.ts` keeps `readBeatHeadline` and `BEAT_HEADLINE_SEPARATOR` for the
  editor's decoration and the panel's count).
- **`scenes.beats` stays, opaque again.** The column predates the route (declared in `0000` for
  "beat links") and `derive` carries it through every reconcile; rows the route wrote keep their
  ids, unread. Dropping it would touch the derived-cache reconcile for nothing.
- **The `beats` table is orphaned, not dropped.** Its Drizzle definition is gone, so the schema no
  longer knows the table and the next `db:generate` will emit `DROP TABLE beats`. That migration was
  **not** written in this change: a concurrent session had `0008` in flight and a generated
  snapshot would have folded its half-landed schema in. Whoever runs `db:generate` next will get the
  drop; it is expected, and the table's only writer is gone. (AGENTS.md, When to ask first: a
  migration that drops a column is asked for - it was, and this section is the answer.)

### Flagged

- The Script route's Info panel still prints `Beats: 0` - the bundle's row, the outline's block
  count, not read on the save path for the reason `lib/script/stats.ts` gives. Unchanged.
- `Route - Beats.dc.html` and its screenshot stay in the design bundle as the record of what was
  drawn; the README's override table now says not to build it.

---

## Locations route phase: the tree on screen, and the second sanctioned write-back

### What was built, table by table

Migration **`0009`** (`packages/db/src/schema/derived.ts`, applied to the dev Supabase project) adds
the two things the route still needed. No derived table changed and no derivation path writes
either:

- **`locations.merged_into`** — the same tombstone `characters` carries: set when the writer merged
  this record into another, kept so a `@mention` or a scene still pointing at the loser can follow
  it. `readDerivationInput` and `readMentionLabels` skip a merged record as they skip a merged
  character.
- **`location_arc_notes`** — one note per location per episode, the spec's "an arc note per
  episode" ("How this place changes"). Keyed by the episode row, not its slug (ADR 0002), so a
  reorder leaves the note on the episode it was written about. RLS on, the member-all policy,
  `anon` revoked.

`0009` was generated with the orphaned `beats` table temporarily re-declared, so that drizzle-kit's
non-interactive run did not have to be asked whether `location_arc_notes` was a *rename* of
`beats`, and so that the `DROP TABLE beats` — an ask-first item — stayed out of this route's
migration. The Timeline phase, running beside this one, then wrote it as `0010` on its own.

Everything else the route reads already existed: `locations` (name, `parent_id`, `description`,
`scheduled_days`), `location_bound_sluglines`, `location_derivations` with its `own_*` / `rollup_*`
counts, `location_slugline_tallies`, and the queue's `slugline` and `structure` rows. The
repository is `repositories/locations.ts`; the route joins the halves by id in
`lib/locations/server.ts` and never recombines them into a row.

### The tree, and who writes it

AGENTS.md, Entity identity: "a location is a **tree, not a list**", and the pure core's ruling is
that the records come from the headings while the edges are drawn by a human. `locations.parent_id`
is written by exactly two things, both the writer's act:

- **`Inside`** on the record head — a select over every record outside the record's own subtree —
  which calls `setParent`. A cycle is refused before the write (`wouldCycle` in `figures.ts`); the
  pure core would report one as data, but a writer asking for one is a mistake worth refusing.
- **The resolve view's second list.** A record whose own name reads like `<head> - <rest>` gets the
  pure core's structure proposal: `attach` under an existing record, or `new-parent` when two or
  more sets share a head nobody has made. **Attach** writes the edge; **Create and attach** mints
  the primary set by hand (its name bound as its set text, unless a live record already carries
  that name) and then writes the edge; **Keep separate** records the rejection and the same guess
  is never made again. Accepting one `new-parent` turns every sibling's proposal into an `attach`
  on the next pass, which the E2E walk exercises.

Every count on the route is the roll-up — `location_derivations.rollup_*`, the pure core's tree
walk, stored — and the record's sub-location strip says so: "counted in the parent total". The
header pill and the footer's `N locations` count **primary sets**, as the bundle's `locCount`
does, because the number a production office wants is the number of sets.

### The alias table, and what each button on the route writes

- **Match** in the queue binds the set text to the proposed record (`bindSlugline`: one statement,
  gated on the `(project_id, slugline)` unique index) and records an `accepted` decision.
  **Other…** binds to a record the writer picks from the tree. **New record** records `accepted
  new-record` so the next pass mints. There is no Walk-on: a heading is always somewhere, so a
  slugline is never nobody.
- **`＋ alias`** on the record binds any set text by hand — `THE CHAWL` on the Kamathi Chawl record
  is the walk's example; a whole heading typed there is read down to its set with `readSlugline`
  — and `×` unbinds, refusing the last one.
- **Rename** is the second sanctioned write-back, built to the same shape as the character rename:
  `renameLocationHeadings` (`@folio/script`'s `rename.ts`, 6 tests) rewrites every Scene node
  whose set has the old name's key, keeping the prefix as typed (`INT.` stays `INT.`, `INT` stays
  `INT`) and putting the time of day back after ` - `; `renameLocationRecord` swaps the name and
  the name's alias-table row in one statement, refusing a set another record holds; a
  `before_rename` version is taken of every document that changes; `rewriteHeadingNodes` writes
  the changed nodes across every document in one statement, ids and order untouched, so every
  scene record, synopsis, shot list and arc turn keyed by the heading node survives; the diff comes
  back as *N headings across M episodes*. The record asks first and says the number.
- **Merge into…** is one statement: the loser's bound set texts and arc notes move to the winner
  (a note the winner already has for that episode stays the winner's), the loser's sub-locations
  hang off the winner, a winner that hung off the loser takes the loser's parent so no cycle is
  written, and the loser keeps its row with `merged_into` set. **Delete** is refused while the
  record is present in the script; its sub-locations move up a level when it goes.

A description and an arc note re-derive nothing. Binding, deciding, merging, renaming **and moving
the edge** each await a project-wide pass before answering, because a parent set's counts are its
subtree's and what the writer sees next is that pass's output.

### `/locations/:locationId`, as the spec writes it

The record's UUID, for the reason the Characters phase gave — the same identity model, so the
same URL shape. `/locations` shows the first record in tree order on the record view; `breakdown`
and `resolve` are project-wide and name none. A merged id redirects; an unknown UUID is a 404; a
non-UUID segment is a 404 before any lookup. `?view=record | breakdown | resolve` is the sub-view
param as every route's is.

### Judgement calls in this phase, each reversible

- **A rename rewrites the headings whose set *is* the name, not every bound alias and not a
  descendant's heading.** `THE CHAWL` bound to Kamathi Chawl stays; `KAMATHI CHAWL - CORRIDOR` is
  the corridor record's own name and stays when the chawl is renamed. The reading of "rewrites every
  scene heading that uses it" taken here is every heading *that is the name*. Flagged: the other
  reading rewrites the head segment of every descendant's heading too.
- **The rebuilt heading normalises the separator to ` - `.** `EXT CHAWL CORRIDOR -- DAWN` renamed
  reads `EXT KAMATHI CHAWL - DAWN`; the reading already collapsed the double hyphen to reach the
  set, and ` - ` is what every other heading this product writes takes.
- **Interior / exterior is read over the subtree, not stored.** A set is `INT.` in one heading
  and `EXT.` in the next; the route prints `INT`, `EXT`, or `INT/EXT` from its scenes' readings,
  and a primary set with no heading of its own reads its sub-sets'. `null` prints `—`.
- **The kind line is computed** (`kindOf`): `Primary set · N sub-locations`, `Sub-location`,
  `Recurring interior`, `Single exterior`, `0 scenes · record kept`. The bundle's fixture prose.
- **"Sluglines that resolve here" are the counted headings** (`INT. CHAWL CORRIDOR - DAY × 6`, the
  tallies as `derive` counts them, per heading spelling) plus every bound set text the script does
  not contain at `× 0`. The bundle draws the prefix and set without the time; the tallies carry
  the whole heading and that is what is shown.
- **Pages are the measurement's eighths summed over the set's scenes**, at the project's format in
  `paged` mode — the same row the episode board counts from — and `—` while none of them is
  measured. "Screen time by episode" is in pages when the episodes are measured and in scenes
  when they are not, and its label says which.
- **The scene list's gist is the authored synopsis**, or for a primary set the sub-set the heading
  resolved to. Nothing summarises a scene.
- **The day/night bar has three states.** Day on the left, night on the right, and the `--line2`
  track showing for a heading that says neither (`CONTINUOUS`, `LATER`); a two-way split would
  fold those into day. `--day` / `--night` are new tokens in `packages/ui`, transcribed from the
  bundle's two theme blocks, and `--text-8-5` is a new step of the type scale (the I/E label and
  the chip letter).
- **The nav's I/E column is 30px, not the bundle's 26px.** `INT/EXT` at 8.5px/600 with `.06em`
  tracking is wider than 26px and collided with the name. Four pixels, flagged.
- **The rail badge is unmatched sluglines only** — open `slugline` rows with a proposal, as the
  spec writes it. Structure proposals show on the Resolve tab's list but do not count toward the
  badge; the spec's badge copy names sluglines.
- **`Editable` and `IdentityChip` moved to `packages/ui`** because two routes now use them
  (AGENTS.md, Conventions > Files). `CharacterChip` stays in `_characters` as the one place a
  character's name becomes an initial; the drawing is the shared chip.
- **`SceneIndexRow` gained `ie`, `light` and `timeOfDay`**, read defensively off
  `scene_derivations.reading`. The Characters route ignores them.
- **Not drawn:** `Location report · PDF` (export is a job that does not exist; the Cast report
  precedent); the bundle's description tags (no column); the reference thumbnails and the
  `Establishing plate · E1 done` / `Night plate` rows (a plate concept nothing has, and invented
  states are placeholders). The reference box is drawn and says in its title why it does nothing.
  Shooting days are shown from the roll-up but not edited here — they are a Production fact.
- **Membership, not role**, as everywhere.

### Verified end to end

`apps/web/e2e/locations-route.spec.ts` against the dev Supabase project through the running dev
server on port 3000, with the Scenes phase's E2E account: the empty state in both themes with no
badge, `?view=grid` and `/locations/not-a-uuid` both 404; an import with seven headings in five
places — `KAMATHI CHAWL - CORRIDOR` twice, `KAMATHI CHAWL - COURTYARD`, `WARD OFFICE`,
`WATER TANKER STAND`, `WATER TANKER`, `CORRIDOR` — derives exactly four records and two queue rows
(`likely`, `possible`) with the badge, the column row and the tab all reading `2`, and two
structure proposals for a `KAMATHI CHAWL` nobody has made; the corridor's record reads `INT`,
`Recurring interior`, two headings at `× 1`, `1 / 1` day/night, first seen `E1 Sc 1`, last `E1 Sc
3`; Match binds `WATER TANKER` and the badge reads `1`; New record mints `CORRIDOR` and the badge
is gone; Create and attach mints `KAMATHI CHAWL` and hangs the corridor under it, the courtyard's
proposal becomes an Attach and is taken, the nav shows the chawl first at `3` with two rows under
it and the header still reads four sets, and all of it survives a reload; a description, an E1
note and a `THE CHAWL` alias are authored and survive a reload; the minted `CORRIDOR` is moved
inside the chawl through `Inside` and the roll-up reads `4`; renaming `KAMATHI CHAWL - CORRIDOR`
to `Chawl Corridor` asks, says `2 headings will be rewritten`, reports `2 headings rewritten
across 1 episode`, keeps the parent, and the Script route then shows `INT. CHAWL CORRIDOR -
NIGHT` and `INT. CHAWL CORRIDOR - DAY` with the courtyard and the bare corridor untouched; merging
`CORRIDOR` into `Chawl Corridor` lands on the survivor with `INT. CORRIDOR - NIGHT × 1` among its
headings and `3` scenes, five records remain, the loser's URL follows the tombstone, and Delete is
disabled on a present record; the breakdown draws five rows in tree order in both themes with the
chawl's cell and total at `4`. Seven tests, 6.8 minutes.

## Timeline route phase: two authored things, and an order the script never states

The brief: "Story order versus what actually happened, across all episodes. Two authored things
power it." Both were built as inputs a writer types, and nothing on the route parses a date out of
a slugline - the walk imports scripts full of `DAY`, `NIGHT` and `DAWN` and proves the route is
still empty until a day is given by hand.

### What was built, table by table

Two migrations, both applied to the dev Supabase project:

- **`0010_drop_beats`** — the drop the "Beats route removed" section sanctioned and `0009` declined
  to fold into the Locations route's migration. Alone in its file so it can be held back on its own.
  The dev table held eight rows, all from the removed route's own E2E run.
- **`0011_timeline_route`** (`packages/db/src/schema/timeline.ts`, `derived.ts`):
  - **`story_threads`** — AUTHORED. `name`, `colour` (a closed enum, `story_thread_colour`),
    `position`. RLS on, the member-all policy, `anon` revoked.
  - **`scenes.threads`** now holds story thread ids, as text, in the writer's order. The column was
    declared opaque in `0000` for exactly this; putting the link on the scene's authored row is what
    makes it survive a re-derive for the same reason a synopsis does. **No foreign key**, on purpose:
    a deleted thread is removed from every scene by `array_remove` in one statement before the row
    goes, and any id that slips past is dropped on read - the `characters.key_lines` rule. The
    **first** id is the grid row a scene's card sits in.
  - **`scenes.story_day`** (any integer; Day 1 first by convention), **`scenes.story_clock`**
    (`HH:MM`, 24-hour, checked; text because that shape sorts as a clock does), **`scenes.flashback`**.
    A clock without a day is refused by the contract *and* a column check. `scenes.story_time` - the
    opaque text of the same age - has no writer and is not dropped: a column drop is asked for.

Both migrations were generated through drizzle-kit's own API (`generateDrizzleJson` /
`generateMigration`) from a one-off script rather than `db:generate`, because the CLI wanted a TTY to
ask whether `story_threads` was `beats` renamed; splitting the drop from the create is what made the
question moot, and `db:generate` afterwards reports no schema changes.

The pure core (`packages/script/src/timeline.ts`, 20 tests) owns everything that is a function of
story time and page order: `compareStoryTime` (day, then clock, unclocked last), `precedesStoryTime`
(strict; **an unknown clock never precedes** - two scenes on one day with one clock missing are in
neither order, so a finding the writer cannot act on is never raised), `continuityFindings`,
`storyJumps`, `chronology`, `storySpan`. Nothing in it reads a node.

### A finding is a flag, not an error - and how a flashback is read

A finding is exactly the brief's sentence: a scene whose story time precedes the scene before it on
the page. Two readings of "the scene before it" were possible when flashbacks are involved, and the
one taken is: **a flashback is skipped when looking back**. The scene after a flashback is compared
with the last frame-story scene, not with the flashback - so returning to the present is not a jump,
and a real step backwards hidden behind a flashback is still found (tested: `does not let a flashback
hide a real step backwards`).

The flag itself: a flashback-flagged scene that precedes still *is* a finding, and the core reports
it as `kind: 'flashback'`. The continuity view lists only `order` findings as cards - re-asking about
a flashback is the false positive the brief warns against - and says at its foot how many flashbacks
it is not listing. `Flashback` on a finding's card sets the flag and keeps the time; the card leaves
the list, the tab's badge drops, the footer's flashback count rises. "Mark it and it stops appearing"
holds without a fourth authored field.

### Judgement calls in this phase, each reversible

- **The link is `scenes.threads`, not a join table.** Reasons above; the cost is that a thread's
  scene count is counted in the loader, not by the database, and reorder within a scene's list has
  no UI yet (the first id is the row; `＋` appends).
- **Story view shows unplaced scenes** (dashed `no time` chip) so they can be picked and placed;
  chronology does not, and says so in the strip (`N scenes have no story time and aren't shown in
  Chronology`, `Continue from Day N`).
- **`Assume continuous` and `Continue from Day N` are one write** (`placeUnplacedScenes`): every
  unplaced present scene gets one day, no clock, in one `UPDATE … WHERE = ANY`. A declared
  assumption the writer then corrects, not a guess - and it raises no finding, because one day with
  no clocks has no order to disagree with. The bundle's line about `CONTINUOUS` and `LATER` being
  respected is kept as copy; nothing parses them, and nothing needs to for a single-day placement.
- **`⇅ Chain to previous scene`** gives the scene the day of the last placed frame-story scene before
  it on the page, and no clock.
- **`↷ Skips ahead`** is a calendar gap - `day > previous.day + 1` - not the bundle's "skips a
  placed day", so the arrow means the same thing whatever else is placed.
- **The span counts the frame story only**: `2 days + 1 flashback`. A flashback "sits outside the
  day count", which is what the flag says.
- **Thread colours are six named tokens** (`--thread-terracotta|slate|moss|ochre|violet|teal` in
  `packages/ui`): the bundle's four `--t-*` transcribed and renamed by hue, plus two invented and
  marked as such. A row stores a name, never a colour.
- **Thread rows have no drag reorder**: `position` exists and is kept dense by insertion; the
  bundle's `⠿` handle is not drawn.
- **Selection, hidden threads and "Place by hand" are React state in a provider the layout mounts**
  (`timeline-state.tsx`), because the column (layout) and the grid (page) are two trees. `?selected=`
  stays blocked on the `SCENE_xxx` ruling; hidden threads are a filter, not a sub-view.
- **Not drawn, and flagged:** `＋ Event` and `Anchors · fixed dates` (a third authored thing the
  brief does not name); the panel's `Must already be true` / `Becomes true after` facts (same); the
  `Series / Episode 1` scope toggle (story order's columns are already the episodes); the bundle's
  `Swap on the page` fix (a node write - the timeline reads page order, it never rearranges it); a
  Timeline rail badge (the bundle draws the open-findings count there; AGENTS.md, UI fidelity names
  three badges and Timeline is not among them - the count sits on the Continuity tab instead).
- **Scene refs print the rank within the episode** (`E2 Sc 3`), the Characters reading, not
  `derive`'s project-wide number. The finding from that phase stands.
- **Membership, not role**, as everywhere.

### Verified end to end

`apps/web/e2e/timeline-route.spec.ts` against the dev Supabase project through the running dev
server on port 3000, with a dedicated `e2e-timeline@example.com` account (made through the Admin API
so as not to reset the Scenes-phase account under a concurrent session): the empty state in both
themes with the column at 250px, `Story spans —`, `?view=grid` a 404; two episodes imported with
`DAY`, `NIGHT` and `DAWN` in every slugline and the route still empty with `Scenes without a time 7`;
`Assume continuous` places all seven on Day 1, the grid draws two episode columns (`4 placed`,
`3 placed`), chronology draws one column of `7 scenes`, continuity says `agree everywhere`; `E2 Sc 3`
set to `Day 2 · 06:40` raises nothing and the span reads `2 days`; `E2 Sc 2` set to `Day 2 · 09:15`
puts `↶` on `E2 Sc 3`, `1` on the Continuity tab, the amber flag and `Earlier than E2 Sc 2 (Day 2 ·
09:15)` on its panel; a clock with the day cleared is refused with `A clock needs a day.`; the
continuity card reads `E2 Sc 3 happens before E2 Sc 2, but comes after it on the page.` in both
themes; `Flashback` drops the card, prints `1 flashback is earlier than the scene before it on the
page, as flagged.`, clears the badge, and the panel then reads `Flashback. Sits outside the day
count.` with the span at `2 days + 1 flashback`; a thread is made, linked from the panel (the card
moves rows, `6` stay on `No thread`), hidden (row opacity `.35`), renamed and recoloured in place,
unlinked, relinked and deleted (every link goes with it); a second thread and its link, both story
times and the flashback survive a reload; chronology draws `Day 1 · 5 scenes` and `Day 2 · 2 scenes`
with `E2 Sc 3` before `E2 Sc 2` in the Day 2 column, both themes. Five tests, 6.9 minutes.

Also fixed on the way: `workspace.spec.ts` still asserted eight episode routes after the Beats cut;
it is seven, and the thirteen-route walk now runs again (with the Timeline empty-state text added to
its contract row).
