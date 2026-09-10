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
