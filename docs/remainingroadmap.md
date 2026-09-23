# Remaining roadmap

**Status as of 2026-09-22: roughly 70% of the scoped app is built** — ten workspace routes, four
account routes, the script core, Production v12. What is left is not evenly distributed, and it is
disproportionately the unglamorous part: jobs, money, mail, export and verification.

> **Re-checked against the code on 2026-09-23** (the guidance audit). This is still the 2026-09-22
> pass, not a live feed. Where an entry has since been fixed or ruled, a dated **✓ FIXED** or
> **✓ RULED** line sits under it with the evidence — nothing has been removed, because what was
> wrong is worth keeping visible. Anything without such a line was re-verified as still true.

Destination assumed throughout: **a paid product with real customers.** That is why *don't lose
their work* and *don't take their money wrongly* come before feature completeness.

> **Props was excluded from this document — it was in progress.** It is the tenth route,
> `/app/project/:projectId/props`, project-wide, authored records with script evidence read at
> request time, and it is the authoritative surface for Production's prop field.
>
> **✓ BUILT 2026-09-23 (verified):** the route ships — `lib/props/actions.ts` (9 actions),
> `_props/`, `lib/props/{server,view}.ts`, `packages/script/src/props.ts`, migration `0030`,
> `e2e/props-route.spec.ts`, `tests/props-view.test.ts`, and its spec paragraph in
> `apps/web/CLAUDE.md`. Counts below that say "nine routes" have been corrected to ten;
> the effort table has not been re-weighted.

Three kinds of work are mixed together below and should not be confused:

| Kind | What it means |
| --- | --- |
| **Defect** | Something that looks built and is broken. Not new work. |
| **Decision** | Blocked on a human ruling, not on engineering time. |
| **Unbuilt** | Genuinely new surface. |

---

## Phase 0 — Stop the bleeding

Six defects. Three were found in a manual browser walk on 2026-09-16 and **never fixed** —
everything committed since is feature work. Each has test coverage that steps around the defect,
so CI is green on all of them.

### 0.1 Data loss on undo-after-wipe · the worst one

Select-all, delete, undo — the script is gone for good.

The wipe's autosave writes **tombstones** for every node id (`apps/web/lib/script/actions.ts:230-238`).
Undo restores the blocks with their original ids, so it *looks* recovered. The next autosave
re-sends those ids, `commitNodePlan` unions the tombstone table into `bad` and refuses the whole
write (`packages/db/src/repositories/documents.ts:491-498`), and the client dead-ends at
`_script/script-workspace.tsx:501-503` with `"Reload to continue."` — and the reload serves the
wiped script.

**The fix exists and is never called.** `reviveNodeIds` (`packages/db/src/repositories/history.ts:212`)
is documented at `:188-210` with exactly this scenario and has **zero callers**. Wire the
`ids-unusable` branch to it and retry the save.

**✓ FIXED 2026-09-23 (verified).** It is wired. `apps/web/lib/script/actions.ts:31` imports
`reviveNodeIds` and `:259` calls it; `:251` carries the argument for why reviving a tombstoned id
is not reuse under ADR 0001. The regression test the entry asks for is still worth adding —
`tests/script-identity.test.ts:98-112` still asserts only the ProseMirror half.

`apps/web/tests/script-identity.test.ts:98-112` asserts the id returns *in ProseMirror state* and
never saves — it passes while the bug ships.

### 0.2 The paren trap · a core keystroke is broken

A parenthetical opens as `()` with the caret **between** the parens, so the `atEnd` check at
`_script/editor/extensions/commands.ts:118` can never be true inside a filled one. Enter falls
through to `tr.split` and produces `(soft` plus a new parenthetical holding `)`. The writer cannot
leave a parenthetical with Enter and never gets the Dialogue `ENTER_TRANSITION` promises.

**✓ FIXED 2026-09-23 (verified).** `commands.ts:118-122` adds `atParenClose` and ORs it into
`atEnd`: the reachable position is immediately before the `)`, and that is what Enter now treats as
the end, so the block leaves for Dialogue.

### 0.3 Import over an existing draft silently does nothing

