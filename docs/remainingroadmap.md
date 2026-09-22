# Remaining roadmap

**Status as of 2026-09-22: roughly 70% of the scoped app is built** — nine workspace routes, four
account routes, the script core, Production v12. What is left is not evenly distributed, and it is
disproportionately the unglamorous part: jobs, money, mail, export and verification.

Destination assumed throughout: **a paid product with real customers.** That is why *don't lose
their work* and *don't take their money wrongly* come before feature completeness.

> **Props is excluded from this document — it is in progress.** It is the tenth route,
> `/app/project/:projectId/props`, project-wide, authored records with script evidence read at
> request time, and it becomes the authoritative surface for Production's prop field.

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

`apps/web/tests/script-identity.test.ts:98-112` asserts the id returns *in ProseMirror state* and
never saves — it passes while the bug ships.

### 0.2 The paren trap · a core keystroke is broken

A parenthetical opens as `()` with the caret **between** the parens, so the `atEnd` check at
`_script/editor/extensions/commands.ts:118` can never be true inside a filled one. Enter falls
through to `tr.split` and produces `(soft` plus a new parenthetical holding `)`. The writer cannot
leave a parenthetical with Enter and never gets the Dialogue `ENTER_TRANSITION` promises.

### 0.3 Import over an existing draft silently does nothing

`content` is a creation-time option and `useEditor`'s dep array is `[extensions]`
(`_script/editor/tiptap-editor.tsx:150-215`). Same `documentId` means no re-create and no
`setContent`. Then the mount-only refs at `_script/script-workspace.tsx:328-334` send a stale
`baseUpdatedAt` and just-tombstoned ids, landing in 0.1's dead end.

### 0.4 Storyboard "Draw frame" takes credits and delivers nothing

`apps/web/lib/storyboard/actions.ts:425-441` reserves credits and writes a `queued` job.
**There is no runner** — Production got an `after()` runner, Storyboard never did. The user pays,
watches a spinner forever, and the credits are gone. Either give it the same treatment or draw the
button disabled with the reason, as Characters' `✦ Generate` already is.

### 0.5 Share links escalate to write access

`apps/web/app/share/[token]/page.tsx:30-56` writes a membership with `link.role`, and roles are
enforced nowhere — so a **`reader` who follows a share link can write everything a writer can**,
including issuing further share links. Full enforcement is open decision 16; close *this path* now.

### 0.6 Stuck generations hold credits forever

`apps/web/lib/production/pipeline/runner.ts:16-24` catches throws, not the process being killed
between `startGeneration` and `succeedGeneration` — an ordinary serverless timeout. The row stays
`running`, the reservation stays held, and `_production/polling.tsx:16-18` polls every 3 s forever
with no terminal condition. The diagnostic that would surface it,
`listOrphanedReservations` (`packages/db/src/repositories/credits.ts:186`), has **no caller**.

**Also in this phase:** commit the account-routes pass — 61 paths and migration `0029`, already
applied to dev, currently untracked.

---

## Phase 1 — The decisions session

Twelve rows are open in `AGENTS.md:148-167`. The repo's own rule is **escalate, do not resolve** —
bring options and consequences, not a recommendation. Ranked by what they unblock:

| # | Decision | Why it matters now |
| --- | --- | --- |
| **16** | Does a role mean anything | `memberships.role` is stored, shown in settings and **enforced nowhere**. Twelve action modules say so in comments and ship anyway. Blocks Phase 2 entirely. |
| **14** | Production costs, refunds, stale rules | Shot frame 4, scene image 40, AI shotlist 0, propose 0 were **picked, not ruled**. Real money is priced against them today. |
| **10** | Is `SCENE_xxx` a node id or a record id | ADR 0001 and `packages/script` **contradict each other**. It currently blocks scene deep-linking in both Timeline and Storyboard — a user cannot link to a scene. |
| **13** | Does an assistant message cost credits | Blocks charging the assistant and Timeline's `✦ Suggest placements`. |
| **15** | What `Duplicate` copies | The control is drawn on the Projects route and refuses in words. |
| **2** | Review-tier thresholds | Blocks the whole agent review flow. |
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
Nine signed-in walks exist and self-skip without `E2E_EMAIL`/`E2E_PASSWORD`. Only `shell-*.png`
artifacts exist in `test-results/` — **the other seven, Production's included, appear never to have
run.** No server action has a unit test anywhere, so these walks are the action layer's only
coverage. `apps/web/e2e/smoke.spec.ts:5` says so itself: *"This is not the smoke test AGENTS.md
asks for."*

---

## Phase 3 — The worker

`apps/worker/src/index.ts` is seven lines and one constant — no build script, no Redis, no BullMQ.
Every Production generation currently runs inside the web request:

- `apps/web/lib/production/generate.ts:125` — `after(() => runGeneration(...))`
- `apps/web/lib/production/pipeline/runner.ts` — the job body
- `_production/polling.tsx` — a 3 s `router.refresh()` poll

A generation therefore lives only as long as the serverless invocation. No retry, no queue, no
dead-letter, no resume across instances. A Veo shoot costing 375 credits that loses its invocation
is simply gone.

Needs a dependency approval (BullMQ + Redis; `REDIS_URL` is already in `.env.example:157`).

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

`AGENTS.md:524-541` flags this as both a dependency decision **and** a product decision.

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

The assistant is a **read-only chat** today: it reads, it answers, it writes nothing. The full
lifecycle specified in `AGENTS.md` — Brief → Plan → Run → Review → Commit, tool use, proposals,
allowlist enforcement, locks, parser parity — is entirely unbuilt.

Blocked on decision **2** (the review-tier thresholds) and **13** (whether a message costs credits).
The two Characters drawer model actions that were the first steps past the chat were removed in the
route's fourth pass (2026-09-20); their caps stay in `lib/assistant/model.ts` for the next action of
that shape.

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
- `packages/db/CLAUDE.md` **never mentions round trips or `prepare: false` at all**, so a maintainer
  working only in that package gets no warning about the cost model. Worth closing.

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
| Nine workspace routes | ~30% | ~90% |
| DB schema, repositories, 30 migrations | ~8% | ~95% |
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
