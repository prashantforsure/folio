# 05 — Build phases

Six phases after the design step. Each is written to be executed by **one Claude Code session with
no memory of the others**: it names what to read, what to touch, what "done" means, and how to
prove it. Do not start a phase whose prerequisites are not met. Do not do the next phase's work
early. When a phase is done, fill its row in `README.md`'s status board, append to
[06-decisions.md](06-decisions.md), and write its section in `docs/build-decisions.md`.

The session checklist at the bottom applies to every phase.

---

## Phase D — Design mockups (Claude Design; no code)

**Goal.** Twenty approved frames that become the visual spec for phases 2–4 and the record-route
sections of phase 1.

**Read.** [02-design-spec.md](02-design-spec.md) in full; the design language block (§1) and the
sample data (§2) go into every brief verbatim.

**Do.** Produce F01–F20 as listed in [02](02-design-spec.md) §12, in the order F20 (the states
sheet — it settles the vocabulary first), F01, F02, F03, F04, F09, F10, F11, then the rest. Review
each with the user. Record every deviation the user accepts in [06-decisions.md](06-decisions.md)
§4 as "Design: …" entries. Store the approved exports under `docs/production/design/` as
`F01-scene-authoring.png` … (and the source files if Claude Design exports them).

**Done when.** The user has approved all twenty, and [06-decisions.md](06-decisions.md) lists every
deviation from the text spec.

---

## Phase 0 — Rulings (a conversation, then a commit of this doc set)

**Goal.** The decisions that block phase 1 are ruled and recorded.

**Read.** [06-decisions.md](06-decisions.md) §3 (D-1 … D-19). `AGENTS.md` "When to ask first".

**Do.** Ask the product owner for D-1 (queue), D-2 (provider), D-4 (credit unit and margin), D-6
(clip-length source), D-9 (cancel refund), D-10 (film-settings shape), D-13 (kept-Look storage),
D-14 (URL columns), and dependency approval for `bullmq` + `ioredis`, and the env block. Record
each ruling with its date in §4 of the decisions log. Add a "Production feature set" section to
`docs/build-decisions.md` that points here.

**Done when.** Every D-1…D-14 row in §3 reads *ruled* or *deferred with a phase*.

---

## Phase 1 — The job model, the worker, and identity

**Goal.** Jobs really run. A character gets a kept Look and Turnaround, a location a kept plate,
a shot a real frame drawn with the reference stack — and every one of them lands on R2 with a
settled ledger row. The Production body is *not* redesigned in this phase (that is phase 2); only
its frame tiles gain progress and the stale marker.

**Prerequisites.** Phase 0 rulings D-1, D-2, D-4, D-10, D-13; `bullmq` + `ioredis` approved; a
Redis URL and a fal key in the developer's `.env`; `R2_*` set.

**Read.** [03](03-data-model.md) §3.1, §3.2, §3.6, §3.7, §4, §5, §6, §7, §9 (phase 1), §11 (`0024`);
[04](04-generation-pipeline.md) all; [02](02-design-spec.md) §5 (tile states), §7.5, §7.6, §8.3.
`packages/db/CLAUDE.md`; `apps/web/CLAUDE.md`; `docs/build-decisions.md` "Characters rebuild,
phase 4" (the model-action pattern) and "Locations rebuild".

**Touch.**

- `packages/contracts/src/`: `enums.ts` (+ kinds, entity kinds, roles, tiers, aspects, camera
  styles, reference roles, error codes), `generation.ts` (new), `generation-registry.ts` (new),
  `art-styles.ts` (new), `film-settings.ts` (new), `ids.ts` (+ `EntityGenerationIdSchema`),
  `index.ts` exports.
- `packages/db/`: `migrations/0024_production_generation.sql`; `src/schema/production.ts` (+
  `entityGenerations`), `storyboard.ts` (`jobs` columns), `tenancy.ts` or wherever `projects` lives
  (+ `production_settings`), `derived.ts` (`characters.appearance`); `src/schema/index.ts`
  (classify `entity_generations`); `src/repositories/generation.ts` (new), `jobs.ts` (new),
  `credits.ts` (+ `spendForJob`, `refundForJob`, `releaseForJob`), `storyboard.ts`
  (`queueFrameGeneration(s)` + `spec` + the advisory lock); `src/env.ts` (+ `workerEnv`);
  `.env.example`.