`content` is a creation-time option and `useEditor`'s dep array is `[extensions]`
(`_script/editor/tiptap-editor.tsx:150-215`). Same `documentId` means no re-create and no
`setContent`. Then the mount-only refs at `_script/script-workspace.tsx:328-334` send a stale
`baseUpdatedAt` and just-tombstoned ids, landing in 0.1's dead end.

**✓ FIXED 2026-09-23 (verified).** `_script/editor/tiptap-editor.tsx:226-234` is an effect that
acknowledges the editor instance stays put across an import and calls
`editor.commands.setContent(content, { emitUpdate: true })` itself.

### 0.4 Storyboard "Draw frame" takes credits and delivers nothing

`apps/web/lib/storyboard/actions.ts:425-441` reserves credits and writes a `queued` job.
**There is no runner** — Production got an `after()` runner, Storyboard never did. The user pays,
watches a spinner forever, and the credits are gone. Either give it the same treatment or draw the
button disabled with the reason, as Characters' `✦ Generate` already is.

**✓ FIXED 2026-09-23 (verified)** — the second way. `requestFrame` now **refuses by design until
the worker exists**: `lib/storyboard/actions.ts:433-439` returns
`{ status: 'refused', message: 'Needs a frame-drawing worker - not built yet.' }` after the gate and
**before anything is reserved**, and the header at `:421-432` says so. The button carries the same
reason (`DRAW_FRAME_DISABLED`). No credits move. `queueFrameGeneration` in `@folio/db` is what
resumes this once the Phase 3 worker exists.

**✓ CLOSED PROPERLY 2026-09-23** (roadmap task 4.3) — the first way, now that there is a worker.
`requestFrameWith` (`lib/storyboard/core.ts`) reserves and queues through `queueFrameGeneration`,
and the worker draws it (`lib/worker/frame-generation.ts`) with the `shot_frame` model from the
scene heading, the camera, the description and the mentioned characters' portraits, then settles:
drawn is a spend, failed a spend and a refund, refused or cancelled a release. The refusal and
`DRAW_FRAME_DISABLED` are gone; the button is disabled only where this server cannot draw (no
`GEMINI_API_KEY` or no `R2_*`), with that reason (`frameDrawingOff`), and the page polls while a
frame is in flight. Dev still holds 13 frame jobs queued since 2026-09-11; the first worker to run
against it will claim them, and those whose shot is gone fail and refund.

### 0.5 Share links escalate to write access

`apps/web/app/share/[token]/page.tsx:30-56` writes a membership with `link.role`, and roles are
enforced nowhere — so a **`reader` who follows a share link can write everything a writer can**,
including issuing further share links. Full enforcement is open decision 16; close *this path* now.

**✓ DONE 2026-09-23** — and not by closing that one path: full enforcement landed (roadmap task
1.2, `apps/web/lib/auth/roles.ts`), so the membership the link writes now means what it says.

### 0.6 Stuck generations hold credits forever

`apps/web/lib/production/pipeline/runner.ts:16-24` catches throws, not the process being killed
between `startGeneration` and `succeedGeneration` — an ordinary serverless timeout. The row stays
`running`, the reservation stays held, and `_production/polling.tsx:16-18` polls every 3 s forever
with no terminal condition. The diagnostic that would surface it,
`listOrphanedReservations` (`packages/db/src/repositories/credits.ts:186`), has **no caller**.

**✓ FIXED PROPERLY 2026-09-23** (roadmap task 4.3). Generations run on the worker as
`production_generation` jobs, queued in the statement that reserves the credits. A worker that dies
mid-run loses its lease; the stale sweep requeues the job and, at the third attempt, fails the
generation as "interrupted" (released). The **reaper** (every 10 minutes, `lib/worker/reaper.ts`)
closes anything left over: `listOrphanedReservations` was widened to report held reservations
whose generation or frame job is over, missing, or live with no live job, and each is released
or failed as interrupted. The page-load sweep that failed anything older than ten minutes is gone
(a generation waiting in a long queue is not dead), and `polling.tsx` stops when nothing is live.

**Also in this phase:** commit the account-routes pass — 61 paths and migration `0029`, already
applied to dev, currently untracked.

**✓ DONE 2026-09-23 (verified).** Committed in `3b0c2f2` / `b807d1a` ("home pages"); the working
tree is clean but for this audit's own doc edits.

---

## Phase 1 — The decisions session

