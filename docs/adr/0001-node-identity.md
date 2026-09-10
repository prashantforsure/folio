# ADR 0001 — Node identity under split, merge and paste

- **Status:** Accepted — **decision delegated to the implementer, 2026-09-10.** The id
  *shape* was delegated a second time on the same date; see "Ruling" below.
- **Date:** 2026-09-10
- **Deciders:**
- **Supersedes / superseded by:** —

> This is AGENTS.md open decision 1. It was escalated as an argument to rule
> on. The decision was put back to the implementer verbatim — "do whats best
> according to u", for all four questions asked — so the recommendation below
> was adopted as written and is now implemented in `packages/script`.
>
> **This was a delegated decision, not a considered product ruling.** It is
> recorded that way on purpose. Each position below is defensible and each is
> reversible; if any of them is wrong, it is wrong because nobody with the
> product context weighed it, not because the argument was lost. The most
> consequential one to revisit is Q3, which fixes a column shape in
> `packages/db`.
>
> AGENTS.md's *Open decisions* table still lists row 1 as open. It has not been
> edited — amending the contract is a separate call.

## Context

The node id is the join key for comments, proposals, provenance and every
derived entity. Proposals in particular are "anchored to node ids and rendered
as hunks against current node state" (AGENTS.md, The AI agent), so an id that
moves to the wrong place does not fail loudly — it silently re-points a
reviewer's comment at somebody else's line.

AGENTS.md already fixes part of this. "Every node has a **stable id** that
survives splits, merges, type changes and reorders" rules out the option where
an edit mints fresh ids for everything it touched. What it does not say is
**which** node keeps the id when one node becomes two, or when two become one.
That residue is what this ADR needs a ruling on, and it is six questions, not
one.

Everything below is a question about behaviour a writer can observe. None of it
is an implementation detail.

---

### Q1. Split: which half keeps the id?

A node with id `a` and text `MEERA crosses the yard. She does not look back.`
splits at the cursor. Two nodes come out. One may keep `a`.

| | Rule | What breaks |
| --- | --- | --- |
| **A** | Head keeps `a`, tail is new | The cursor-at-start case |
| **B** | Tail keeps `a`, head is new | The cursor-at-end case |
| **C** | The longer fragment keeps `a` | Needs a tiebreak; undo becomes asymmetric |
| **D** | Head keeps `a`, **and anchors in the tail are re-pointed** | Nothing — but it changes the operation's signature |

**A** is the editor-convention answer: Slate, ProseMirror and therefore Plate
all keep the first block. It is right for the common case, where a writer parks
the cursor mid-paragraph and breaks it in two.

It is wrong for the second most common case. A writer puts the cursor at the
*start* of a dialogue block and hits Enter to open a line above it. Under A the
now-empty head keeps `a`, the entire original text moves into a brand-new node,
and every comment on that text is orphaned. The writer did not edit their line;
they added a line above it. Nothing about that should detach a comment.

**B** has the mirror problem at the end of a block, which is rarer but not rare.

**C** makes the id follow the bulk of the text, which is what a reader would
predict, but 50/50 splits need an arbitrary tiebreak and undo/redo stops being
symmetric — split-then-undo-then-split can land the id differently.

**D** says the head/tail rule is not the interesting part. The interesting part
is that anchors whose range falls entirely inside the tail must move with it.
That is correct, and it is the only option that is correct in every case.

**It also invalidates the operation signature.** A split under D cannot be
`(nodes) => nodes`; it has to return the new node list **plus a remap** of
which anchors moved where, because `packages/script` cannot reach the comment
rows itself. If D is the ruling, the operations are:

```
split(nodes, at): { nodes: ScreenplayNode[]; remap: AnchorRemap }
```

That is a bigger change than it looks and it is worth knowing before the
operations are written rather than after.

### Q2. Merge: which of the two ids survives?

Two nodes, `a` then `b`, merge into one. Same shape of question, plus two more:

- **The loser's id.** Is it retired, or tombstoned? Undo has to bring `b` back,
  and comments anchored to `b` have to come back with it. A hard delete cannot
  do that, so retirement needs a record either way.
- **Merging across types.** Can an Action merge into a Dialogue? If yes, what
  type comes out, and where do the loser's attributes go — a Character node's
  delivery modifiers have no home on an Action. Silently dropping them is data
  loss the writer did not ask for.

