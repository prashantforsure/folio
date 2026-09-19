# 01 — Product requirements: the Production route

Status: approved for design (2026-09-19). Owner: the product owner. Built by: Claude Code sessions,
one phase at a time ([05-phases.md](05-phases.md)).

## 1. The problem

A writer with a finished scene has no way to *see* it. Today's tools either stop at a shot list
(StudioBinder, Celtx), generate pretty pictures unconnected to the page (Runway, Kling, Sora), or —
like Laper's Cinema project — ask the writer to retype the scene into a separate document with no
link back to the script. The result is always the same: characters that look different in every
frame, a video that drifts from the page, and no way to know what changed when the script does.

Folio already has the thing every other tool lacks: the screenplay as a typed node list from which
scenes, cast, locations, sets and story time derive. Production is the route that spends that
advantage — the page is the source of every prompt, the records are the source of every reference,
and the route can say exactly which frame went stale when a line changed.

## 2. Goals

1. **A scene becomes a clip** the writer can watch, in the app, from the script alone plus three
   decisions: how it looks (film settings), who the people are (a kept Look per character), how it
   is shot (the shot list).
2. **The same character in every frame and every clip.** Identity comes from one kept reference
   per character, fed into every generation; the route tells the writer when a character has no
   Look and what the model will do without it.
3. **Cost is never a surprise.** Every `✦` names its cost before it is spent, holds it on submit,
   settles on success, refunds on failure or refusal, and the route says "likely 2–3 takes".
4. **The script stays authoritative.** Nothing on this route edits a node. Everything generated is
   a take the writer keeps or discards, and a change to the page marks the affected takes stale.
5. **Honest states.** Queued is queued, generating is generating, a refusal shows its reason, a
   failure shows it refunded. No fake progress, no silent retries.

## 3. Non-goals (this version)

- A script-less "Cinema" project type (needs the `/app/filmmaking` ADR — open decision 9).
- An NLE. Assembly is a strip of reels that plays through; finishing happens in Premiere/Resolve.
- LoRA training or custom model fine-tuning. Reference sheets replace it.
- Realtime collaboration on the canvas (realtime is cut repo-wide). Last write wins with the
  existing conflict banner.
- Billing/top-up (no Dodo flow exists; "Top up to continue" stays copy until it does).
- Scheduling, budgets, call sheets, crew — Laper's own line: not a production-planning suite.
- Naming a model anywhere a writer can read it. Tiers only.

## 4. Who it is for

| User | Wants | Uses |
|---|---|---|
| The writer-director (primary) | to see the scene, iterate on the look, share a cut | the whole route, daily |
| The producer / collaborator | to review, comment, know what it cost | Episode view, Tasks panel, comments (existing), credits |
| A crew (later) | a board and shot list that a real shoot accepts | PDF board, shot list, FCPXML |

## 5. Principles this route obeys (from `AGENTS.md` and the design README)