- `apps/worker/`: `package.json` (deps, `start`, `dev`), `src/index.ts` (the consumer),
  `src/providers/types.ts`, `src/providers/fal.ts`, `src/run-job.ts` (the loop of [04](04-generation-pipeline.md) §5.2),
  `src/sweeper.ts`, `src/storage.ts` (R2 via the shared `r2.ts` logic — move it to a package if
  `apps/web/lib/storage/r2.ts` cannot be imported from the worker; `packages/db` is the wrong home;
  a tiny `packages/storage` is a new package and needs a ruling — prefer duplicating the 60 lines
  with a comment until then), `tests/`.
- `apps/web/lib/production/`: `prompt.ts` (new, pure), `hash.ts` (new, pure), `quote.ts` (new),
  `status.ts` (+ stale, progress), `view.ts` (+ the tile states), `actions.ts` (frames now write
  `spec`; `generateFrames` chains on the previous kept frame; `redrawShot`).
- `apps/web/lib/characters/`: `actions.ts` (+ `generateLook`, `generateTurnaround`,
  `keepEntityGeneration`, `saveAppearance`), `server.ts` (read the generations);
  `apps/web/lib/locations/actions.ts` (+ `generatePlate`, keep).
- `apps/web/app/(app)/app/project/[projectId]/_characters/` the drawer (+ the Look section of
  [02](02-design-spec.md) §7.5); `_locations/` the drawer (+ Plate, §7.6); `_production/frame-tile.tsx`
  (+ progress, stale tag, `Redraw`, `Waiting for shot N's frame`); `_production/production-toolbar.tsx`
  (+ `Film settings` button and the dialog of §7.1 — the dialog is small and is needed for the style
  prefix; build it here).
- `apps/web/lib/assistant/context.ts`: nothing (phase 4).
- `apps/web/tests/`: `prompt.test.ts`, `hash.test.ts`, `quote.test.ts`, `registry.test.ts`,
  `production-status.test.ts` (extended).
- `docs/build-decisions.md`: "Production, phase 1 — jobs run".

**Steps.**

1. Contracts first (enums, spec, registry with placeholder ids marked `// VERIFY`, art styles,
   film settings). `pnpm typecheck`.
2. Migration `0024` by hand in the house style; apply to dev (`packages/db/CLAUDE.md` says how);
   schema modules; `index.ts` classification.
3. Repositories: `generation.ts`, `jobs.ts`, credits writers, the advisory lock. Unit-test the pure
   parts; probe the CTEs against the dev database with a throwaway script (delete it after).
4. `prompt.ts`, `hash.ts`, `quote.ts` with tests.
5. The worker: types → fal adapter (fixtures) → run loop → sweeper → `pnpm --filter worker dev`
   against a real fal key with a **draft** tier Look job.
6. Web: env block + "No worker connected" gating; Characters drawer Look section; Locations
   drawer Plate; frame generation with `spec` and chaining; tile states; the Film settings dialog.
7. The decisive check (below). Record.

**Acceptance criteria.**

- `✦ Generate look · N cr` on a character creates a `jobs` row with `spec`, a `reserve` ledger row,
  an `entity_generations` row; the worker moves it `queued → running → finished`, the image is on
  R2 under the key convention, `spend` is written once, `provider_cost_usd` is set, and the drawer
  shows the take; `Keep` sets `kept_at`; the Cast list shows the thumbnail.
- `✦ Turnaround` sends the kept Look as `reference_character` (visible in `spec.inputs`).
- `✦ Generate plate` and `✦ Generate frames` behave the same; a frame of a shot that mentions the
  character carries the Look key and (when kept) the previous shot's frame key in `spec.inputs`;
  shot 2 waits on shot 1's kept frame with the `Waiting for…` tile.
