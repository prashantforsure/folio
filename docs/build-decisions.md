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
  table says a header segment switches a sub-view. The alternative is session state.
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

### Judgement calls in this phase, each reversible

- **Autosave is 1.5s after the last change; a `versions` snapshot is requested at most every five
  minutes and on `⌘S`.** Nothing specifies either cadence.
- **Saves write only the rows that changed** (`reconcileNodes`: longest-increasing-subsequence over
  existing order keys, re-keying the rest). `replaceNodes` is kept for import.
- **`⌘1`–`⌘8`, not bare digits**, as the bundle writes them; a bare `3` in dialogue is a `3`.
- **The Format control is live** (writes `projects.format`); **the Project type control is
  shown disabled** — film ↔ series reshapes every URL and is not a panel toggle.
- **`?panel=` is a query param** on the client's instruction, although the README and AGENTS.md's
  exception table put the tab in session state. `useSession().sideTab` is not read by Script.
- **`?content=` is not a param.** `empty` is `loadScript` finding no document. Unknown keys are
  ignored, so a stale `?content=empty` link is neither honoured nor a 404.
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