- The script is the only hand-authored artefact; scenes, cast, locations are derived; Production
  writes only: reels, shots (the Storyboard's rows), jobs and their outputs, keep decisions, film
  settings, card layout.
- Nothing is stored that can be computed: reel status, counts, the balance, staleness are folded at
  read from rows.
- Long-running work is a job on the worker; reserve then execute; the ledger is append-only;
  failure refunds; `blocked` shows the refusal reason.
- Every write is a proposal the writer accepts — here, a take the writer keeps. The assistant reads;
  its writes are escalated (open decision 13).
- Every route ships both states. Every state is reachable and both themes are complete.
- Tokens only; the four semantic hues plus this route's ruled `--bad` (2026-09-16); Geist; sentence
  case; no illustrations; no exclamation marks.

## 6. Concepts (Folio's names)

| Term | Definition |
|---|---|
| **Film settings** | Project-level look: art style, aspect ratio, camera style, resolution, quality tier. Injected into every generation. Never locked; every job snapshots what it used. |
| **Art Style** | One of twelve presets (era, notable works, traits) that becomes the style prefix of every prompt and, optionally, a style plate reference. |
| **Quality tier** | `Draft · Standard · Cinema`. Selects the model class through the registry. The writer never sees a model name. |
| **Look** | A character's canonical generated (or uploaded) portrait — the identity anchor. One kept per character. |
| **Turnaround** | The kept Look seen from front, ¾, profile, back plus a wardrobe close-up. One kept per character. |
| **Plate** | A location's establishing image, generated or uploaded. One kept per location. |
| **Reel** | A run of one scene's shots that renders as one clip of a fixed length. Ordered inside its scene. Has a range of the scene's nodes, a continuity mode, a layout of cards. |
| **Scene still** | One image per reel establishing this scene's place, light and people. |
| **Performance** | The reel's slice of the scene's action and dialogue nodes, read-only. Not typed here. |
| **Shot** | A Storyboard row: size, angle, movement, lens, duration, description with `@mentions`. |
| **Frame** | A shot's image. Every generation is a **take**; one is kept. Uploads count. |
| **Anchor** | The reel's visual reference for the clip: the kept frame of its first shot. |
| **Clip** | The reel's video. Every render is a **version**; one is kept. |
| **Continuity mode** | `Natural cut` (independent) or `Match cut on last frame` (the previous reel's kept clip's last frame is this reel's first frame). |
| **Take / Version** | One job's output for a frame / clip. Never deleted by generating again. |
| **Job** | One generation: kind, status, cost held, progress, attempt, spec, route, error/refusal. |
| **Stale** | An output whose `source_hash` (the text, references and style it was made from) no longer matches the current records. |
| **Registry** | The `(kind, tier) → provider/model/capabilities/price` table. The only place a model is named. |

## 7. The workflow, end to end

1. **Write.** The script derives scenes, cast, locations (built).
2. **Set the film.** `Film settings` (toolbar, and the first-run card): art style grid, aspect,
   camera style, resolution, quality tier. Default: no art style, 16:9, Academy, 720p, Standard.
3. **Cast.** On `/characters`, each record's drawer gets a **Look** section: `✦ Generate look` (cost
   named) → takes → `Keep`; `✦ Turnaround` from the kept Look; or `Upload`. On `/locations`, the
   drawer gets **Plate**: `✦ Generate plate` / `Upload`.
4. **Board.** On `/production`, pick a scene tab. Its reel strip shows the scene's reels (one by
   default, created on first visit or by `＋ Reel`). Open a reel: the canvas holds the **Performance
   card**, the **Shots card**, the **Scene card**, one **Cast card** per character in the scene, a
   **Location card**, an **Extra prompt** card. `✦ Propose shots` fills the Shots card; the writer
   edits until the timing bar reads `15 / 15 s`.
5. **Draw.** `✦ Scene still` on the Scene card. `✦ Generate frames` on the Shots card (per shot,
   chained on the previous kept frame). Compare takes, `Keep`.
6. **Shoot.** `Finalize` locks the shots. `✦ Start shooting · N cr` renders. Versions appear;
   `Keep` one; `Reshoot` for another. Pick `Match cut` for the next reel.
7. **Watch.** The Episode view plays the kept versions in scene order. Download a reel's MP4, the
   scene's PDF board. Ask the assistant about the reel.

## 8. Functional requirements

Each requirement has an id, a statement, and where it lands. "Built" means it exists today and is
kept; "changed" means it exists and this spec alters it.

### 8.1 Film settings — `FR-SET`

- **FR-SET-1** A project has one film-settings record: `art_style` (one of the twelve ids or none),
  `aspect` (`16:9 | 9:16`), `camera_style` (`academy | handheld`), `resolution` (`720p | 1080p`,
  exists), `quality_tier` (`draft | standard | cinema`).
- **FR-SET-2** A `Film settings` dialog opens from the Production toolbar and from the first-run
  empty card. It shows the art styles as a card grid (name, era, three notable works as chips,
  one line of traits, a small colour swatch strip generated from the preset), the current one
  marked; aspect, camera style, resolution and tier as segmented controls; `Save` / `Cancel`.
- **FR-SET-3** Settings are never locked. Changing any of them marks every dependent output stale
  (FR-STALE) and shows a one-line notice in the dialog: "Changing the art style marks N stills, M
  frames and K clips stale. Nothing is deleted."
- **FR-SET-4** Every job snapshots the settings it used in its `spec`; history never rewrites.
- **FR-SET-5** The twelve art styles are data (`packages/contracts/src/art-styles.ts`): id, name,
  era, notable works, traits, a prompt block (positive descriptors, negative list), optional kept
  style-plate key. The list and copy are in [03-data-model.md](03-data-model.md) §7.

### 8.2 Character Looks and Turnarounds — `FR-CAST` (on `/characters`)