Twelve rows were open in the open-decisions table (now `AGENTS.md:150-190`). The repo's own rule is
**escalate, do not resolve** — bring options and consequences, not a recommendation. Ranked by what
they unblock:

**✓ RULED 2026-09-23** (the copilot pass): **2**, **13** and **16** are closed by **ADR 0003** —
D1 the review-tier thresholds, D3 whether an assistant message costs credits, D2 whether a role
means anything. **Nine remain open.** The rows below are kept as written, each marked.

| # | Decision | Why it matters now |
| --- | --- | --- |
| ~~**16**~~ | ~~Does a role mean anything~~ **✓ RULED — ADR 0003 D2, and BUILT 2026-09-23** | The matrix is `apps/web/lib/auth/roles.ts`; every gate takes a minimum role and every action names the capability it needs. Phase 2's role-enforcement row below is done. |
| **14** | Production costs, refunds, stale rules | Shot frame 4, scene image 40, AI shotlist 0, propose 0 were **picked, not ruled**. Real money is priced against them today. |
| **10** | Is `SCENE_xxx` a node id or a record id | ADR 0001 and `packages/script` **contradict each other**. It currently blocks scene deep-linking in both Timeline and Storyboard — a user cannot link to a scene. |
| ~~**13**~~ | ~~Does an assistant message cost credits~~ **✓ RULED — ADR 0003 D3** | Unblocks charging the assistant and Timeline's `✦ Suggest placements`. Neither is built. |
| **15** | What `Duplicate` copies | The control is drawn on the Projects route and refuses in words. |
| ~~**2**~~ | ~~Review-tier thresholds~~ **✓ RULED — ADR 0003 D1** | Unblocks the agent review flow, which is Phase 6 / the copilot roadmap. |
| **3** | Rename blast radius | Whether rename rewrites unlinked prose mentions. |
| **7** | Where project settings went | `/settings` is a stub route with no design. |
| **8** | Sheet width for `format: asian` | The engine refuses; the refusal is drawn where the sheet would be. |
| **9** | The `/app/filmmaking` ADR | Blocks anything past a project list. |
| **11** | The revision colour past green | `nextRevisionColour` refuses at green. |
| **12** | Locked-page numbering past the last lock | A judgement call is implemented, not ruled. |

Also needing a ruling: four orphans awaiting a drop. Dropping them drops user data, so it is
ask-first.

| Orphan | State |
| --- | --- |
| `character_findings` (`0022`) | No reader or writer since the fourth Characters pass |
| `scenes.story_time` | No writer; superseded by `story_day`/`story_clock`/`flashback` |
| `scenes.beats` | No writer since the Beats route was cut |
| `activity_log` (`0026`) | Written on **every** Production mutation, **never read**. Unbounded growth, no retention. |

---

## Phase 2 — Make it safe to charge for

### Role enforcement
Follows decision 16. Twelve action modules to update; they already name the gap in comments, so the
work is mechanical once ruled — the hard part was the decision. Note
`apps/web/lib/projects/actions.ts:344` is currently the *only* place a role is checked at all.

**✓ RULED 2026-09-23 — ADR 0003 D2. ✓ BUILT 2026-09-23 — roadmap task 1.2.** The matrix is one
table (`apps/web/lib/auth/roles.ts`), the gates take a minimum role, and every action module names
the capability it needs; the two hand-written checks that existed before are now that gate's.
`apps/web/tests/role-gates.test.ts` drives the real gate with a mocked membership row, one write
per module.

### Credit correctness
- **Over-reservation race**, acknowledged and shipped at
  `packages/db/src/repositories/storyboard.ts:68-72` — two clicks on the last four credits can both
  read the same balance under READ COMMITTED and both reserve. Needs an advisory lock, which needs a
  session pooler the request path does not have. Solve with the worker, or a transaction.
- **Unit tests for `packages/db`.** 10,113 lines of hand-written SQL — the credit ledger, the
  12-CTE `commitDerivation`, the raw-SQL reservation path — with **zero tests**. Only
  `packages/script` and `apps/web` have a `test` script at all, so `turbo run test` silently skips
  the package. This is money arithmetic; it needs tests before customers.

### Observability
There is none. `apps/web/lib/auth/profile.ts:33` and `lib/auth/session.ts:77` both say "pino and
Sentry are not installed yet", and failure paths are `console.error`-and-swallow. In production you
would not have known any of Phase 0 was happening. Needs a dependency approval.

