# ADR 0003 — The agent copilot: writes, roles, credits and execution

- **Status:** Accepted — **2026-09-23**
- **Date:** 2026-09-23
- **Deciders:**
- **Supersedes / superseded by:** Amends item 3 of the "Ruling" section of
  [ADR 0001](./0001-node-identity.md) (see **D8**). Closes AGENTS.md open
  decisions **2**, **10**, **13** and **16**.

> Unlike ADRs 0001 and 0002, this one is **not a delegated ruling**. Each
> decision below was taken with the product context in hand, and the rulings
> it depends on are already dated **2026-09-23** in AGENTS.md as **R1–R8**.
> Where a decision here differs from something written earlier, this file wins
> and the earlier text is amended in the same change.
>
> The plan of record is
> [`docs/agents/integration-plan.md`](../agents/integration-plan.md). The task
> list is [`docs/agents/roadmap.md`](../agents/roadmap.md), the craft rules are
> [`docs/agents/craft.md`](../agents/craft.md), and the tool catalogue is
> [`docs/agents/tools.md`](../agents/tools.md). This file holds the decisions
> those three assume.

## Context

Folio is getting an AI copilot in an app-wide side panel: one assistant that can
do anything a user can do, driven by a model instead of a cursor. Four things
about the repository as it stands force the decisions below.

**The proposal surface is specified and unbuilt.** AGENTS.md has said since the
beginning that "every write returns a proposal, never a mutation", anchored to
node ids and rendered as hunks. No table, no executor and no card exists. An
agent shipped before that surface would be writing directly to the node list,
which is the one thing the contract forbids.

**The assistant is read-only by construction.** `apps/web/lib/assistant/server.ts`
streams text with no tools, and its system prompt tells the model it cannot edit.
Turning it into an actor is a product decision, not a refactor.

**Roles are stored and enforced almost nowhere.** `memberships.role` is one of
`owner | writer | reader` and is read in exactly two places:
`apps/web/lib/share/actions.ts:29,37` blocks a `reader` from managing share
links, and `apps/web/lib/projects/actions.ts:344` requires `owner` to purge — a
check sitting behind an unconditional refusal two lines later. Every other gate
asks only whether a membership row exists. `apps/web/lib/script/gate.ts:25-29`
says why: a capability model invented in a commit would be a product decision
taken by accident. An agent makes that gap urgent, because "the agent may do
whatever the user can do" is a sentence with no content while the answer is
"anything".

**There is no worker.** `apps/worker/src/index.ts` is seven lines and exports one
constant. Production's generations run inside the web request through `after()`
with three-second client polling. That is survivable for a single image; it is
not survivable for a run that drafts a script.

Everything below is a decision a writer can observe, or one that fixes a column,
a file or a limit that code has to be written against.

---

## Decision

### D1 — Writes are proposals; actions with no diff take confirmation

Every agent write to the script, the outline or a record is a **proposal**: a
stored, ordered list of operations the user reviews before anything lands,
rendered as hunks for the script and the outline and as before/after values for
a record. Actions with no diffable form — an upload, a generation, a canvas move
— take **explicit confirmation** instead. Each user carries an autonomy setting,
`review` (the default) or `auto`; under `auto` a proposal applies the moment it
is planned, except that operations in **confirm** or **paid** mode always stop
for an explicit confirmation regardless of the setting.

*Rationale.* This is AGENTS.md ruling R1 written down as a mechanism. The
narrowing to script, outline and records is what makes the rule honest: a diff of
an image generation is theatre, and dressing a confirmation up as a proposal
teaches writers to click past both. Confirmation is not a weaker proposal — it
still names what will happen before it happens, and for a paid action it names
the cost. The autonomy setting exists because a writer who has watched twenty
proposals land correctly should not have to approve the twenty-first, and the
two always-confirming modes exist because the operations that spend money or
cannot be undone are exactly the ones where that habituation is dangerous.

This decision also **closes AGENTS.md open decision 2** — "the numeric thresholds
separating review tiers 1 / 2 / 3" — by removing the thresholds rather than
setting them. Three tiers separated by numbers nobody could name was a design
waiting on arithmetic that was never going to arrive. Two autonomy settings and
two always-confirming modes carry the same intent and are decidable from the
operation alone. **There are no tier numbers. Do not go looking for them.**

### D2 — Three roles, and the gates enforce them for the UI and the agent alike

