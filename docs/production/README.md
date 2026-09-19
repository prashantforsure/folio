# Production — the feature documentation set

The Production route turns a scene of the screenplay into a finished clip with consistent
characters: cast the film, board the scene, draw the frames, shoot the reel, cut it into the next.
It is the most important feature of Folio and it is built **in parts, across several Claude Code
sessions**, each with a fresh context window. These documents are the memory between sessions.

**Status: documentation complete (2026-09-19); nothing in this set is built yet.** The route that
exists today (`apps/web/app/(app)/app/project/[projectId]/_production/`, migration `0014`) is the
2026-09-16 v2 pass over the *old* mockup — reel rows with three columns, no worker, every job queued
forever. This set replaces its spec. What it keeps from that pass is listed in
[03-data-model.md](03-data-model.md) and [05-phases.md](05-phases.md).

## Read in this order

| # | File | What it is | Read it when |
|---|---|---|---|
| 0 | this file | the index, the session protocol, the status board | every session, first |
| 1 | [01-prd.md](01-prd.md) | the product requirements: goals, users, the pipeline, every functional requirement (`FR-…`), non-functional requirements, constraints, success criteria | before design; skim before any phase |
| 2 | [02-design-spec.md](02-design-spec.md) | the design specification for Claude Design: every screen, region, card, state, copy string, token and interaction; the list of mockup frames to produce | before the mockups; before any frontend phase |
| 3 | [03-data-model.md](03-data-model.md) | tables, columns, enums, migrations, the job `spec`/`route` JSON, the registry, the art-style data | before any migration or repository work |
| 4 | [04-generation-pipeline.md](04-generation-pipeline.md) | how consistency actually works: the six layers, prompt assembly, reference ranking, the provider adapter, the worker loop, ledger flow, stale hashing, moderation, cost | before the worker or any `✦` action |
| 5 | [05-phases.md](05-phases.md) | the build plan: six phases, each self-contained — scope, files, acceptance criteria, verification, and the session checklist | at the start of every build session |
| 6 | [06-decisions.md](06-decisions.md) | rulings taken, assumptions flagged, escalations pending, and the log every session appends to | every session; append at the end |
| 7 | [07-reference.md](07-reference.md) | what laper.ai and preview.io do, verbatim where it matters, so no session re-researches | when a question starts with "what does Laper do about…" |

The repo-wide contract still applies on top of these: `AGENTS.md` (open decisions, constraints, the
ask-first list), the root `CLAUDE.md`, `apps/web/CLAUDE.md`, `packages/db/CLAUDE.md`, and the route
history in `docs/build-decisions.md`. Where this set and `AGENTS.md` disagree, `AGENTS.md` wins and the
disagreement is logged in [06-decisions.md](06-decisions.md).

## The session protocol

Every Production session, whatever its phase:

1. **Open** — read this README's status board, then [06-decisions.md](06-decisions.md) (the log at
   the bottom is what the last session left), then the one phase section in
   [05-phases.md](05-phases.md) you are executing. Read the other files only for the parts the phase
   names. Read `AGENTS.md` "When to ask first", "Open decisions" and "Jobs, credits and cost".
2. **Check the tree** — `git status` first. Other sessions edit this checkout concurrently; re-read a
   shared file before editing it. The phase section lists the files it touches.
3. **Build** — to the phase's acceptance criteria, nothing more. A phase is done only when every
   criterion is met and every gate is green (`pnpm typecheck`, `pnpm lint`, the named tests,
   `pnpm build`; trap: `>>> FULL TURBO` means nothing ran — force it).
4. **Record** — append to the log in [06-decisions.md](06-decisions.md): what was built, what was
   left, every judgement call, every rule you were tempted to break. Update the status board below.
   Add the phase's section to `docs/build-decisions.md` in the house style (rulings table, what was
   built, every state and how to reach it, judgement calls, not built, verification).
5. **Escalate, don't resolve** — anything in the ask-first list stops the session with a question.
   Pricing, refunds, schema, dependencies, widening the assistant: all of them.

## Status board

| Phase | Name | Status | Session notes |
|---|---|---|---|
| D | Design mockups in Claude Design (from [02-design-spec.md](02-design-spec.md)) | not started | produce the frames listed in §2.12; the user reviews; the approved frames become the spec for phases 2–5 |
| 0 | Rulings ([06-decisions.md](06-decisions.md) §3) | pending | prices, refunds, film-settings shape, clip-length source, dependencies, env block |
| 1 | The job model, the worker, identity (Looks, plates, frames that draw) | not started | |
| 2 | The reel canvas (scene tabs, reel strip, cards, scene still, auto-assign) | not started | |
| 3 | The clip (render, versions, continuity, shoot cost) | not started | |
| 4 | Assembly, tasks, review, exports, the assistant | not started | |
| 5 | Later (voice, multi-shot, repair, continuity findings, kanban, FCPXML, stitch) | not started | each item needs its own ruling |

## One-paragraph summary for a cold start

Folio's screenplay is a typed node list and the only hand-authored artefact; scenes, cast and
locations derive from it. Production is the episode-scoped route where a scene's derived shots
(the Storyboard's rows) are grouped into **reels** — fixed-length clips (5/8/10/15 s, default 15) —
and each reel walks five stages: **Scene** (a still of the place and light), **Performance** (the
scene's own action and dialogue, read-only, derived), **Shots** (the timed shot list, durations
summing exactly to the clip), **Frames** (one image per shot, kept as takes), **Clip** (the video,
kept as versions, match-cut into the next reel). Consistency comes from **reference discipline**:
every generation is conditioned on the same kept character **Look**, the same location **plate**,
the same **Art Style** prefix, assembled server-side from the records; change any of them and the
dependent outputs go **stale**. Every generation is a **job** on a worker with its cost named
before it is spent, held on submit, settled on success, refunded on failure. The UI is a
scene-tab → reel-strip → reel-canvas layout, drawn on Folio's dark, chrome-light design system.