### Run the E2E walks
**Ten** signed-in walks exist — one per route — and each self-skips without
`E2E_EMAIL`/`E2E_PASSWORD`, so a green run proves nothing unless they were set. No server action has
a unit test anywhere, so these walks are the action layer's only coverage.
`apps/web/e2e/smoke.spec.ts:5` says so itself: *"This is not the smoke test AGENTS.md asks for."*

**Re-checked 2026-09-23:** `test-results/` is now **empty**, so it no longer shows which walks have
run — in either direction. Whether they have been run since is **UNKNOWN**; treat them as unrun
until somebody watches a pass go green.

---

## Phase 3 — The worker

`apps/worker/src/index.ts` is seven lines and one constant — no build script, no Redis, no BullMQ.
Every Production generation ran inside the web request until roadmap task 4.3:

- `apps/web/lib/production/generate.ts:125` — `after(() => runGeneration(...))`
- `apps/web/lib/production/pipeline/runner.ts` — the job body
- `_production/polling.tsx` — a 3 s `router.refresh()` poll

A generation therefore lives only as long as the serverless invocation. No retry, no queue, no
dead-letter, no resume across instances. A Veo shoot costing 375 credits that loses its invocation
is simply gone.

~~Needs a dependency approval (BullMQ + Redis; `REDIS_URL` is already in `.env.example:157`).~~

**✓ RULED 2026-09-23** (the copilot pass): **no BullMQ and no Redis.** The worker is built on the
**Postgres `jobs` table that already exists** — one fewer dependency, and the credit ledger is
transactional beside it. It is **roadmap Phase 4** of `docs/agents/roadmap.md`. `REDIS_URL` was
therefore dead and **came out of `.env.example` on 2026-09-23** (roadmap task 1.8).

**✓ BUILT 2026-09-23 — the runtime** (roadmap task 4.1). `apps/worker` is no longer a stub: it
claims from `jobs` (`SKIP LOCKED`), wakes on `LISTEN`/`NOTIFY` (migration `0036`), heartbeats,
recovers stale jobs, drains on `SIGTERM`, answers `GET /health` and has a Dockerfile
(`docs/agents/worker.md`). What it runs arrives with tasks 4.3 (generations, frames) and 4.4
(agent runs).

**✓ BUILT 2026-09-23 — generations and frames** (roadmap task 4.3). The `after()` line is gone:
`createGeneration` queues a `production_generation` job the worker runs with the spec the row was
quoted for; Storyboard frames are `frame_generation` jobs; the reaper and an R2 sweeper (logs
unreferenced Production objects older than a day, deletes only with `R2_SWEEP_DELETE=true`) run on
the worker's clock. The worker is not yet deployed anywhere, so until it is, a queued generation
waits in `queued` with its credits held and its Cancel button live.

**Unblocks, in order:** reliable Production runs (fixes 0.6 properly) · the Storyboard frame job
(0.4 properly) · Characters' `✦ Generate`, disabled with the literal reason
`'Needs the Production worker'` · the credit advisory lock · export.

**Fix here too:** the Script row cache (`apps/web/lib/script/row-cache.ts:11-27`) is single-process
and is the only thing making the save path tolerable — ~3,000 rows and 600 KB on every keystroke
that reaches the server. The moment `apps/web` runs more than one instance, typing latency degrades
sharply with no alert. This is a scaling blocker, not a nicety.

---

## Phase 4 — Take the money

**Payments.** Every `Upgrade` is drawn disabled — `_shell/credits-card.tsx:55`,
`(home)/settings/settings-workspace.tsx:155`. The plan comparison table is drawn with **no prices**
and nothing wired to Dodo (`settings-workspace.tsx:234-239`). There is no plan on record for a user.

**A mail provider.** One dependency decision that unlocks a whole surface at once, all of it
currently disabled on the constant `NO_MAIL = 'There is no mail provider, so nothing can be sent.'`:

- every notification toggle (`settings-workspace.tsx:328-354`)
- `Invite a writer` (`_shell/account-menu.tsx:68`) — an invite is currently a project share link
- changing your email address (`settings/profile-form.tsx:25-38`)
- receipts, password reset, job-completion notices — *nothing notifies asynchronously today;
  job completion is in-app only*