- **`reader`** — the read tools and comment threads. Nothing else.
- **`writer`** — everything a reader can do, plus all authored edits, entity
  operations, production edits, paid generations, share links, and creating or
  renaming episodes.
- **`owner`** — everything a writer can do, plus deleting episodes and editing,
  archiving, trashing, restoring or purging the project.

The gates enforce this. A role check is a server-side condition in
`apps/web/lib/script/gate.ts` and the account gates, applied to a request from
the browser and a request from the agent identically.

*Rationale.* This **closes AGENTS.md open decision 16**, and it closes it because
the copilot cannot be specified without it. The shape was chosen to ratify what
the two existing checks already do rather than to invent a matrix: share-link
management treats owner and writer alike and blocks a reader, and purge is
owner-only. The line between writer and owner is the line between *changing the
work* and *changing or destroying the container* — an episode or the project
itself. A writer drafts, a writer generates, a writer invites; only an owner can
make the thing they were invited to disappear.

The decision is closed; **the code is not written**. Role is still enforced in
two places today, and bringing the other gates up to this is roadmap Phase 1
work. Recording the ruling and shipping the enforcement are two different events,
and this file is only the first.

### D3 — Conversation turns are free; generations are not

Agent conversation turns are **not charged** at launch. Input and output tokens
are **recorded per run** on `agent_runs`. A **per-user daily token cap**, a
constant in `apps/web/lib/agent/limits.ts`, stops runaway use. Paid generations
**always** require a confirmation showing the cost and the current balance. Each
run starts with a **credit budget of 0**, and the budget is granted by the user
in that confirmation.

*Rationale.* This **closes AGENTS.md open decision 13** — "whether an assistant
message costs credits, and how much". Charging per turn would price the thing
the product most wants writers to do, and it would put a number on the button
that changes every time the model's context does. `GENERATION_COSTS`
(`packages/contracts/src/production.ts:335-343`) already prices text-only jobs at
0 "pending AGENTS.md open decision 13"; this is that ruling, and the provisional
zero becomes the real one. Recording tokens without charging them is what makes
the decision reversible: if turns must be priced later, the data to price them
with is already there.

The budget starting at 0 is the safety property that matters. A run cannot spend
by accident, cannot be talked into spending by its own output, and cannot carry a
budget forward from a previous run. Every credit it spends was granted by a human
looking at a number, which is AGENTS.md's "cost is named before it is spent"
applied to an actor that can call a tool in a loop.

### D4 — Background runs are allowed, and act as their starter

A run may continue in the background. It **acts as the user who started it** and
**re-checks membership and role before every step**. Runs can be **cancelled**,
and they **resume after a crash**.

*Rationale.* A run that drafts an episode outlives a tab, and AGENTS.md already
says job completion is in-app only — there is no mail provider to notify with, so
the run has to survive being walked away from or it cannot be relied on at all.
Re-checking membership and role per step, rather than once at the start, is the
difference between a durable run and a durable credential: a writer removed from
a project mid-run must stop being able to write to it, and a run holding a
snapshot of its permissions is exactly how that fails quietly.

### D5 — Short turns in the request, long work in a real worker

Short interactive turns run inside `POST /api/assistant`, capped at **12 model
steps and 60 seconds**. Anything longer runs as a job in `apps/worker`: a
separate, long-running Node process with its own Dockerfile, deployable to any
container host. **The web app's hosting does not change.**

*Rationale.* Two caps rather than one, because the two failure modes are
different: 12 steps bounds a model that has started looping, and 60 seconds
bounds a request the platform will kill anyway. Past either, the work is a job.
AGENTS.md already bans serverless functions as queue consumers because jobs are
long-running and stateful, so the worker is a process, not a function, and giving
it a Dockerfile keeps that promise portable — nothing here commits the web app to
a host, and there is no deploy manifest in the repository to contradict.

`apps/worker` today has a `typecheck` and a `lint` script and no build step. Its
header comment still says "BullMQ consumers", which D6 contradicts; that comment
is stale and is corrected when the worker is built, not by this file.

### D6 — The queue is the `jobs` table. No Redis, no BullMQ

Work is claimed from the existing `jobs` table with **`SELECT … FOR UPDATE SKIP
LOCKED`**, woken by **`LISTEN`/`NOTIFY`** over the session pooler. There is no
Redis and no BullMQ. **`REDIS_URL` is never added.**

