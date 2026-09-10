# ADR 0002 — Episode identity: `ep_NNN` is a slug, not a key

- **Status:** Accepted — **decision delegated to the implementer, 2026-09-11.**
- **Date:** 2026-09-11
- **Deciders:**
- **Supersedes / superseded by:** Implements item 5 of the "Ruling" section of
  [ADR 0001](./0001-node-identity.md).

> This is the third delegated ruling in this repository, and it is recorded the
> same way as the other two. ADR 0001's second ruling flagged its own item 5 as
> **"the one to look at"**, because it "rests on a product claim about whether
> episodes are ever reordered" which "the implementer is not in a position to
> make". It was escalated again before `packages/db` was written, at the last
> moment where reversing it is free. The answer was *"do whats best for the
> application"*.
>
> So the position below was taken by the implementer. **Each position is
> defensible and it is reversible today; if it is wrong, it is wrong because
> nobody with the product context weighed it.** The cost of reversing it rises
> the moment there are rows.
>
> AGENTS.md's *Open decisions* table is not amended by this file. Amending the
> contract is a separate call.

## Context

AGENTS.md, Conventions > Naming: "Episode ids are `ep_NNN`." AGENTS.md, Routing:
`:episodeId` shares a path position with nine reserved project-scoped names and
"keep ids to the `ep_NNN` shape".

Read literally, that makes `ep_007` the episode's identifier — the value other
tables join on. ADR 0001 raised the objection that decides this:

> **Does `ep_NNN` encode an ordinal?** `ep_007` looks like episode seven. If an
> episode is reordered or deleted, does its id change? If it does, it is a slug
> and not an id, and something else is the real key.

`packages/db` cannot be written without answering it. `documents.episode_id`,
`revisions.episode_id` and `measurements.episode_id` all point at something, and
whether that something is a `uuid` or the text `ep_007` is a column, three
foreign keys and every index over them.

## Decision

**`episodes.id` is an opaque UUID. `episodes.slug` is `ep_NNN`, unique within a
project, and is what the router reads.** A third column, `ordinal`, carries the
running order.

Everything joins on `id`. Nothing joins on `slug`. Exactly one function turns a
slug into a key — `readEpisodeBySlug` in
[`packages/db/src/repositories/projects.ts`](../../packages/db/src/repositories/projects.ts) —
and `listEpisodes` orders by `ordinal`, deliberately not by `slug`, so that
sorting cannot quietly make the slug authoritative again.

The slug is generated from the ordinal when the episode is created and is **not
regenerated afterwards**. Reordering moves `ordinal`; `slug` and `id` both stay
put.

## Why

The argument is one sentence: **an identifier that changes is not an
identifier**, and `ep_007` visibly encodes a position, which is the kind of
thing that changes.

Concretely, if `ep_NNN` were the key, then inserting an episode between 3 and 4
forces one of three outcomes, and all three are bad:

1. **Renumber.** Every following episode's id changes. Every `episode_id` in
   `documents`, `revisions` and `measurements` has to be rewritten in the same
   transaction, and every URL anyone has bookmarked or pasted into a production
   email now points at somebody else's episode.
2. **Do not renumber.** The ids stop matching the running order, so `ep_004`
   is the fifth episode. The id was chosen to be readable and it is now
   actively misleading — worse than an opaque one.
3. **Refuse to insert.** A product decision made by a schema, which is the thing
   AGENTS.md, Development philosophy 10 forbids: "Never invent a product
   decision."

Splitting the two costs one `uuid` column, one unique index and one lookup on
episode-scoped routes. It buys the ability to reorder, insert and delete
episodes without touching a foreign key.

It also keeps AGENTS.md's requirement intact where it is actually observable:
the URL still reads `/project/:id/ep_001/script`, the reserved-name validation
still works — `ep_NNN` collides with none of `characters`, `locations`,
`timeline`, `bible`, `research`, `insights`, `production`, `settings`, `assets`
— and `EpisodeSlugSchema` in `@folio/contracts` enforces the shape. Nothing a
user sees changes.

## What would make this wrong

One product claim: **episodes are never reordered, renumbered, or inserted
between two others, over the whole life of a project.** If a showrunner declaring
"the old episode 4 is now episode 6" is not a thing that happens here, then this
ADR is an extra column and a lookup for nothing, and item 5 of ADR 0001 should be
overruled.

That claim is the reason this needs a human. The implementer has no basis for
it. Television as an industry reorders episodes routinely; this specific product
and its specific users might not.

## Consequences

- **`episodes` has three identity-ish columns**: `id` (the key), `slug` (the
  route), `ordinal` (the order). Two unique indexes,
  `episodes_project_slug_key` and `episodes_project_ordinal_key`, keep each
  unambiguous within a project.
- **Every episode-scoped route costs one lookup**, slug to id. It is a unique
  index hit and it happens once per request, alongside a membership check that
  is not free either.
- **Reordering is not implemented.** Nothing in this phase moves an episode.
  What the ADR buys is that when somebody does implement it, it is an `UPDATE`
  of `ordinal` and nothing else — no foreign key rewrite, no dead URL.
- **`formatEpisodeSlug` is the only place the padding is written.** `ep_001`,
  three digits minimum, generated from the ordinal at creation.
- **A film stores one episode row**, unchanged by any of this. AGENTS.md,
  Routing: "The router special-cases the shape; the schema never does."
- **Reversing it is cheap until there are rows.** Undoing it means dropping
  `episodes.id`, promoting `slug` to the primary key, and changing three foreign
  keys — trivial with an empty database, a data migration afterwards.

## Alternatives considered

**`ep_NNN` as a text primary key.** One column, no lookup, the URL is the key.
Simpler in every way that can be measured, and it asserts as a fact about the
product that an episode is never reordered. Lost because nobody has asserted
that, and the schema is not the place to assert it by accident.

**`ep_NNN` as the key, with a separate immutable `stable_id` for joins.** The
same split with the roles reversed, and worse: the primary key would be the
mutable one, so a reorder would still cascade.

**A slug that is not ordinal-shaped** — `ep_pilot`, `ep_the-chawl`. Sidesteps the
problem entirely, and contradicts AGENTS.md, which fixes the shape as `ep_NNN`.
Not available without a contract change.

## Does this keep the script authoritative?

Yes, and it removes a way it could stop being.

An episode is a container for documents, and the script's authority rests on
every node reliably belonging to exactly one of them. Under a mutable episode
key, a reorder rewrites `documents.episode_id` in bulk — and a bulk rewrite that
half-fails leaves nodes attached to the wrong episode, which is precisely "some
other surface quietly becoming authoritative" for which episode a scene is in.
An opaque key makes that class of failure unreachable: the edge never moves.