AGENTS.md's *No transactional email provider* constraint (now `:533-550`) flags this as both a
dependency decision **and** a product decision.

---

## Phase 5 — Export

`Export PDF` on the project card menu (`_projects/card-menu.tsx:89`) and `Export everything` in
security settings (`settings/security-section.tsx:138`) are both drawn and disabled. There is no PDF
engine and no archive format.

Needs the worker (Phase 3) plus decisions **8** and **12** — export must agree with on-screen
pagination exactly, and both open decisions are pagination rulings. People paying for a
screenwriting tool expect their work to come back out of it.

---

## Phase 6 — The agent's write path

The assistant is **read-only** today: it reads, it answers, it writes nothing - since roadmap Phase 2
(2026-09-23) through a tool-use loop with read tools (`docs/agents/roadmap.md`). The full
lifecycle specified in `AGENTS.md` — Brief → Plan → Run → Review → Commit, tool use, proposals,
allowlist enforcement, locks, parser parity — is entirely unbuilt.

~~Blocked on decision **2** (the review-tier thresholds) and **13** (whether a message costs
credits).~~ The two Characters drawer model actions that were the first steps past the chat were
removed in the route's fourth pass (2026-09-20); their caps stay in `lib/assistant/model.ts` for the
next action of that shape.

**✓ UNBLOCKED 2026-09-23.** Both are ruled — ADR 0003 **D1** and **D3** — and this phase has become
**the copilot**, which is larger than this entry: an app-wide side panel that can do anything a user
can do, through reviewable proposals. It has its own plan and its own phases; see
[`docs/agents/integration-plan.md`](agents/integration-plan.md) and `docs/agents/roadmap.md`. The rules
it changed are dated **2026-09-23** in AGENTS.md — notably: proposals **narrowed** to script,
outline and records, with explicit confirmation for anything with no diffable form; **export** off
the agent's "never" list, read-only; **Research stays read-only**; **no realtime** still, because
agent edits apply in the writer's open editor or through a compare-and-swap.

This is the largest remaining feature and the most differentiating. It sits last among the
substantive phases because nothing above it is optional.

---

## Phase 7 — Polish

Each is small on its own, and each is currently honest — a reason sits on the control.

| Item | Where | Reason given |
| --- | --- | --- |
| Command palette | Both search fields were **removed rather than drawn** — `_shell/home-nav.ts:23`, `_chrome/sidebar.tsx:28` | the palette is not built |
| Project `/settings` | An entire stub route | no design exists (decision 7) |
| `Pin to sidebar` | `_projects/card-menu.tsx:80` | there is no pinned section |
| Keyboard shortcuts sheet | `_shell/account-menu.tsx:77` | no shortcut sheet exists |
| Two-factor | `settings/security-section.tsx:105` | not enrolled |
| API keys | `settings-workspace.tsx:420` | no public API |
| Device list | — | Supabase exposes none |
| Drive / Dropbox / Slack | `settings-workspace.tsx:463` | "Nothing here talks to a third-party service." |
| Assistant attachments + dictation | `_chrome/assistant-panel.tsx:808`, `:816` | not built |
| Episode reorder | `docs/adr/0002-episode-identity.md:111` | not implemented |
| Workspace switcher | `_shell/home-sidebar.tsx:72` | no second tenant exists |

**Deliberately cut — do not rebuild:** Beats, Revisions, Notes, Bible and Insights routes; `/build`
and `/search`; presence and the `Read` button; realtime collaboration, Loro CRDT and `apps/sync`
(explicitly: *do not scaffold them*); Community, the writing leaderboard, the activity heatmap; the
`short` project type; the Characters Relationships graph.

---

## Improvements — built, working, but weak

Not blocking. Listed because each would bite a real user or a future maintainer.

### A user sees wrong data
- `apps/web/lib/script/stats.ts:11-17` — the Info panel's `beats` and `shots` are **hard-coded
  zeros**, because counting them would add a sequential read to the save path.
- `apps/web/lib/production/pipeline/gemini.ts:146` — Veo does 4/6/8 s only and *"extension is not
  wired"*. Ask for a 10 or 15 s reel, get 8 — against real credits.
- Scene deep-linking is blocked in Timeline and Storyboard pending decision 10.