*Rationale.* This is AGENTS.md ruling R6. A `jobs` table already exists with
status, cost, payload, cancellation and error columns; a second queue beside it
would make the job row and the queue entry two authorities on the same fact,
which is the failure this codebase is most consistently architected against.
Postgres does the job: `SKIP LOCKED` is a claim, `LISTEN`/`NOTIFY` is a wake-up,
and the session pooler that both need is already modelled as a type parameter on
the scope (`ProjectScope<'session'>`, `packages/db/src/scope.ts:82-102`) with
nothing using it yet. Adding Redis would also be a dependency decision, and
AGENTS.md puts that behind a question every time.

**`REDIS_URL` is a doc edit, not a code change.** The variable does not exist —
not in `packages/db/src/env.ts`, not in any `.env`, read by nothing. It is named
only inside the block headed *Deliberately absent* at `.env.example:154-163`,
explaining why it is not there. That line comes out when the worker lands.

*Consequence, recorded here so it is not discovered later:* `jobs` has **no
`attempts` column and no claim, lease or heartbeat columns**
(`packages/db/src/schema/storyboard.ts:124-160`), and `JOB_KINDS` is
`['frame_generation']` alone (`packages/contracts/src/enums.ts:324`). D6 needs a
forward migration and a contracts change, not only worker code.

### D7 — Interactive turns stream; background runs are polled

Interactive turns stream **newline-delimited JSON events**. Background runs are
**polled every 2 seconds** while live.

*Rationale.* AGENTS.md's no-realtime constraint (R5) is not a gap to work around
here — it is the right answer twice. A streaming response is not realtime; it is
one request whose body arrives in pieces, which is what a turn already is.
Newline-delimited JSON rather than plain text because the panel has to tell a
sentence from a proposal from a navigation, and a typed event stream is how it
does that without parsing prose. Polling for background runs matches what
Production's generations already do, and two seconds is that same cadence: fast
enough to feel live, cheap enough to be a plain query.

### D8 — A scene's identity is its heading node id

A scene is identified by **the id of its heading node**. There is no separate
scene id space. **ADR 0001 Ruling 3 is amended to match**, and its Consequences
bullet "Two id spaces, not one" no longer holds. The prefixed forms `SCENE_xxx`
and `scene_xxx` are retired and address nothing.

*Rationale.* This **closes AGENTS.md open decision 10**, and it closes it in
favour of the code, because the code was right. `SceneRecord.id` has always been
the heading node's own id (`packages/script/src/entities.ts:332-336`), `scenes`
is keyed by `scene_node_id` as its primary key with the comment "it is the
**heading node's id**, not a minted one" (`packages/db/src/schema/derived.ts:580-583`),
and Production's v12 schema says the same and cites this open decision by name
(`packages/db/src/schema/production.ts:66-69`). Six tables key a scene this way.
Ruling a second id space into existence now would mean minting an id for every
scene in every script that already exists, to be a join key for a join that
already works.

Ruling 3's objection survives intact, because it was never an objection to
*sharing* the id — it was an objection to the **prefix**. A type prefix on a node
id would have to change when a Scene node is retyped to Action, and AGENTS.md
says an id survives a type change. Dropping the prefix answers it completely: the
id is opaque, Ruling 1 stands untouched, and retyping a heading changes no id at
all — the scene record simply stops existing, which is what `derive` already does.

### D9 — Text order keys are collated `C` on the column

`nodes.order_key`, and every other text order key, gets **`COLLATE "C"` on the
column itself**, in a forward migration.

*Rationale.* An order key is a byte string compared lexicographically, and under
a locale collation it is not. This is not hypothetical: the incident recorded at
`packages/db/src/order.ts:72-77` is a 2,937-node feature whose sort started at
the 3,000th key under `en_US.UTF-8`, where "172 of 220 cards disagreed with
themselves". The read-side half of the fix already shipped — `byOrderKey` spells
`COLLATE "C"` into the query (`packages/db/src/order.ts:86`) — and `order.ts:79-84`
already names the missing half: *"the durable half is a forward migration putting
the collation on the column itself, so an index or an ad-hoc query cannot fall
back to the locale."* An agent composing order keys in a loop is what makes
waiting for the durable half untenable.