- **FR-CAST-1** The character drawer gains a **Look** section above the sheet: the kept Look (or
  the uploaded portrait), a take strip, `✦ Generate look · N cr`, `Upload`, and, once a Look is kept,
  `✦ Turnaround · N cr` with its own kept sheet.
- **FR-CAST-2** `✦ Generate look` builds its prompt from the record (name, age, description, wants
  — whatever fields exist) plus the style prefix; no reference images. The writer may add a one-line
  **appearance prompt** stored on the record (`characters.appearance`), shown above the button.
- **FR-CAST-3** Every generation is a take in `entity_generations`; `Keep` marks one; the kept one
  is what every downstream job references. An uploaded portrait (`portrait_key`, exists) is the
  "no AI" path and wins over generations until cleared — the same rule as `frame_upload_url`.
- **FR-CAST-4** `✦ Turnaround` sends the kept Look as the identity reference and asks for front /
  ¾ / profile / back / wardrobe close-up in one sheet. Kept the same way.
- **FR-CAST-5** The Cast route's list shows a small Look thumbnail in place of the initials
  avatar once one is kept; the Presence strip is unchanged.
- **FR-CAST-6** A character with no Look is not blocked from anything; every place that needs one
  says so in the writer's terms ("Ade has no look yet — without one the model will invent a face,
  and it will differ between frames").

### 8.3 Location plates — `FR-LOC` (on `/locations`)

- **FR-LOC-1** The location drawer gains a **Plate** section: the kept plate (or `photo_key`),
  takes, `✦ Generate plate · N cr`, `Upload`.
- **FR-LOC-2** The prompt is built from the record's name and what the script says about the set
  (`packages/script/src/sets.ts` — INT/EXT, times of day seen, described details) plus the style
  prefix. The Locations rebuild's rule stands: nothing is invented without the writer asking.

### 8.4 Route structure and navigation — `FR-NAV`