- A moderation refusal (force it with a violent prompt on the draft tier) lands `blocked` with a
  readable `blocked_reason`, a `release` row, and the tile/row copy of [02](02-design-spec.md) §5.
- A provider failure (kill the network mid-job) lands `failed`, `refund`, `Failed · refunded`.
- Cancel while queued → `cancelled` + `release`. The sweeper returns a stuck `running` job to
  `queued`.
- Editing the character's appearance marks its Look stale; editing a shot's description marks its
  frame stale; changing the art style marks everything stale (tags with reasons).
- The Film settings dialog saves `production_settings`; the style prefix appears in the next job's
  `spec.prompt`.
- Without `REDIS_URL`/`FAL_KEY`, every `✦` is disabled with the reason; the build's secret check is
  green.
- Two rapid clicks on the last credits reserve once (the advisory lock).
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm --filter web exec vitest run tests/prompt.test.ts
  tests/hash.test.ts tests/quote.test.ts tests/registry.test.ts tests/production-status.test.ts
  tests/production-view.test.ts` (Node ≥ 22.12), `pnpm --filter worker test`, `pnpm build`.

**Not in this phase.** The canvas, scene tabs, reel strip, still, range, continuity, versions,
Tasks panel, exports, assistant context.

---

## Phase 2 — The reel canvas

**Goal.** The Production body becomes the approved frames F01, F06, F07, F08, F10, F19 (and F17's
light theme): scene tabs → reel strip → reel canvas with the Performance, Shots, Scene, Cast, Extra
prompt and Image cards; the scene still; auto-assign; ranges; continuity mode (the control only —
its effect is phase 3). The Clip card draws its gate box and a disabled `✦ Start shooting` (the
render itself is phase 3).

**Prerequisites.** Phase 1 done; F01/F06/F07/F08/F10/F19/F20 approved; ruling D-11 (views) taken
or explicitly deferred; D-14 (layout storage) ruled.

**Read.** [02](02-design-spec.md) §3, §4.1–4.4, §4.6, §4.7, §5, §7.1, §7.4, §8, §9, §10, §11;
[03](03-data-model.md) §3.3, §3.4, §9 (phase 2), §11 (`0025`); [04](04-generation-pipeline.md) §3
(still template); `docs/build-decisions.md` "Redesign phase 3, second pass — the Storyboard canvas"
and "phase 8 — Scenes" (the canvas pieces and the reading modal); `_storyboard/canvas/*`.

**Touch.**

- `packages/db/`: `0025_production_reels.sql`; schema `reels` (+ columns), `reelStills`;
  `repositories/production.ts` (+ range, continuity, layout, extra prompt, still queue/keep,
  `autoAssignReels`, the extended read).
- `packages/contracts/src/production.ts` (+ `ReelLayoutSchema`, `StillState`, `GateItem`, the
  extended `ReelRow`), `generation.ts` (+ `StillSpecSchema`).
- `apps/web/lib/production/`: `actions.ts` (+ `setReelRange`, `setReelContinuity`, `setReelLayout`,
  `setExtraPrompt`, `generateStill`, `keepStill`, `autoAssign`, `addExtraCastCard`, `addImageCard`
  with upload), `status.ts` (+ gate, still, scene status), `view.ts` (+ tabs, strip, cards),
  `prompt.ts` (+ still), `hash.ts` (+ still), `coverage.ts` (the sidebar cell), `layout.ts` (the
  default layout + tidy, pure).
- `apps/web/app/(app)/app/project/[projectId]/_production/`: **replace** `scene-view.tsx`,
  `reel-section.tsx`, `shot-row.tsx`, `in-this-reel.tsx` with `scene-tabs.tsx`, `reel-strip.tsx`,
  `reel-canvas.tsx` (on `_storyboard/canvas/use-canvas-viewport.ts` + `connectors.tsx`),
  `cards/performance-card.tsx`, `cards/shots-card.tsx` (+ `timing-bar.tsx`, `shot-row.tsx`),
  `cards/scene-card.tsx`, `cards/cast-card.tsx`, `cards/clip-card.tsx` (gate only),
  `cards/extra-prompt-card.tsx`, `cards/image-card.tsx`, `canvas-pills.tsx`, `film-settings-dialog.tsx`
  (moved from the toolbar file if phase 1 put it there), `confirm-dialog.tsx`; keep `frame-tile.tsx`,
  `episode-view.tsx` (untouched until phase 4), `production-toolbar.tsx` (+ the chips),
  `production-workspace.tsx` (rewired), `sidebar-slots.tsx`, `mark.tsx`; `view-state.tsx` if D-11
  rules views to client state (copy `_storyboard/view-state.tsx`; then `lib/workspace/views.ts`
  and `params.ts` lose Production's `?view=` — an "ask first" param change, so only with the ruling).
- `apps/web/app/globals.css`: the route's classes (`folio-prod-*`), the shimmer keyframes.
- `packages/ui/src/tokens/palette.css`: nothing new unless a frame needs a token — then add it here
  and nowhere else.
- `apps/web/tests/`: `production-layout.test.ts` (default layout, tidy), `production-status.test.ts`
  (gate, scene status), `production-view.test.ts` (rewritten to the new view model).
- `apps/web/e2e/production-route.spec.ts`: rewritten for the new body (tabs, strip, cards, the
  states of F01/F06/F07/F08).
- `docs/build-decisions.md`: "Production, phase 2 — the reel canvas".

**Acceptance criteria.**

- Every region of [02](02-design-spec.md) §3 draws at the stated geometry in both themes; every
  string is the spec's.
- Scene tabs list the episode's scenes with the worst-of dot; `Read` opens the reading modal;
  `Auto-assign` arranges accepted shots into 15 s reels with the confirmation; the sidebar selection
  and the tab agree.
- The reel strip inserts, renames, deletes (with the refusals), selects; the continuity glyph
  toggles and is refused with the right copy when there is no previous kept clip.
- The Performance card shows exactly the range's nodes with cue chips; `Set range…` works; ranges
  cannot overlap; `Edit in Script →` lands on the first node.
- The Shots card: clip-length control refuses a too-short length with the exact copy; the timing
  bar's four states (under / exact / over / proposed) match F20; rows edit in place with the
  Storyboard's editor; proposals accept/discard; `✦ Generate frames` chains; `Finalize`/`Unlock`
  lock the rows and are reflected on the Storyboard.
- The Scene card draws the plate thumb or the `No plate yet` line; `✦ Scene still` produces a kept
  still whose `spec.inputs` carry the plate and the cast Looks; the still goes stale when a line in
  the range changes.
- Cast cards appear for the derived cast; a no-Look card draws the `--warn` thread; `＋ Cast` adds
  an extra card that persists in `layout`; `＋ Image` uploads to R2 and feeds a frame job with the
  chosen role; `＋ Extra prompt` saves and appears at the end of the next frame's prompt.
- Card positions persist per reel; `Tidy` restores the default layout; the canvas pans/zooms with
  the Storyboard's keys.
- The Clip card shows the gate box with the required and recommended lines, each `→` scrolling to
  its target; `✦ Start shooting` is drawn disabled with "Rendering arrives in the next phase".
- Empty states F06, F07, F08 reachable; the narrow-viewport card at < 1040 px.
- Gates as phase 1 plus the new tests; E2E runs green with creds.

**Not in this phase.** Rendering, versions, the File view, Compare, Tasks panel, exports, Episode
view changes, assistant context.

---

## Phase 3 — The clip

**Goal.** `✦ Start shooting` renders a reel through the video tier with first/last frames, character
elements, the serialised shot list and dialogue; versions with Keep/Reshoot/Delete; match-cut
continuity; the shoot cost with its "likely 2–3 versions" line; frames F02, F05 approved.

**Prerequisites.** Phase 2 done; D-6, D-9 ruled; a `multiShot`-capable candidate verified in the
registry for `standard` (else the phase ships `single`-shot reels only and says so on the button).

**Read.** [04](04-generation-pipeline.md) §4, §5.2 (video polling, poster/last frame), §8;
[03](03-data-model.md) §3.5, §11 (`0026`); [02](02-design-spec.md) §4.5, §3.3 (reel action), §8.3
(`clip.*`).

**Touch.** `0026_production_versions.sql`; schema `reelRenders` (+ `kept_at`, `poster_key`,
`last_frame_key`), `reels` (drop the CHECK per D-6); `repositories/production.ts`
(`queueReelRender` + spec, `keepReelRender`, `deleteReelRender`, `readPreviousKeptClip`);
`contracts/production.ts` (`Version`, `ClipState` + stale), `generation.ts` (`RenderSpecSchema`);
worker `run-job.ts` (video branch: longer timeouts, poster and last-frame capture per the vendor's
output — if the provider returns no poster, the phase records the limitation and phase 5's ffmpeg
ruling covers it), `fal.ts` (video endpoints); `lib/production/prompt.ts` (render template),
`hash.ts` (render), `quote.ts` (video, surcharge, lo/hi), `status.ts` (versions, rendering,
rendered, stale clip), `actions.ts` (`startShooting`, `reshoot`, `keepVersion`, `deleteVersion`,
`cancelRender`); `_production/cards/clip-card.tsx` (player, versions row, rendering state),
`reel-strip.tsx` (the reel action states); tests; E2E (F02/F05 states).

**Acceptance criteria.**

- On a ready reel `✦ Start shooting · N cr` shows the registry quote and the lo–hi line; on click a
  `reel_render` job with a full `RenderSpec` (shots serialised in order, `first_frame` = shot 1's kept
  frame key, `last_frame` where supported, each mentioned Look as `reference_character`, the
  dialogue nodes) is queued and held; the worker renders; the MP4 and poster land on R2; `spend` is
  written; the Clip card plays it inline; the strip reads `Rendered · view`.
- A second `Reshoot` makes version 2; `Keep` moves the kept marker; `Delete version` asks and
  refuses on the kept one; the Episode thumbnail shows the kept poster.
- With `match_last_frame`, Reel 2's spec carries Reel 1's kept clip's last-frame key as
  `first_frame` and shot 1's frame as `reference_still`; the toggle is refused when Reel 1 has no
  kept clip.
- Cancel while queued releases; while running behaves per D-9 and says so in the button's title.
- Changing a shot after a render marks the version stale with the reason; `Unlock` asks with the
  exact copy.
- The `Needs credits` state (F05) draws the `--live` chip and the disabled button with the reason.
- Gates green; the decisive walk of the PRD §12 passes end to end by hand (record the run with the
  job ids in the decisions log).

**Not in this phase.** Single-shot chaining and concatenation (phase 5), audio beyond the model's
native audio, the File view, Tasks, exports.

---

## Phase 4 — Assembly, tasks, review, exports, the assistant

**Goal.** Frames F09, F11, F12, F13, F16, F18: the Episode view's reel strip and `▶ Play episode`;
the Tasks drawer; the File view drawer with provenance and Compare; `Select for…`; MP4 download;
the PDF board; `production: true` assistant context with a reel Focus and live chips.

**Prerequisites.** Phase 3 done; D-17 (Compare modes), D-18 (comments on takes), D-19 (PDF
engine) ruled.

**Read.** [02](02-design-spec.md) §6, §7.2, §7.3, §5 (Compare), §8.3; PRD §8.11, §8.14, §8.16–8.18;
`docs/build-decisions.md` "Timeline rebuild, phases 2-5" (the assistant Focus pattern) and the
Script route's export section (the PDF engine); `apps/web/lib/assistant/context.ts`.

**Touch.** `repositories/jobs.ts` (`listJobs`), `production.ts` (`selectTakeForShot`,
`deleteTake`); `contracts/production.ts` (`JobRow`, provenance on `Take`);
`lib/production/actions.ts` (+ select-for, delete take, download URL minting, export);
`lib/production/export.ts` (the board HTML → PDF); `lib/assistant/context.ts` (+ `production`
flag, Focus block), `server.ts` (`AskInputSchema`); `_chrome/assistant-panel.tsx` (Production's
subhead and live chips); `_production/episode-view.tsx` (rewritten: tiles, the strip,
`▶ Play episode` modal), `tasks-drawer.tsx`, `file-view.tsx` (in the shell's drawer slot),
`compare.tsx`, `play-episode-modal.tsx`; `frame-tile.tsx` (+ the `⋯` menu); tests; E2E (F09, F11,
F12 states).

**Acceptance criteria.**

- The Episode view matches F09; `▶ Play episode` plays kept versions in order and lists the
  skipped; the stat tiles' numbers agree with the status bar and the sidebar widget (one
  derivation).
- The Tasks drawer lists the project's jobs newest first with the filters; cancel works from it;
  `→` selects the target on the canvas.
- The File view shows every field of [02](02-design-spec.md) §7.2 from the job's `spec`/`route`,
  including the dropped references; Compare's three modes work between any two takes of a shot;
  `Select for…` assigns a take to another shot of the reel (a copy of the generation row pointing
  at the new shot, `parent_job_id` set); a comment thread anchors to the take (per D-18).
- `Download MP4` mints a 1 h signed URL; `Export board (PDF)` produces one page per reel with the
  kept frames and the settings footer, for a scene and for the episode.
- On `/production` the assistant's context contains the reels, shots, take states, kept versions,
  refusals and quoted costs, with the selected reel as Focus; the three chips read the page; nothing
  the assistant can *write* changed (open decision 13 untouched).
- Gates green; E2E green.

---

## Phase 5 — Later (each item its own ruling and session)

| Item | Needs | Notes |
|---|---|---|
| Single-shot chaining + concatenation | an ffmpeg dependency ruling for the worker | one clip per shot, last → first frame, concatenated; makes the draft tier usable for multi-shot reels |
| Voice per character + Text-to-Dialogue + lip-sync | provider rows for `tts` and `lipsync`; `characters.voice_id` | the reel's dialogue nodes → audio → lip-sync on the kept version |
| Take repair (region/segment edit) | a provider with edit capability | `parent_job_id` lineage; the File view's Provenance shows the chain |
| Continuity findings | a vision-capable model; `production_findings` table on the `character_findings` pattern | "Ade's braid is missing in take 2" kept as rows the writer waves through |
| Kanban board (Episode view) | none | group by status · scene · character · location; drag to advance |
| FCPXML / EDL export | none | shot ids, durations, takes as metadata |
| Stitched episode cut | the ffmpeg ruling | one MP4 per episode |
| Model-based `✦ Propose shots`; assistant-dispatched jobs (Ask mode) | open decision 13; "widen what the AI writes" | the assistant proposes `proposed` rows / queues a job after confirming the cost in chat |
| Upscale the kept version | a provider row for `upscale` | the File view's `Upscale · N cr` |

---

## The session checklist (every phase)

1. `git status` — note what other sessions have uncommitted; re-read any shared file before
   editing it (`assistant-panel.tsx`, `globals.css`, `palette.css`, `context.ts`, the shell files
   are shared with every route).
2. Read this phase's section and the files it names in the other docs. Nothing more.
3. Confirm the prerequisites; if a ruling is missing, stop and ask.
4. Build in the order of the steps; run the gates after each step, not at the end.
5. Force the test run (`pnpm exec turbo run test --force`) before reporting any suite green; web
   tests need Node ≥ 22.12 (`nvm use 22.23`, the memory trap).
6. Walk the states in the browser on the dev server, both themes, and against the approved frames.
7. Record: the status board, the decisions log (§4), the `docs/build-decisions.md` section
   (rulings table · what was built · every state and how to reach it · judgement calls · not
   built · verification). Paste failing output literally.
8. Do not commit unless asked. Do not delete the retired mockup files; they are already deleted
   in the working tree by another session — leave that to its owner.