The blast radius is one column. `nodes.order_key` is plain `text`
(`packages/db/src/schema/columns.ts:68`); the only other live text order key,
`shots.order_key`, **already carries the collation**
(`packages/db/migrations/0006_storyboard_route.sql:77`); `reels.order_key` was
dropped with Production v1 in migration `0025`, and v12 uses a numeric
`position`. *Consequence:* the unique index `nodes_document_order_key` is built
under the database default collation, so the migration rebuilds it rather than
leaving a read that cannot use it.

### D10 — Script and outline edits go through the open editor, or through a CAS

The agent emits **node-level operations**. If the writer has that document open,
**their editor applies the operations** and the normal autosave persists them.
Otherwise the **server applies them with a compare-and-swap on the node digest**.
On a mismatch the proposal becomes **stale** and is re-planned.

*Rationale.* `saveScript` replaces the whole node list and the last save wins, so
an agent saving in the background erases whatever the writer typed while it was
thinking. Routing through the open editor keeps the invariant that there is only
ever **one writer to the node list**, and it costs nothing — the operations are
the same seven in `packages/script`, and the autosave that follows is the one
that already runs. The compare-and-swap covers the case with no editor open, and
a stale proposal is re-planned rather than force-applied because an operation
list planned against a document that has since changed is a description of a
document that no longer exists. This is AGENTS.md ruling R5 and the reaffirmed
no-realtime constraint: the race is closed by the CAS, not by a CRDT.

### D11 — Every agent change is attributable and undoable in one step

Agent-written nodes carry `provenance_source = 'agent'` with the **run id** in
`provenance_run_id`. Agent-created characters carry `origin = 'agent'`. Every
applied proposal **first snapshots `versions` with `reason = 'before_agent_run'`**.
Every applied operation writes an **`activity_log`** row.

*Rationale.* All four hooks already exist and nothing writes any of them.
`nodes` enforces the pairing by CHECK — `(provenance_source = 'agent') =
(provenance_run_id IS NOT NULL)` — so "agent-authored with no run" is
unrepresentable rather than merely discouraged
(`packages/db/src/schema/documents.ts:225-228`). `CHARACTER_ORIGINS` includes
`'agent'` and is write-once. `before_agent_run` is a declared `version_reason`
with zero writers (`packages/contracts/src/history.ts:66`), and
`packages/db/src/schema/history.ts:74-77` says what it is for: it "is what makes
'revert this run' one operation rather than a reverse-diff". `activity_log`
exists with no reader yet. D11 is not new schema; it is the decision to start
using the schema that was built for this and then left empty.

### D12 — Two model registries, and neither is an environment variable

The agent reasons and drafts with the model constant in
`apps/web/lib/assistant/model.ts`. Image and video generation stay on
`MODEL_REGISTRY` in `packages/contracts/src/production.ts`.

*Rationale.* These are two different decisions with two different owners. Which
model reads a writer's draft is a product decision, and
`apps/web/lib/assistant/model.ts:1-8` already says why it is a constant and not a
setting: "a setting is how it drifts between deployments". Which model renders a
frame is a pipeline decision priced per tier, and AGENTS.md requires that the
writer sees tiers — `Draft · Standard · Cinema` — and never a model name. The
copilot adds no third place; it reads the one that already exists for text.

### D13 — Tools take their schemas from `@folio/contracts`

Tool input schemas come from `@folio/contracts`, converted with Zod 4's
`z.toJSONSchema`. Each turn loads the **core toolset**, the **current route's
toolset**, and a **`load_toolset`** tool. The API's **`tool_use` id is the
idempotency key** for every create.

*Rationale.* The Zod schema an action already validates with is, definitionally,
the schema a tool that calls that action needs; writing a second one would be
the same shape declared twice and drifting from the first commit. Loading by
route rather than all at once keeps the tool block small enough to cache and
keeps the model's choice close to what the user is looking at; `load_toolset` is
the escape hatch for a task that crosses routes. The idempotency key is the
model-loop-specific hazard: a retried tool call is indistinguishable from a
second intentional one, and without a key it creates two characters.

### D14 — Postgres-backed fixed-window rate limits

- **60** assistant requests per user per project per hour.
- **2** concurrent agent runs per project.
- **30** generate actions per user per project per hour.