The symmetric answer to a head-wins split is a first-wins merge, so that
`split` then `merge` is the identity operation on ids. That symmetry is worth
something on its own: it makes the round trip testable as a property, which is
where AGENTS.md wants the fast-check budget.

### Q3. Paste: minted or preserved?

Three cases that behave differently and are easy to conflate:

1. **Paste from outside Folio** (plain text, `.fdx`, another app). All ids are
   minted. No controversy.
2. **Cut here, paste here.** If ids are preserved, cut-and-paste is a *move* and
   every comment follows the text, which is what a writer expects. If ids are
   minted, moving a scene up two pages silently detaches every comment on it.
3. **Copy here, paste here.** The same content is now in the document twice. Ids
   cannot be preserved, because the join key would repeat.

Case 2 and case 3 have the same clipboard payload. The only thing that
distinguishes them is whether those ids are still present in the target
document. So a paste rule of "preserve ids unless already present" makes paste
**a function of the target document's current state**, not just of the clipboard
and the insertion point.

That is implementable and pure — it just means the signature is
`paste(nodes, clipboard, at)` and the id decision happens inside it. But it
should be a deliberate choice, because the alternative ("clipboard carries a
flag saying whether it was a cut") pushes the decision up into the editor and
out of `packages/script`, where it would be much harder to property-test.

**Fourth case, and the one with schema consequences: paste across documents.**
Copy a scene from Episode 3 into Episode 5. If ids are preserved, node ids are
unique *per document* and not globally, and `packages/db` needs a composite
key — a comment row has to carry `(document_id, node_id)`, not `node_id`. If
ids are minted on a cross-document paste, node ids can be globally unique and
the join is a single column. **This one decides a column in a table that does
not exist yet, so it is cheap to rule on now and expensive later.**

### Q4. Delete and undo

Is a deleted node's id retired permanently? Undo has to restore it, so yes in
practice — which means delete is a tombstone, and an id is never reused. Worth
confirming, because "never reused" is a property that can be tested and a
guarantee the rest of the system can lean on.

Related: what happens to a comment on a deleted node? AGENTS.md already has a
precedent it could follow — "Records survive deletion. A name removed from the
script keeps its record with zero occurrences. `0 appearances · record kept` is
a designed, valid state." The analogous state for a comment is *detached*, not
*deleted*. That is a product decision, not a technical one.

### Q5. Type change

AGENTS.md says the id survives a type change, so this is only a question about
attributes: turning a Character cue into Action drops its delivery modifiers.
Does the operation drop them silently, or return what it dropped so the UI can
warn? The second is a small amount of extra work and is consistent with
"Errors" in Conventions — a lossy operation is data, not a surprise.

### Q6. Who mints an id?

Not `packages/script`. It has no `Math.random()`, no `crypto` and no `Date.now()`
(AGENTS.md, Development philosophy 2), which is exactly the constraint that
makes speculative derivation possible, and it should not be relaxed for this.

So every operation that creates a node takes ids from its caller — either a
supplier argument or a pre-minted list. This is not really a decision, it is a
consequence, but it is worth writing down because it is the first thing that
will tempt someone to weaken the purity rule.

---

## The other ruling this blocks: the id *shape*

AGENTS.md, Conventions > Naming: "Episode ids are `ep_NNN`. Note that scene ids
appear as `SCENE_xxx` in the route spec — the casing is inconsistent with
`ep_NNN` and needs one ruling before either is codified."

`packages/script` has not codified either. Ids are branded strings with no
format, and the only thing asserted about one anywhere in the package is that it
is not empty — true under every candidate. Three things need ruling together:

1. **Casing.** `SCENE_a1b2` or `scene_a1b2`. Cosmetic on its own.
2. **Is `SCENE_xxx` a node id or a derived-scene-record id?** These are
   different id spaces. The route spec uses `SCENE_xxx` in URLs, and URLs
   address derived entities, which suggests it is the scene *record*. If it is
   in fact the node id, then node ids carry a type prefix — and a type prefix
   contradicts AGENTS.md directly, because changing a Scene node to Action would
   have to change its id, and the id is supposed to survive a type change.
   **That contradiction needs resolving whichever way the casing goes.**
3. **Does `ep_NNN` encode an ordinal?** `ep_007` looks like episode seven. If an
   episode is reordered or deleted, does its id change? If it does, it is a slug
   and not an id, and something else is the real key.

### Ruling — **delegated to the implementer a second time, 2026-09-10**

Asked again, at the point where FDX and Fountain import were about to mint an id
for every node in a feature-length script. The answer was *"do whats best for
the application"*, so the ruling below was made by the implementer and is
recorded exactly as the split/merge/paste ruling above is: **each position is
reversible, and if one is wrong it is wrong because nobody with the product
context weighed it.** The one most worth a human look is 5.

1. **A node id is opaque.** No type prefix, no ordinal, no embedded meaning of
   any kind. It is a join key and nothing else.

2. **Node ids are globally unique**, not unique per document. This is not a free
   choice — it follows from the paste ruling already implemented above, where a
   cross-document paste mints. It fixes the column shape in `packages/db`: a
   comment or proposal row joins on `node_id` alone, not `(document_id, node_id)`.

3. **`SCENE_xxx` is the derived scene record's id, in a different id space.** It
   is not a node id. This is forced rather than chosen: a type prefix on a node
   id would have to change when a Scene node is retyped to Action, and AGENTS.md
   says the id survives a type change. The contradiction identified in the
   section above resolves this way or not at all.

4. **Record-id prefixes are lower case**: `scene_…`, `ep_…`, `chr_…`, `loc_…`.
   One rule across every id space, matching the `ep_NNN` that AGENTS.md already
   fixes in lower case, so the route spec's `SCENE_xxx` becomes `scene_xxx`.
   This is the purely cosmetic half. If the route spec's upper case is
   load-bearing for something already written down, overrule this one freely —
   nothing depends on it.

5. **`ep_NNN` is a slug, and the episode's key is a separate opaque id.**
   `ep_007` visibly encodes an ordinal, and an ordinal moves when an episode is
   reordered or deleted. An identifier that changes is not an identifier. The
   alternative is a product claim — that episodes are never reordered — which
   the implementer is not in a position to make. **This is the one to look at.**

6. **`packages/script` codifies none of it.** Ids there stay branded strings
   asserted only to be non-empty, and no validating reader was added. The pure
   core cannot mint an id (Q6 above), so the format belongs where ids are minted
   — `packages/db` and `packages/contracts` — and putting it here would couple
   the deterministic core to a decision it has no part in. `ids.ts` is unchanged
   by this ruling except for its comment.

   In practice this is what let Fountain and FDX import ship while the ruling was
   open at all: `parseFountain` and `importFinalDraft` take `freshIds` from the
   caller and return `not-enough-ids` rather than inventing one, and
   `countFountainNodes` / `countFdxNodes` say how many are needed before a single
   one is spent.

## Recommendation, offered only as a starting position

Split **D** (head keeps the id, anchors in the tail are re-pointed, operations
return a remap), merge **first-wins with a tombstone**, paste **preserves ids
within a document when they are absent and mints across documents**, delete
**tombstones**, type change **returns what it dropped**, and node ids
**globally unique, opaque, no type prefix** — with `SCENE_xxx` read as the
derived scene record's id, in a different id space from node ids.

That set is internally consistent and each piece is testable. It is a
recommendation and not a decision, and none of it is in the codebase.

## Consequences

- **`packages/db`.** A comment, proposal or provenance row anchors on a single
  `node_id` column. No composite key, because cross-document paste mints.
- **Id minting lives outside `packages/script`.** The pure core has no entropy
  and now, deliberately, no id format either.
- **Retirement is a real row.** Delete tombstones and an id is never reused, so
  `packages/db` needs somewhere to record a retired id and the detached anchors
  that used to point at it.
- **Two id spaces, not one.** `scene_…` addresses a derived scene record and
  appears in URLs; a node id is opaque and appears in no URL. Anything that
  reads a scene id out of a route must not hand it to a node lookup.
- **Episode identity is unresolved in the schema.** Ruling 5 says `ep_NNN` is a
  slug over a separate key. Nothing in the repo implements either yet, so the
  cost of reversing it is currently zero and rises the moment a migration lands.
- **Import is unblocked.** Fountain and FDX both ship taking `freshIds` from the
  caller, so neither had to wait for any of this.

## Alternatives considered

Set out per question above.

## Does this keep the script authoritative?

Yes, under every option, provided one thing holds: the node id stays the only
anchor. The failure mode this decision has to avoid is a system that, having
lost an id at a split, starts anchoring comments by text offset or by matching
prose. That is the classic case of another surface quietly becoming
authoritative, and it is what makes this worth an ADR rather than a commit.
