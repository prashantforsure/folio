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