*Rationale.* No rate limiting of any kind exists today — the only `429` handling
in the repository reacts to Supabase's own limit on auth. A model that can call a
tool in a loop is the first thing in this product that can generate load without
a human clicking, so the limits ship with it rather than after the first
incident. They are Postgres-backed and fixed-window because D6 already rules out
Redis, and a fixed window is a counting query: approximate at the boundary, exact
enough for limits set well above real use, and requiring no new dependency. The
concurrency limit is per project rather than per user because it protects the
document, not the bill.

### D15 — Outside a project, the panel is a launcher

Outside a project the panel can **list and open projects** and start **"new
project from a story"**, which creates the project after confirmation and
continues the chat inside it. **No chat is stored outside a project.**

*Rationale.* A panel that is app-wide but inert on the account routes is a
promise the product does not keep, and the two things a user wants there —
find my project, start a new one — are both reachable. Storing no chat outside a
project is what makes it free: every table except `users` carries `project_id`,
enforced by the type system (a table with no `project_id` is not assignable to
`ProjectScopedTable`), so a chat with nowhere to belong would need either a
nullable tenancy column or an exception to the one invariant the tenancy model
has. The launcher conversation lives in the client until it has a project to
belong to, and then it is a project chat like any other.

### D16 — What the agent is not given

Not exposed: sign-in and account settings, passwords, sign-out, account deletion,
share links, `deleteEpisode`, `importScript`, purge, duplicate, view preferences,
canvas positions, and **every Research write**. **Export is allowed**, read-only,
for the requesting user.

*Rationale.* Four different reasons, kept apart on purpose.
*Not creative surfaces* — settings, people, billing and keys, per AGENTS.md
(R2). *Destructive with no diff* — `deleteEpisode`, purge, duplicate: an episode
is a container of work, and duplicate has an open decision on it
(AGENTS.md open decision 15) that an agent must not pre-empt. *Replaces rather
than edits* — `importScript` overwrites the whole node list, which is not a
proposal-shaped act. *Cosmetic* — view preferences and canvas positions are the
user's own arrangement of their workspace, and an agent tidying them is a change
nobody asked for. *Evidence* — Research is read-only under R3, reaffirmed
2026-09-23 over the integration plan's own catalogue: a model that can edit the
evidence cannot be used to check itself, so `add_source`, `clip_line` and
`send_clip` are out.

Export is the one that went the other way (R2): a download is a read, it produces
a file the user could have clicked for themselves, and refusing it made the agent
less useful than the UI beside it.

**D2 and this decision are not in conflict, and neither should be "fixed" against
the other.** D2 says the *writer role* may create share links — that is the role
gate, and it governs the UI. D16 says the *agent* gets no share-link tool — that
is tool exposure. A writer using Folio can mint a link; the agent acting for that
writer cannot. Two lists, two purposes.

### D17 — Exactly two pre-approved dependencies

`pdf-lib` and `@pdf-lib/fontkit` are pre-approved, **for Phase 5 only**. Any
other new dependency needs human approval, as always (AGENTS.md ruling **R7**).

*Rationale.* AGENTS.md's dependency rule is unchanged and this is not an
exception to it — it is the one approval granted in advance, for the one thing
that cannot be done without a package. PDF export must agree with on-screen
pagination exactly, which is why headless Chrome is on the banned list: its text
metrics do not match the sheet. `pdf-lib` draws text at coordinates the layout
engine already computes, and `@pdf-lib/fontkit` is what lets it embed the
typeface. Nothing else in the copilot work is expected to need a package: the
worker runs on the `jobs` table (D6) and tool use comes from the
`@anthropic-ai/sdk` already installed.

### D18 — Reports never call a model

A report never calls a model. The agent may call report tools and phrase their
results, but **the numbers always come from code**.

*Rationale.* This is AGENTS.md's existing rule (R4) and it survives tool use
intact — in fact tool use is what makes it enforceable, because the agent now has
a report tool to call instead of an invitation to count. Asking a model to count
is slower, costs money and is less accurate than the code it would replace. The
clarification the copilot adds is about voice, not arithmetic: the model may say
"forty-one scenes, and eleven of them are night exteriors" in its own words, and
an answer stating a count the code did not produce is a bug, not a phrasing
choice.

### D19 — An eval harness in the repo, run on demand

An eval harness with **fixture stories and a rubric** lives in the repo and runs
**on demand, not in CI**.