- **FR-NAV-1** `/production` is episode-scoped (ruled). The URL never changes for a scene, reel or
  view change; scene and reel selection are client state (open decision 10 blocks a scene id in the
  URL); `Scene | Episode` views become client state (the sibling routes' ruling) when the client
  asks — until then `?view=` stays.
- **FR-NAV-2** The **scene tabs** strip lists every present scene of the episode in script order:
  `1. EXT. COMMUNITY PITCH – DUSK`, mono number, heading in caps as the script writes it, a status
  dot (§8.12), truncating with an ellipsis; horizontally scrollable; keyboard `←/→`.
- **FR-NAV-3** Each scene tab has two icon buttons on hover/focus: `Read` (opens the Scenes route's
  reading modal for that scene) and `Auto-assign` (FR-REEL-6).
- **FR-NAV-4** The **reel strip** under the tabs lists the selected scene's reels in order: `Reel 1`,
  a status pill, its primary action (`✦ Start shooting · N cr` / `Rendering…` / `Rendered · view`),
  and a `＋` after each reel to insert one; `＋ Reel` at the end. One reel is selected (accent
  border); the canvas below is that reel's.
- **FR-NAV-5** The **sidebar** slots (exist): group = the episode's scenes with a coverage bar and
  count; widget = the episode's credits and rendered count. Selecting a scene there selects its tab.
- **FR-NAV-6** The status bar prints `N scenes · M reels · K rendered · balance` on the left and the
  route id on the right (exists, extended).

### 8.5 Reels — `FR-REEL`

- **FR-REEL-1** (built) A reel belongs to one scene (`scene_node_id`), has an `order_key`, a name,
  a `clip_seconds` from the allowed set, a `finalized_at`. Its status is folded at read.
- **FR-REEL-2** (changed) `clip_seconds` allowed values come from the registry's video capability
  for the project's tier, not a CHECK constraint (decision D-6). Default 15.
- **FR-REEL-3** (new) A reel has a **range**: `from_node_id`/`to_node_id` within its scene, null for
  the whole scene. The Performance card shows the range; the range is set by dragging in the card's
  script panel or `Set range…`. Ranges of a scene's reels may not overlap (server check).
- **FR-REEL-4** (new) A reel has a **continuity mode**: `natural` (default) or `match_last_frame`.
  The mode is shown as a small connector glyph between reel cards in the strip and as a segmented
  control on the reel; `match_last_frame` on Reel 1 of a scene is allowed only if the previous
  scene's last reel has a kept clip (else the control says why).
- **FR-REEL-5** (new) A reel has a **layout**: card positions on its canvas (`layout jsonb`),
  cosmetic; `Tidy` relays out.
- **FR-REEL-6** (new) **Auto-assign**: from the scene tab's wand or the empty scene card: creates
  reels so that the scene's accepted shots, in order, fill consecutive reels without exceeding each
  reel's clip length (a shot longer than a reel is placed alone and flagged over-long). Existing reels
  with shots are never rewritten without confirmation ("Replace the current 2 reels?"). It is a
  server action, free, deterministic (no model).
- **FR-REEL-7** (built) `Finalize` locks the reel's shots against edits from either route; `Unlock`
  reverses it while no render is in flight. `Keep` on a frame is also refused on a finalized reel
  (closes the flagged gap).
- **FR-REEL-8** (built, changed) Rename, delete (refused while a job of the reel is queued/running;
  a reel with a kept version asks "Delete Reel 2 and its 3 versions?").

### 8.6 The Performance card — `FR-PERF`

- **FR-PERF-1** Read-only rendering of the scene's nodes in the reel's range: action as body text,
  cues as character chips (kept Look thumbnail + name; `--ink3` outline when no Look), dialogue
  indented, parentheticals italic, in the script's order, with `#n-<node id>` anchors.
- **FR-PERF-2** Header: `Performance · Scene 3 · lines 12–31` and `Edit in Script →` (opens the
  Script at the first node). No editing here, ever.
- **FR-PERF-3** The card's `source_hash` (§8.13) is computed from these nodes' text; a change to
  any of them marks the reel's still, frames and clip stale and shows a one-line notice on the card:
  "The page changed since these were drawn."

### 8.7 Shots — `FR-SHOT` (the Storyboard's rows)

- **FR-SHOT-1** (built) Size, movement, angle (closed vocabularies in `@folio/script`), lens (mm),
  duration (s), description as inline content with `@character`/`@location` mentions, `origin`
  (`typed | auto_board`), `state` (`proposed | accepted`). The Storyboard's in-place editor is
  reused unchanged.
- **FR-SHOT-2** (built) `✦ Propose shots` is the pure rule-based proposer (`proposeShots`), free;
  proposals land as `proposed` rows the writer accepts or discards.
- **FR-SHOT-3** (built) The **timing bar**: one segment per accepted shot, coloured by shot index
  from `--seg-1..4` cycling, width proportional to duration, the sum printed `12 / 15 s`; over-run
  draws a `--bad` tail and the count in `--bad`; exact fill turns the count `--ok`.
- **FR-SHOT-4** (changed) The **clip length** control sits in the Shots card header as a segmented
  control of the allowed lengths; picking a shorter one than the shots' sum is refused with
  "Shots already run 12 s — shorten them first" (Laper's rule, same words).
- **FR-SHOT-5** (built) Reorder `↑ ↓` (and drag), delete `✕`, `Accept` / `Discard` on a proposal.
- **FR-SHOT-6** (new) A shot's number is `01-03` in both routes (built) but the Shots card prints
  the ordinal badge `3` in the segment's colour; the full number is the tooltip.

### 8.8 The scene still — `FR-STILL`

- **FR-STILL-1** The Scene card shows the location's name, the heading's I/E and time of day, the
  kept plate as a thumbnail (or "No plate yet"), and the reel's still: `✦ Scene still · N cr`, takes,
  `Keep`, `Upload`.
- **FR-STILL-2** The still's prompt = style prefix + heading facts + the location's set description
  + the scene's cast by name; references = the kept plate (`reference_location`) + each cast
  member's kept Look (`reference_character`), ranked per the registry's `refs.max`.
- **FR-STILL-3** A reel may have a clip without a still (the still is a should-gate: the gate box
  lists it as "recommended", not "required").

### 8.9 Frames — `FR-FRAME`

- **FR-FRAME-1** (built) Every generation of a shot is a take (`frame_generations`); the shot's
  frame is the kept one else the latest; uploads win until cleared.
- **FR-FRAME-2** (changed) `✦ Generate frames · N cr` on the Shots card generates every accepted,
  described shot with no frame **in order, each chained on the previous shot's kept frame** as
  `reference_previous`; a shot whose previous shot has no kept frame waits (tile: `Waiting for shot
  2's frame`) — Laper's gate, without the hard block, because the writer may keep frames in any order.
  A per-shot `✦ Redraw` exists on the tile (closes the unreachable-regenerate gap).
- **FR-FRAME-3** The prompt (see [04](04-generation-pipeline.md) §3) uses the shot's camera fields
  only when `origin = typed` or the field was edited (provenance); references = scene still, plate,
  each `@mentioned` character's Look + Turnaround, previous frame, style plate.
- **FR-FRAME-4** Takes: `take i of n ◂ ▸`, `Keep`, `Compare` (split / fade / side-by-side — decision
  D-17), `Select for…` (assign this take to another shot of the reel), `Download`, `Details` (opens
  the File view, §8.14).
- **FR-FRAME-5** Tile states: empty · queued · generating (progress if known, else indeterminate) ·
  waiting · drawn · uploaded · stale · blocked (reason, `Suggest rewrite`) · failed (`refunded` /
  `not yet refunded`) · cancelled.

### 8.10 The clip — `FR-CLIP`

- **FR-CLIP-1** Gate box on the reel (built, extended): required — every shot described, durations
  fill the clip exactly, every shot has a frame, reel finalized; recommended — a scene still, a Look
  for every mentioned character, a plate. Each missing item is a line with a `→` to fix it; the box
  reads `3 left` / `Ready to shoot`.
- **FR-CLIP-2** `✦ Start shooting · N cr` names the cost from the registry: `clip_seconds × tier
  rate` (+ per-reference surcharge where the model bills it), with a second line "likely 2–3
  versions ≈ M–K cr". Disabled with the reason in its title while gated, needs credits, or a render
  is in flight.
- **FR-CLIP-3** The render job's spec: first frame = shot 1's kept frame; last frame = the last
  shot's kept frame where the model supports first+last; `shots[]` serialised (prompt + duration
  each; one multi-shot job where the tier has `multi_shot`, else one clip per shot chained last →
  first, then concatenated by the worker — decision D-15 defers the chained path to phase 5, so
  phase 3 requires a `multi_shot`-capable tier for reels of more than one shot, and says so);
  `characters[]` = each mentioned character's Look/Turnaround as elements; `dialogue[]` from the
  range's dialogue nodes with the character id; continuity: previous reel's kept clip's last frame as
  first frame when `match_last_frame`.
- **FR-CLIP-4** Every render is a **version** (`reel_renders`), `Version i of n`, `Keep`, `Reshoot`
  (a new render), `Delete version` (asks; never the kept one while it is kept), inline `<video>`
  player with the poster = the anchor, `Download MP4`.
- **FR-CLIP-5** `Cancel` while queued releases the hold; while running, follows decision D-9.
- **FR-CLIP-6** The reel strip card and the Episode view show the kept version's thumbnail.

### 8.11 Jobs — `FR-JOB`

- **FR-JOB-1** (built) `jobs` is the truth: `queued · running · finished · failed · blocked ·
  cancelled`; `cost` held; `cancel_requested_at`; `error`; `blocked_reason`.
- **FR-JOB-2** (new) `progress` (0–100, nullable), `attempt`, `provider_ref`, `spec`, `route`,
  `provider_cost_usd`. The worker writes them; the tile reads `progress`.
- **FR-JOB-3** (new) A **Tasks panel** (drawer from the toolbar's `Tasks · 2 running` chip): the
  project's jobs newest first — `Type · Target · Status · Credits · Created · by`, a cancel on
  queued/running rows, a `→` to the target; filters by status and kind; "Nothing running" empty.
- **FR-JOB-4** `blocked` maps the provider's moderation refusal to the writer's terms ("The model
  refused this shot: violence. Rewrite the shot or remove the blood.") and releases the hold.
- **FR-JOB-5** No worker connected (env block unset): every `✦` draws disabled, title "No worker
  connected — set REDIS_URL and FAL_KEY", and the toolbar shows a `--ink3` note once.

### 8.12 Status and counts — `FR-STATUS`

- **FR-STATUS-1** Reel status (folded, built, extended): `writing shots · proposed · ready ·
  needs credits · generating · blocked · frames done · finalized · rendering · rendered · stale`.
- **FR-STATUS-2** Scene status dot on the tab: the "worst" of its reels by the order above
  (blocked › needs credits › stale › generating › writing › ready › rendered), `--ok` when every
  reel is rendered and none stale.
- **FR-STATUS-3** Episode stats (built, extended): scenes, reels, frames drawn/total, clips
  rendered, stale count, credits spent this episode (sum of `spend` rows), balance.

### 8.13 Staleness — `FR-STALE`

- **FR-STALE-1** Every job records `source_hash` = sha256 over: the reel range's node texts (or the
  scene's, for a still), the referenced record fields (character description/appearance, location
  set text), the reference keys it was given, the art-style id, aspect, camera style. Computed by a
  pure function in `apps/web/lib/production/hash.ts`, tested.
- **FR-STALE-2** At read, the fold recomputes the hash for the current state and marks the take
  `stale` when it differs. Stale never blocks; it informs. The tile shows an amber corner tag
  `Stale` with the tooltip listing what changed (up to three items: "Ade's look", "line 14",
  "art style").
- **FR-STALE-3** A stale kept take stays kept. `Regenerate` is live on it.

### 8.14 The File view — `FR-FILE`

- **FR-FILE-1** Any take or version opens a full-height drawer (400 px, the shell's): the image or
  video large; **Info** — target (shot `01-03` / reel / character), created, by, tier, resolution,
  aspect, duration; **Prompt** — the assembled prompt text (read-only, `Copy`); **References** —
  chips linking to the character/location records and the previous frame/still used; **Provenance**
  — parent take (for a redraw/turnaround), seed if any, cost held/charged, refund entry if any;
  **Comments** (the existing `comment_threads`, anchored to the generation id — decision D-18).
- **FR-FILE-2** Actions: `Keep`, `Select for…`, `Regenerate`, `Download`, `Delete take` (never the
  kept one while kept).

### 8.15 Credits — `FR-CRED`

- **FR-CRED-1** (built) Balance is computed from the ledger; the chip in the toolbar and the
  sidebar widget read it. The chip turns `--live` when the selected reel's next action exceeds it.
- **FR-CRED-2** Quote at click from the registry; hold (`reserve`) on submit in the same statement
  as the job insert (built); `spend` settled to the actual on finish; `refund` on failure; release on
  cancel/blocked. Idempotency keys per job.
- **FR-CRED-3** "Top up to continue" stays copy (no billing).

### 8.16 The Episode view — `FR-EP`

- **FR-EP-1** Four stat tiles (built, extended per FR-STATUS-3) above a **reel strip across all
  scenes**: scene eyebrow, then its reels as 16:9 thumbnails (kept version's poster or the anchor or
  a dashed empty), status pill, duration; click selects the reel in the Scene view.
- **FR-EP-2** `▶ Play episode` plays the kept versions back to back in a modal player (sequential
  `<video>` elements, no stitching); reels without a kept version are skipped and listed.
- **FR-EP-3** The table (built) stays below the strip.

### 8.17 The assistant — `FR-AI`

- **FR-AI-1** On `/production` the context builder receives `production: true`: the episode's
  reels with shots, take states, kept versions, refusals, quoted costs, and a **Focus** block for the
  selected reel. Read-only, as ruled.
- **FR-AI-2** Chips read the page: "Tighten Reel 2 to 15 s", "Why was shot 3 refused?", "Which
  characters have no look?". `Suggest rewrite` on a blocked shot keeps prefilling the composer.
- **FR-AI-3** Any assistant *write* (proposing shots by model, dispatching a job) is out of scope
  until ruled (open decision 13 and "widen what the AI writes").

### 8.18 Exports — `FR-EXP`

- **FR-EXP-1** `Download MP4` per kept version (signed R2 URL, 1 h).
- **FR-EXP-2** `Export board (PDF)` per scene and per episode from the toolbar's `⋯`: one page per
  reel — heading, reel name, the shot rows (number, size · angle · movement · lens, duration,
  description with mentions as plain names) and each kept frame; the film settings in the footer.
  Server-rendered HTML to PDF with the same engine the script export uses (or `window.print` CSS in
  phase 4 if that engine is not reachable — decision D-19).
- **FR-EXP-3** FCPXML / EDL: phase 5.

### 8.19 Empty and error states — `FR-EMPTY`

- **FR-EMPTY-1** No script: the 440 px card — "Nothing to produce yet", one line, `Open the script`.
- **FR-EMPTY-2** No scenes: the same card's second copy — "No scene headings yet".
- **FR-EMPTY-3** No film settings yet (first visit with scenes): a 440 px card above the canvas —
  "Set the film's look" · one paragraph · `✦ Choose an art style` (opens the dialog) · `Skip for
  now` · caveat "You can change this later; changing it marks drawn work stale."
- **FR-EMPTY-4** Scene with no reel: the dashed card in the strip's place — `✦ Propose shots from
  the scene` (creates a reel then proposes) · `＋ Empty reel` · `Auto-assign`.
- **FR-EMPTY-5** Reel with no shots: the Shots card's body — "No shots yet" · `✦ Propose` · `＋ Shot`.
- **FR-EMPTY-6** Errors are inline on the thing that failed, in the writer's terms, with the next
  action; toasts only for background completions ("Reel 2 rendered").

### 8.20 Accessibility and keyboard — `FR-A11Y`

- **FR-A11Y-1** Every control is reachable by keyboard with the `0 0 0 2px var(--accent)` focus
  ring; tabs and strips take `←/→`; the canvas takes the Storyboard canvas's keys (pan with space +
  drag, zoom with ⌘/Ctrl + wheel, `0` to fit).
- **FR-A11Y-2** Every tile and status has text, never colour alone; images have alt text from the
  shot description; the video player has native controls.
- **FR-A11Y-3** `prefers-reduced-motion` stops the connector animation and the generating shimmer.

## 9. Non-functional requirements

- **Latency.** The route's server read stays one cached `loadProduction` per request; the canvas
  renders 20 shots × 5 takes without jank; job state updates within 5 s of the worker's write
  (polling the job rows from the client at 3 s while any job is in flight; realtime is cut).
- **Reliability.** A job survives a closed tab; the worker is idempotent per job id; a crashed
  worker leaves a `running` job that a sweeper returns to `queued` after 15 min (attempt +1, max 3).
- **Money.** Reserve then execute in one statement (built); settle to actual; every ledger write
  idempotent; an advisory lock around reserve; `provider_cost_usd` on every job; a weekly margin
  report is a query, not a feature.
- **Security.** `FAL_KEY`, `REDIS_URL`, `R2_*` live in `packages/db/src/env.ts` only; the build's
  `assert-no-server-secrets` must stay green; outputs are served by signed or public R2 URLs
  composed from keys at read; the worker uses the service role and is never reachable from the
  browser.
- **Tenancy.** Every new table carries `project_id`; every query goes through a project-scoped
  repository.
- **Storage.** Every output is copied to R2 immediately (providers delete outputs within hours);
  keys under `projects/<projectId>/production/<kind>/<jobId>.<ext>`.
- **Themes.** Dark and light complete on every state.
- **Observability.** pino logs with the job id and provider ref on every transition; Sentry on the
  worker.

## 10. Constraints and dependencies

- Dependencies needing approval: `bullmq`, `ioredis` (worker). None for the provider (plain
  `fetch`). None in `packages/script`.
- Infrastructure: a Redis (Upstash or local), the existing R2 bucket, a fal.ai key.
- Node ≥ 22.12 for web tests; the worker runs on the same.
- The design README's rules bind every screen; `--bad` stays Production-only.

## 11. Out of scope for the whole set

Billing, realtime presence, comments on the canvas beyond the File view, a mobile layout (the
route is desktop-first; below 1040 px the canvas shows a "Open on a wider screen" card), i18n.

## 12. Success criteria

The **decisive walk** (also the E2E): on the Monsoon Line project — set the art style; on
`/characters` generate and keep a Look and a Turnaround for Ade; on `/locations` keep a plate for the
community pitch; on `/production` open scene 3, propose four shots, fill 15 s, draw the frames,
keep one each, draw the still, finalize, shoot, keep a version, match-cut into reel 2 — and Ade reads
as the same person in every kept frame and both versions. Then edit one line of the scene and see
exactly the affected takes go stale. Every cost was named before it was spent, and the ledger's
`spend` rows equal the settled costs.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Model churn (shutdowns, renames, price changes monthly) | the registry; nothing else names a model; `deprecatesOn` alerts |
| Consistency drift across takes | reference stack + previous-frame chaining; the take model; honest "2–3 takes" copy |
| Cost variance | quote from the registry, settle to actual, ranges on buttons |
| Double-reserve race under load | advisory lock on reserve (phase 1) |
| Provider deletes outputs | copy to R2 in the worker before writing the row |
| Concurrent sessions editing the same files | the session protocol's `git status` first; phase file lists |
| Scope creep into an NLE | non-goals; assembly is a strip |

## 14. Open questions

All in [06-decisions.md](06-decisions.md) §3, each with a recommendation. None blocks design; D-1 to
D-6 block phase 1.