### Performance — all documented, none fixed
The database is a Supabase Sydney pooler at ~400 ms with `prepare: false`, so **round-trip counts
are the cost model**.

- `packages/db/src/repositories/production.ts:568-598` — `readProductionEpisode` has three
  *sequential* await layers, ~2.4 s minimum. This is why `revalidatePath` had to be banned on that
  route.
- `apps/web/app/share/[token]/page.tsx:47-56` — 4+ strictly sequential awaits (~3 s) on a cold
  first visit. That is a new collaborator's very first impression of the product.
- ~~`packages/db/CLAUDE.md` **never mentions round trips or `prepare: false` at all**, so a
  maintainer working only in that package gets no warning about the cost model. Worth closing.~~
  **✓ CLOSED 2026-09-23** (the guidance audit): that file now carries the cost model — statement
  count, not row count — with the ∼400 ms pooler and `prepare: false` named.

### Dead weight
- `apps/web/lib/characters/graph.ts` is ~70% unread — `circleLayout`, the whole
  Fruchterman-Reingold `forceLayout`, the chord helpers. Its header documents three layouts as if
  shipped; there is no switcher. Fully tested, so it looks alive to CI.
- `dialogueEdges` runs on **every** Characters route load, building a list nothing renders.

### Import fidelity
- `packages/script/src/fountain-parse.ts:79` — a re-split that cannot round-trip. Flagged, unfixed.
- `packages/script/src/fdx.ts:53` — FDX inline styles are dropped on import.

### Accessibility
- Outline reorder is pointer-only (`_outline/editor/extensions/index.ts:29`); Production has
  keyboard reorder, Outline does not.
- `apps/web/lib/state/session.ts:36` — a UI state a user can enter and not get out of.
- Error *presentation* is genuinely good — `role="alert"` is used consistently across ~25
  components. The gap is diagnostics, not presentation.

---

## Where the 30% sits

Rough effort weighting, for planning rather than precision:

| Area | Share | Done |
| --- | --- | --- |
| `packages/script` core — node model, operations, Fountain/FDX, pagination, derivation | ~15% | ~95% |
| Ten workspace routes | ~30% | ~90% |
| DB schema, repositories, 31 migrations (`0000`–`0030`) | ~8% | ~95% |
| Auth, shell, chrome, account routes | ~10% | ~90% |
| Production v12 | ~12% | ~85% |
| The agent's full lifecycle | ~8% | ~20% |
| Worker and jobs infrastructure | ~5% | **0%** |
| Export | ~4% | **0%** |
| Payments, mail, project settings, command palette | ~8% | ~5% |

Two caveats worth holding onto:

1. **The remaining 30% is the expensive 30%.** Jobs, money, mail, export and verification have no
   visual payoff, the most integration risk, and the most ways to be subtly wrong. A last 30% is
   never 30% of the time.
2. **Not all of it is engineering.** A real slice is blocked on the twelve open decisions, which
   cost thinking rather than commits.

Against a different bar — *could a paying stranger use this* rather than *is the scoped feature set
built* — the number is closer to **60%**: no payments, no email, no export, and jobs that can
vanish mid-run are all table stakes there.

---

## Verification

Per change, all four gates, forced. `>>> FULL TURBO` means nothing ran:

```bash
pnpm exec turbo run test --force
pnpm typecheck && pnpm lint && pnpm build
```

Traps that produce a false reading:

- Run `@folio/script` directly (`pnpm --filter @folio/script exec vitest run`) — root `pnpm test`
  can abort before it, because `web`'s tests need Node `>=22.12`.
- `pnpm --filter web test` **fails on a fresh checkout** (`ERR_REQUIRE_ESM` from jsdom; local Node
  22.5.1 against `engines >=22.12.0`, with `.npmrc` setting `engine-strict=false`). Worth fixing
  early — a first `pnpm test` that is red trains people to ignore it.
- On Windows, vitest prints an `EPERM` forks-worker stack after a passing run. Read the counts.
- `pnpm --filter @folio/script test --coverage`, not `test -- --coverage`.

**Phase 0 needs a manual browser walk, not just green gates.** Every one of those defects passed
CI. Reproduce each by hand first, fix it, reproduce again — and add the regression test that was
missing in each case, since all of them had coverage that stepped around the defect.