*Rationale.* The output this product cares about is a scene that works, and no
assertion decides that. A rubric over fixture stories is the closest thing to a
regression test for craft, and it is worth having in the repo where a prompt
change can be measured against it. It stays out of CI because it calls a model:
it costs money per run, it is not deterministic, and a non-deterministic paid
check wired into every push is a check people learn to ignore. There is no CI
workflow in the repository today, so this decides how the harness is run, not
what it is added to.

---

## Consequences

**What becomes easier.** Every remaining question about the copilot is now an
engineering question. The attribution hooks that were built and left empty —
`provenance_source`, `characters.origin`, `before_agent_run`, `activity_log` —
get a writer. Four open decisions close, which unblocks the review flow (2), any
URL naming a scene (10), charging for model work (13) and every gate that wanted
to consult a role (16).

**What becomes harder.** Three decisions imply migrations rather than code alone:
D6 needs job kinds and claim columns, D9 needs a collation change and an index
rebuild, and D11's proposal tables do not exist. D2 makes role a real condition
in gates that have never had one, which means every existing caller must be read
for what it now refuses. D5 gives `apps/worker` a build step and a deployment it
has never had.

**What is foreclosed.** A second queue. A second scene id space. A per-turn
charge at launch. An agent that writes to the node list without going through a
proposal or a compare-and-swap. An agent with a permission set larger than the
user it acts for.

**What is deliberately still open.** AGENTS.md open decisions 3, 7, 8, 9, 11, 12,
14 and 15 are untouched by this file. In particular, **15** — what duplicating a
project copies — is why `duplicate` is on D16's list rather than given a tool.

## Alternatives considered

**Direct writes with an undo, instead of proposals.** Rejected: it contradicts
AGENTS.md's oldest rule about the agent, and "undo" is not a review — it is a
remedy after the writer has already lost their place in their own document.

**Charging per conversation turn.** Rejected under D3: it prices the thing the
product wants writers to do, and the number on the button would move with the
context window. Tokens are recorded so the decision can be revisited with data.

**Redis and BullMQ for the queue.** Rejected under D6: a `jobs` table already
exists, a second queue beside it makes two authorities on one fact, and it is a
dependency decision AGENTS.md puts behind a question.

**A CRDT, or realtime, so agent and writer can both hold the node list.**
Rejected under D10: `apps/sync` and Loro are deferred by AGENTS.md, and the race
is closed by routing through the one open editor plus a compare-and-swap. The
copilot needed no realtime, so it did not get to reopen that constraint.

**Minting a separate scene id, keeping ADR 0001 Ruling 3 as written.** Rejected
under D8: six tables already key a scene by its heading node id, and the ruling's
actual objection was to the type *prefix*, which dropping the prefix answers.

**Running long work in `after()`, as Production does today.** Rejected under D5:
it works for one image and not for a run that drafts an episode, and AGENTS.md
already rules that jobs are long-running processes and never serverless
functions.

**One autonomy setting — always review.** Rejected under D1 as the mirror of
always-auto: a writer who has approved twenty correct proposals should not have
to approve the twenty-first, and forcing it is how a review surface becomes a
reflex click. The two always-confirming modes are where that reflex is blocked.

## Does this keep the script authoritative?

Yes, and D8 and D10 are the two decisions that carry it.

**D10** is the direct answer. The node list has exactly one writer at any moment:
the open editor when there is one, the server under a compare-and-swap when there
is not. An agent never holds a second copy it can save over the writer's. A
proposal planned against a document that has since changed is stale by
definition, and re-planned rather than applied — so a stale plan cannot become a
competing account of what the script says.

**D8** removes a second authority rather than adding one. A separate scene id
space would be a second name for something the node list already names, joined to
it by a mapping that could drift. Reading the scene's identity out of the node
list keeps `derive` the only thing that decides what scenes exist.

The rest of the file is careful not to create one. D11 writes attribution
*alongside* nodes, never a shadow record of what the agent thinks it wrote. D18
keeps counts in code, so the model never becomes an authority on a number the
node list already determines. D9 fixes an ordering that was already the node
list's, in the one place it can be authoritative — the column.

The failure mode to watch is D1's proposal store. `agent_proposals` and
`agent_proposal_ops` hold operations planned against a document, and if anything
ever reads a proposal to answer "what does the script say", that is the second
authority arriving. A proposal is a *pending intention*, readable only as itself.
The node list is what the script says.
