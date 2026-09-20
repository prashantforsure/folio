# Build decisions

One section per phase, newest first. Restarted 2026-09-16 with the v2 redesign: the phases
before it - every route's first build, the cuts, the editor rebuild - are in git history
(`git show 7a541bd:docs/build-decisions.md`). They describe chrome that no longer exists and are
not the reference for a rebuilt route. The v2 design package (`docs/ui design/`) was the
reference until the client deleted it on 2026-09-20; from then on each route's newest section
here is its spec.

## Open, and blocking

The live list. AGENTS.md's open-decisions table is the contract; this is what each one refuses
at in the code today.

- **Assistant cost (open decision 13).** `assistant_messages` has no cost column, the send button
  names no price, and nothing writes the ledger. "Cost is named before it is spent" is unmet
  because there is no number to name. The Characters drawer's `✦ Draft from the script` and
  `✦ Check for contradictions` (2026-09-18) took the same standing until the fourth Characters
  pass removed them (2026-09-20); the send button is the one place the number would go.
- **Open decision 8, A4.** `resolveSheet('asian')` refuses; the Script route's banner says so.
- **Open decision 10, `SCENE_xxx`.** Unchanged. The sidebar's scene rows are `#n-<node id>`
  fragments, which name a node, never a scene record; `?selected=` stays unwired, and the
  Timeline's drawer is state, not `/timeline/:sceneId` (2026-09-18).
- **`✦ Suggest placements` (the Timeline's model action)** takes the Characters buttons'
  standing under open decision 13 and is not built; the rules-based proposal queue stands in.
- **`scenes.story_time` and `scenes.beats`** are dead columns: nothing reads or writes them
  since `0011` and `0010`. A column drop is AGENTS.md's ask-first; the Timeline rebuild
  (2026-09-18) left them and asks.
- **Open decision 11, past green; 12, locked pages.** Unchanged, both refused at the engine.
- **Membership roles are stored and enforced nowhere.** A share link issues `writer | reader`
  and `addMembership` writes it; nothing reads it back. Deciding that a `reader` cannot share,
  comment or write is a capability model nobody has specified.
- **`ASSISTANT_MODEL` is `claude-opus-5`**, the API reference's default, written once in
  `lib/assistant/model.ts`. A cheaper model is a product call about the answers, not a setting.
- **Reordering episodes** is ADR 0002's open product claim and is not built; `ordinal` moves
  are the machinery, the ruling is missing.

---

## Characters, card and connector redesign (2026-09-21)

### Why

Two pieces of the fourth pass's canvas were still placeholders. The card's face printed its name
in white over a mid-tone gradient and only drew the `--cast-scrim-*` wash under a real portrait
(`[data-portrait='true']::after`) - on every photo-less card, which is most of them, the name sat
on the tint with nothing darkening it, and in the light theme (`--cast-l1: 0.62`) it failed
outright. The canvas thread was the Storyboard's `.folio-thread` reused as-is, and the graph
drew every edge the same thin dashed grey whichever tile the writer was on.

The brief named a competitor's card (Portrait / Advanced tabs, a look-sheet tab) and its graph
(the edges of the hovered node bolded and coloured, the rest muted) as the level of polish to
match - not its colours. The mockups were a Claude Design canvas
(`https://claude.ai/artifact/MXae4wnmJ3yiW4no4RDMw2` - the client's, private) approved
2026-09-21 with a second round that moved the tabs out of the face and darkened the tint after
the first round's name still read faint on the client's screen.

### What was built

- **The card** (`_characters/canvas/character-node.tsx`, `.folio-char-*` in `globals.css`).
  A `Portrait · Advanced · Look sheet` strip on the card's top edge, component state per card
  (`data-face-tab`; the URL never changes - the Characters ruling). The face is a deep tint of
  the record's hue - new tokens `--face-l1/-c1/-l2/-c2` in `palette.css`, `0.36 → 0.19` dark,
  `0.42 → 0.24` light, so white ink is legible straight on it on either theme; `--cast-l*` stays
  the graph tile's and Locations' - with the name at 20px/600 and `Male · 16` at 14px, and the
  scrim on **every** face, photo or not. Chips carry an icon each (`board`, `comment`), the
  count in `--ink` and the unit in `--ink2`; the bio is 13.5px `--read`. Actions are two rows:
  `Edit · Upload`, then `✦ Generate` full width, still disabled with `Needs the Production
  worker`; the connect grip is a 40px ring of four dots ending that row. `Advanced` draws the
  costume & makeup prompt the look sheet will read, **disabled** with the same reason - a field
  that saved nowhere would be a trap; `Look sheet` draws three empty angle slots. Both are
  design-only until Production's worker exists. `CHAR_NODE_MIN_H` is 560.
- **The canvas thread** (`relationship-threads.tsx`, `.folio-rel-thread*`). Three strokes on
  one path: a blurred `--line` glow, a 2px `--line2` rail, the moving dash on top (7 + 9, one
  period per offset, still the route's one motion, still off under reduced motion) with its ink
  graded `--ink3 → --ink → --ink3` along the curve by a `<linearGradient>` per thread. The pill
  is 26px, `--ink` 500, with a real 1×12 divider; hovering or focusing it lights its thread
  (`data-lit`: dash and glow go accent, a 3px `--accent-bg` halo on the pill). The Storyboard's
  `.folio-thread` is untouched.
- **The graph** (`graph/relationships-view.tsx`, `graph-edges.tsx`, `graph-node.tsx`). The view
  holds `hover` (pointer or focus on a tile) and `active = hover ?? selected`; an edge touching
  the active tile is `data-on` (2px solid `--accent`, an `--accent-bg` drop shadow, its two
  labels accent), every other edge and label `data-dim` (22% / 35%), and tiles that are neither
  the active one nor its neighbour `data-dim` (55%). Tiles get a `--line` hover ring and a
  focus outline.
- Every control has a `:hover` and a 2px `--accent` `:focus-visible` ring: the tabs, the face,
  the actions, the grip, the pill, the graph tiles and labels.

### Decisions

1. **The highlight is `--accent`, blue, not the competitor's gold.** The brief allowed a warm
   hue "if it is one CSS custom property this product already tokenizes for accent". It is not:
   `--accent` is the one accent, and `--warn` / `--caret` / `--live` are semantic (README: "no
   other hues"). A gold edge would be a second accent. If the client wants warm here, that is a
   palette ruling, not a component change.
2. **No new colours.** The face tint is four lightness/chroma numbers over the existing hue
   scale; the scrim and the white ink are the existing `--cast-*` tokens; everything else is
   `--s1..3`, `--line*`, `--ink*`, `--read`, `--accent(-bg)`.
3. **The prompt field is disabled, not merely unsaved.** The mockup drew it live; the code draws
   it inert with the reason in its `title`. Nothing on the card pretends to keep what it cannot.

### Verified

`pnpm --filter web typecheck`, `pnpm lint` (web ran, not cached), `tests/characters-canvas.test.ts`
and `tests/characters-graph.test.ts` on Node 22.23 (18/18). The E2E walk's selectors
(`[data-node-face]`, `[data-node-edit]`, `[data-generate]`, `[data-threads] [data-thread]`,
`[data-thread-pill]`, `[data-edge]`, `[data-edge-label]`) are kept; the walk itself is unrun
(no credentials). Not looked at in a browser: no signed-in session was available to this pass.

---

## Characters, fourth pass - the canvas (2026-09-20)

### Why

The client's verdict on the third pass (the 2026-09-17/18 four-phase rebuild - Cast · Presence ·
Sheet, a never-dismissed resolve queue above the cards, an 870-line drawer of evidence sections,
two ✦ model actions): "very complex and cluttered … when I open it's a mess." The reference is
laper.ai's Characters route - an infinite canvas of draggable character cards, a Relationships
graph with authored labelled edges, a List table, a New Character side panel - "change a little
things to make it better."

This is the fourth rebuild. The three before it failed by "replacing the pixels and leaving the
identity layer dark" (phase 1, below). This one keeps the identity layer whole - the alias table,
the rows-based resolve queue, the record-level rename with preview and undo, the merge, `Off the
page` records kept - and moves it **off the main surface** into one on-demand `Needs a decision`
panel. The canvas is the surface; the machinery is a pill away.

The plan (`~/.claude/plans/i-want-to-redesign-floofy-avalanche.md`, approved 2026-09-20) and the
four rulings below were the spec. `docs/ui design/` was deleted by the client the same day, on
purpose, and was not read - not from git history either. The earlier Characters sections below
are history, not spec.

### Rulings (the client, 2026-09-20)

1. **The Relationships graph replaces Presence; the table is reshaped.** Views = `Canvas ·
   Relationships · List` (client state, URL stays `/characters`). This reverses the 2026-09-17
   ruling that cut the graph. Migration `0024` reshapes the empty `character_relationships`
   (nothing had written it since `0013`): `what` / `shift` and the self check go; two directional
   labels (`a_is`, `b_is`, at least one non-empty), a `description`, stamps and an `a < b` check
   come, one row per unordered pair. The Presence grid, the pairs list, the `never-share` /
   `silent-pair` findings and the Sheet's Balance card go with it.
2. **No sidebar.** Full width, like the Storyboard canvas. The count, a `Needs a decision · N`
   pill and `＋ New character` sit in a slim toolbar row over the canvas.
3. **Positions persist.** `characters.canvas_x / canvas_y`, on the `0020` pattern (both or
   neither), written on drop.
4. **The edit drawer is a form, like laper's.** Fields + portrait + this character's relationships
   + `Delete · Cancel · Save`. No evidence sections, no alias table, no ✦ Draft / ✦ Check. Aliases
   and merges are reachable only from the queue panel. Saving a changed name on an on-page
   record is still the sanctioned rename (preview → confirm → undo).

### Built

- **Data (`0024`).** `characters.canvas_x / canvas_y` + `characters_canvas_position_whole`;
  `character_relationships` reshaped as above. Generated through `drizzle-kit/api` in two
  prompt-free diffs (the drops from `0023`'s snapshot, then the adds) because a same-table drop +
  add makes the generator ask whether `a_is` is `what` renamed and exit without a TTY. **The
  plan's premise that the table was empty was wrong for the dev project**: the first migrate
  failed on the `a < b` check - one row from the first Characters route (2026-09-12, `Meera
  Pawar → SURESH KADAM · "Tenant, then opponent"`, stored `character_id > other_id`). Rather than
  drop an authored label, the SQL was reordered by hand - the adds first, then a fold of every
  directed row into the pair shape (`what` → `a_is` when already `a < b`, else re-inserted the
  other way round with `what` → `b_is`, merging into the pair's row if one exists; `shift` →
  `description`), then the drops and the checks. The end state is the snapshot's exactly. On dev
  the row now reads `SURESH KADAM · Meera Pawar`, `b_is = "Tenant, then opponent"`. `db:check`
  clean; applied through `drizzle-orm/postgres-js/migrator` directly (the two silent `db:migrate`
  failures were the constraint and the fold's `NOT NULL` on `what`, seen only that way) in its
  own run on 2026-09-20. RLS unchanged (both tables under `0001`). `repositories/characters.ts`: `RelationshipRow`, `listRelationships` (inner-joined
  twice to live records), `upsertRelationship` (on the pair's key, guarded both-live),
  `deleteRelationship`, `placeCharacter`; `CharacterRecordRow.canvas`; **`mergeCharacterRecords`
  rewritten** - one CTE remaps loser → winner, drops a row that would pair the winner with itself,
  re-sorts the pair with the labels swapped when the order flips, `on conflict do nothing` so the
  winner's own row for a pair wins. `repositories/derivation.ts` hands `@folio/script` one
  directed `{ other, what }` per non-blank side of each row (`packages/script` untouched).
  `lib/script/server.ts`'s `relations` stat is a set of sorted pair keys, not a sum.
- **Contracts.** `RelationshipInputSchema` (labels ≤ 40 trimmed, description ≤ 500, refined
  `aId !== bId` and one label non-empty), `Relationship`, `CanvasPositionSchema` re-exported from
  `storyboard.ts`. `CharacterProfileEditSchema` is `color · gender · age · role · bio ·
  appearance`. `CastRow` slimmed to what the canvas, graph, List, queue and Production read
  (`canvas` added; the voice's quotes, positions and per-scene counts gone); `CharacterProfile =
  CastRow & { nameCues, relationships }`. Deleted: `SceneFacts`, `QuotedLine`, `IntroLine`,
  `SceneCountRow`, `TalksToRow`, `BoundCueView`, `MapColumn`, `CharacterMap`, `DRAFT_FIELDS`,
  the Findings block, `CharacterFindingId`. `AliasProvenance` **stays** - Locations' slugline
  table prints it. `CharacterRelationshipSchema` in `contracts/derived.ts` mirrors the new
  columns.
- **Pure modules, tested** (`apps/web/tests/characters-{canvas,graph,relationships,list}.test.ts`,
  28 tests). `lib/workspace/canvas.ts` (`intersects`, `gridLayout`, `firstFreeCell`);
  `lib/characters/canvas.ts` (`characterPositions`: stored wins, unplaced take the first free
  cell of a four-column grid in cast order - deterministic, so `＋ New character` needs no write to
  land; `characterBounds`); `lib/characters/graph.ts` (`authoredEdges`, `dialogueEdges` deduped
  with the larger side winning, `forceLayout` - Fruchterman-Reingold seeded on a circle by index,
  linear cooling, a fixed 300 iterations, **no randomness**; `circleLayout`; `edgeEnds` clipped to
  each rect; `edgeCurve` / `edgePath` / `bezierPoint` for the canvas thread and its pill;
  `chordPath` / `chordLabelAnchor`; `edgeLabelAnchor` with the angle folded into (−90, 90];
  `strokeOf`); `lib/characters/relationships.ts` (`orderPair`, `pairKey`, `orderInput` swaps the
  labels with the ids, `relationshipOf` reads a row from either side, `describeRelationship`,
  `pillLabels`); `lib/characters/list.ts` (from `sheet.ts`: nine columns, `sortCast` stable with
  empties last and a numeric age before a worded one, `csvOf` RFC 4180 with the optional columns
  and `E1…En`).
- **Server.** `loadCharacters` reads records, tallies, the scene index (as refs with words),
  the open cue rows, decisions, bound cues and relationships - **no node, no eighths, no
  location, no mention label** - and returns `cast` (cast order: scenes, lines, name),
  `relationships`, `dialogue` (from the derivation's exchanges), `resolve`, `walkOns`, `pairs`,
  `index`, `derivable`, `storage`. `loadProfile` = the row + `nameCues` + its relationships.
  `castRowOf` keeps its signature for Production. Actions: `placeCharacterOnCanvas` (no
  re-derive, no revalidate - the canvas holds the point optimistically), `saveRelationship`
  (sorts the pair, upserts), `deleteRelationship`; the twelve kept verbatim.
- **Chrome.** `packages/ui/src/icons.tsx`: `relationships` (three nodes, two links).
  `_chrome/canvas/zoom-pill.tsx`, `use-node-drag.ts` (3px threshold, pointer capture, delta /
  scale, `moved()` so click ≠ drag), `use-measure.ts` - lifted from the Scenes canvas; the
  Storyboard and Scenes canvases are **not re-pointed** this pass. `_chrome/modal.tsx` (portal to
  body, the Scenes scrim, Escape, focus the first field, restore focus on close).
  `_chrome/characters-layout.tsx` has no sidebar and no read of its own.
- **Canvas view.** `_characters/canvas/character-canvas.tsx` on the Storyboard's viewport hook:
  the ground, the world, `RelationshipThreads` (`.folio-thread` per row, a two-label pill at the
  cubic's midpoint - click to edit; a live thread from a dragged grip to the cursor), one
  `CharacterNode` per record (306px; the face is the grip and the click; name + `Male · 16`
  bottom-left, `—` when neither is set; `N scenes` `N lines` chips; a 2-clamp bio or `No character
  bio yet`; `Edit` · `Upload` (disabled with the reason without `R2_*`) · `✦ Generate` **disabled**
  with `title="Needs the Production worker"`; the four-dot connect grip). The connect drag is the
  view's: `pointermove` on the document, `elementFromPoint(...).closest('[data-character-node]')`
  marks the target, a release over another card opens the modal on the pair. A drop writes
  `placeCharacterOnCanvas` and is held in `placed` until the next read agrees. Fit on mount via
  `openingWindow`; the zoom pill top-right.
- **Relationships view.** `_characters/graph/relationships-view.tsx`: 72×90 tiles (the record's
  gradient or its portrait, a name pill) on a static dotted ground (`data-static`, no pan);
  `graph-edges.tsx` draws authored edges dashed with `paint-order: stroke` labels at t = 0.22 /
  0.78 rotated along the line (on the chord, along the curve), dialogue edges solid with
  `strokeOf(weight)` and no label; `Force · Dialogue · Chord` as a `ViewPill` bottom-centre;
  tile drags override until `Relayout` (drawn only while there is something to relayout); tile
  click → drawer, label click → modal. Inline empty:
  `No relationships yet — drag a card's handle onto another on the Canvas, or open a character and
  add one.`; the Dialogue layout's own line when no pair speaks.
- **List view.** `_characters/list/list-view.tsx` + `display-menu.tsx`: Name (chip + name + `N
  scenes`) · Gender · Age · Role · Scenes · Lines, every header a sort; `Display` (the sliders
  icon) toggles Words · Share of dialogue (a bar drawn with utilities - the `.folio-share-bar`
  class is deleted) · Episodes (`EpisodeBars`) and offers `Export CSV` (`characters.csv`, built in
  the browser from the rows as shown). Rows are links to the drawer on `.folio-sheet-row`.
- **Drawers.** `new-character-drawer.tsx`: `Basic info` (Name, swatches - least-used default,
  Gender, Age, Role) · `Bio` · `Appearance notes` (hint `Shapes the generated look`) · `Cancel ·
  Create`. `character-drawer.tsx` (870 → ~430 lines): lead = portrait or `CastMark`; meta `N
  scenes · N lines · <origin>`; the same fields; `Portrait` (`Upload` / `Replace` · `Remove`, the
  storage notice without `R2_*`); `Relationships` (rows `you are their X · they are your Y`, click
  → modal; `＋ Add relationship` → a picker of the other records → modal); foot `Delete` (live
  off the page; **drawn disabled on the page with the reason** - the action would refuse it) ·
  `Cancel` · `Save`. The rename flow is verbatim from phase 2: `previewRename` → `RenameConfirm`
  → `renameCharacter` → toast `Undo` (`undoRename`); `taken` → the merge door; `Create a new
  character instead`. Publishes the assistant's Focus. `queue-panel.tsx`: `DrawerShell` titled
  `Needs a decision` hosting `unmatched-queue.tsx` and `walk-ons-line.tsx` unchanged, the undo
  toasts moved here from the Cast view; `setQueueIntent` from the Scenes modal still opens it;
  the panel closes itself when nothing is left. `relationship-modal.tsx`: `New relationship` /
  `Edit relationship`, sub `Relationship between A and B`, `A is B's ___` · `B is A's ___` ·
  Description, `Delete` (existing only) · `Cancel` · `Create` / `Save`.
- **Workspace.** `characters-workspace.tsx`: the toolbar (`Characters · N` · the pill with a
  warn dot, hidden at zero · `＋ New character`), one of the three views or the empty card, the
  status bar (`N characters · N relationships · <name>`), **exactly one thing in the drawer slot**
  (new | queue | edit), the modal over all of it. Publishes `facts.ts` (`open`, `noDescription`,
  `unrelated`) for the assistant's chips: `Describe <name> from the script` (accent, a prompt) ·
  `Who has no relationships yet?` (warn, a report) · `Find characters with no description` (ok, a
  report). The empty card's copy: `No characters yet` / `Read the script and every character cue
  becomes a card on the canvas - or add one by hand.` / `✦ Read the script` · `＋ By hand`.
- **CSS.** One block, "The Characters canvas (2026-09-20)": `.folio-char-node` (+ dragging,
  selected with the accent inset, `data-target` with the accent dashed outline - selection is
  accent's sanctioned use; noted as the third restatement of the shot node, to fold into one
  `.folio-canvas-node` next canvas pass), `.folio-char-face` (9/10, the `.folio-cast-mark`
  gradient, the `--cast-scrim-*` wash under a portrait), `.folio-char-glyph`, `.folio-char-chip`,
  `.folio-connect-grip`, `.folio-edge-pill`, `.folio-edge` (dashed, **no animation**),
  `.folio-edge-label` (`paint-order: stroke` on `--bg`), `.folio-graph-node` / `-name`,
  `.folio-canvas-ground[data-static]`, `.folio-modal`. Every colour is a token; no hex, no
  `dark:`, no grey scale; the cast tokens already carry their light block.
- **E2E** (`apps/web/e2e/characters-route.spec.ts`, rewritten to the plan's eight tests, lint and
  typecheck clean, **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` in this session).

### Deleted (each gate `rg`'d first; nothing outside the set referenced them)

`_characters/{cast-view, character-card, presence-view, sheet-view, cast-sidebar, alias-table,
continuity-section, intro-section, voice-section, sides-modal}.tsx`;
`lib/characters/{model-actions, evidence, sheet}.ts`; `tests/characters-{evidence, sheet}.test.ts`;
the actions `dismissIntroFinding, readSides, bindAlias, moveAlias, splitOff, unbindAlias`; the
results `BindResult, MoveResult, SidesResult, DraftResult, CheckResult, FindingResult`; the
repository's `listCharacterFindings, replaceOpenFindings, setFindingStatus, CharacterFindingRow,
moveBoundCue, splitBoundCue`; `compose.ts`'s `DrawerIntent`; `cast.ts` beyond `reasonLabel,
initialsOf, leastUsedColor, unmatchedLabel, QUEUE_FOLD, routeIdOf, perEpisode, refsOf,
figuresOf`; `figures.ts` beyond `sceneRefOf, formatSceneRef, citeOf`; the CSS
`.folio-cast-card / -badge`, `.folio-presence-*`, `.folio-share-bar`, `.folio-balance-card`.
`tests/characters-cast.test.ts` and `characters-figures.test.ts` slimmed to what stays.

### Not built / flagged

- **`✦ Generate` is drawn disabled** (`Needs the Production worker`): `apps/worker` is empty, the
  look-sheet job is Production's (`docs/production/`), and its cost must be named before it is
  spent. The assistant composer's precedent.
- **laper's header import icon** is not built - no character import format exists.
- **Manual merge only through the queue's pair rows** and the rename's `taken` door; the drawer
  has no `Merge into…` (ruling 4).
- **`character_findings` is orphaned**, kept forward-only like `revisions`; dropping it is
  ask-first. Its two enums' values now live in `schema/derived.ts` beside the table.
- **`characters.status / wants / needs` are unread by the route** but still in the schema and
  still printed by the assistant's Focus block (`lib/assistant/server.ts`); dropping or hiding
  them is ask-first. `deleteBlankCharacter` still tests them, correctly (a record an earlier pass
  wrote on is not blank).
- **A derivation-minted spelling has no unbind door**: the queue's `revokeDecision` covers
  decisions only, and the alias table went with the drawer.
- **The Storyboard and Scenes canvases are not re-pointed** at `_chrome/canvas/`; their own copies
  of the pill, the drag and the measure stay until a pass in those routes.
- **`Hide nav` in the status bar toggles nothing on this route** - the bar is shared and the
  route has no sidebar.
- **The drawer's `Delete` on an on-page record is disabled with the reason** rather than live and
  refused; the action still refuses, so either reading holds.
- **`AliasProvenance` stays in `@folio/contracts`** (the plan listed it for deletion) - Locations'
  slugline table still prints it.
- **The relations count on the Outline's Info panel** now counts pairs (`lib/script/server.ts`)
  and matches the pills on the canvas.
- **Open decision 13** loses its two Characters buttons; the assistant's send button is the one
  place left for the number.

### Verification

`pnpm typecheck` 6/6 · `pnpm lint` 7/7 · `@folio/script` vitest 32 files / 546 tests (untouched)
· web vitest on Node 22.23 43 files / 501 tests (the six Characters files and the routes test
among them) · `pnpm build` green, `assert-no-server-secrets` checked 289 client files · `db:check`
clean · the journal had exactly one pending entry (`0024`) before `db:migrate` · E2E rewritten,
unrun. The browser walk and the manual checklist in the plan (create → next free slot; drag →
reload; connect → thread + pill; the graph's three layouts, away and back; List sort / Display /
CSV; rename → confirm → undo; the queue resolve dropping the pill and the badge together; a pair
merge with relationships following the winner; light theme on every view, the drawer and the
modal; inbound `/characters/:uuid` from every route; ✦ Generate disabled; the wheel never
scrolling the page over the canvas) are the client's.

---

## Timeline rebuild, phases 2-5 - placement, continuity, threads, the assistant (2026-09-18)

Phase 1 (the section below) put the route on the shell and left four phases of the approved
plan: placement, the continuity check, thread tooling and the assistant. The client asked for
the rest in one go - "fix those as well, make sure it's working end to end, and clear out the
unwanted code" - so this is one pass and one section, in four parts, with the cleanup at the
end. The four rulings of phase 1 stand; nothing here re-opens them. The one deviation from the
ruled shape of `timeline_findings` is under "Judgement calls".

### Phase 2 - placement: the page as evidence, the writer as the author

**Time cues** - `packages/script/src/time-cues.ts` (pure, no dependencies, `time-cues.test.ts`,
7 tests). `timeCuesOf(nodes, headings)` reads, per accepted scene, the heading's time of day and
how it *binds* to the scene before it (`CONTINUOUS` / `SAME TIME` = the same moment, `LATER` /
`MOMENTS LATER` = the same day) and the first action line among the scene's first two
(`CUE_ACTION_LINES`) that names a time - quoted, with the node it came from and an `offsetDays`
where the count is exact: "the next morning" is 1, "three days later" 3, "two weeks later" 14,
"that night" 0, "two days earlier" -2. "A year later", "months later" and "1997" are cues with
`offsetDays: null` - quoted as evidence, never counted, because a month is not a number of days
and a year is not a day at all. Read at request time in `lib/timeline/server.ts` over the
project's node list (`readProjectScreenplayNodes`, the read Locations already makes for
`establishingLines`), stored nowhere; the rows carry `cues` and `light` (the `light-vs-clock`
rule's input) across the boundary.

**Proposals** - `proposePlacements(scenes, firstDay)` in the same file: one proposed story time
per unplaced, unflagged scene, in page order, each counted from the last frame-story scene
before it - placed by the writer, or proposed just above. A bind takes the day (and, for
`continuous`, the clock); an exact cue adds its days; anything else *carries* the day, and
says so (`reason: 'carried'`). A flashback-flagged scene is skipped and never counted from.

**The queue** (`_timeline/proposal-queue.tsx`, the Characters resolve queue's shape) - what
`Place N scenes` (the toolbar, the banner's `Place them`, the empty card's primary) opens over
the grid: a row per proposal with the ref, the slug, the line (`CONTINUOUS → same day and clock
as E1 Sc 4` · `LATER → Day 2, later the same day` · `"the next morning" → Day 3` · `no cue →
Day 3, carried from E1 Sc 9`), the evidence as a citation chip into the script at the line it was
read from, `Day N` (solid when read from the page, a line button for a carry) and `Skip`.
Folded past six rows. `Accept` is the drawer's own write for that scene - and the rows below
re-count from the day just written, which is what a carry means. `Skip` hides the row for the
visit and writes nothing. `Accept all` is one statement (`placeScenes` over `unnest`, only where
the scene still has no day) and the status bar offers `Undo` - `unplaceScenes` over exactly the
placements the write answered with, only where each still carries exactly that day and clock.
This is what replaced `Assume continuous`: the same carry for a scene with no cue, shown as a
proposal with its reason, accepted one at a time or whole, taken back the same way. A carried
day is still one the writer accepted, so `placed` means "the writer said so".

**Optimistic writes** - the loader no longer computes the order: `TimelineLoad` is the rows,
the threads, the episodes, the introductions and the verdict keys, and the workspace runs
`@folio/script` over them (`chronology`, `storyJumps`, `continuityFindings`,
`proposePlacements`). Every write lands as a *patch* over its row first (`applyPatches`,
`patchLanded` in `view.ts`), so the grid re-orders and the findings re-run before the round trip;
a patch goes when the refreshed row agrees with it, or at once when the write fails. The first
pass drew nothing until the refresh came back (the E2E budgeted a minute per save).

**Drag** - a card is `draggable` (HTML5, no dependency; the id rides under
`application/x-folio-scene`). In chronology every cell is a target: the scene takes the column's
day (clock cleared, flag kept) and, on the thread lanes, the row's thread as its first when it
differs; a trailing `＋ Day N` column is a new day after the frame story. The unplaced strip is a
target the other way - a placed card dropped there loses its time. In story order the columns
are page order, so a drop changes only the row. The sidebar's thread rows drag too (phase 4).

**Keys** - the grid's roving tabindex: one card in the tab order (the selected, else the first);
`←`/`→` along the row, `↑`/`↓` across rows in the same column, `Home`/`End`; `Enter` opens the
drawer, `Escape` closes it; `F` flips the flashback flag; `[` and `]` move the scene a day
earlier or later; `D` and `C` open the drawer on its Day or Clock field. The drawer gained
`+1 day` (one after the day typed, else after the previous scene) beside `⇅ Same day as the
previous`, and a **What the page says** section - the heading's time of day and the cue line as
citation chips into the script, so the writer decides with the page in view.

### Phase 3 - continuity: eight rules, one verdict

**The check** - `packages/script/src/continuity.ts` (pure, `continuity.test.ts`, 15 tests),
replacing `timeline.ts`'s one-rule `continuityFindings` (`storyJumps` stays there for the chip's
arrow). `continuityFindings({ scenes, introductions, threads })` over `ContinuityScene` rows -
the timeline scene plus the page's facts the route already loads: episode, page, cast ids, set
id, the heading's light, thread ids. Each finding carries `kind`, a stable `key`, the scene, the
scene it is measured against, a `subject` (a character or thread id) and, for the gap kinds,
the gap:

| kind | the fact | the false positive it refuses |
| --- | --- | --- |
| `order` | a frame scene earlier in story time than the *latest* frame scene before it on the page; a run of scenes that keep going back in order is one finding, on the run's first | `Day 5, Day 3, Day 4` was one finding on the 3 and nothing on the 4; adjacent-pair comparison |
| `flashback` / `flashforward` | the same fact on a flagged scene, either direction | listed as a card - the flag is the answer |
| `same-day-unclocked` | two consecutive frame scenes on one day, one without a clock | an `order` finding on an unknowable order; informational |
| `two-places` | a character in two scenes at one day and clock in two different sets | an unclocked scene, an unresolved heading |
| `before-introduction` | a character present earlier in story time than the scene that introduces them (`character_derivations.introduced_at`) | a flashback, where that is the point |
| `light-vs-clock` | a `DAY` heading clocked outside `DAYLIGHT` (05:00-21:00), a `NIGHT` heading inside `NIGHT_HOURS` (07:00-18:00) | a summer evening at 20:30 |
| `thread-silent` | a thread with no scene for `THREAD_SILENT_EPISODES` (1) whole episodes or `THREAD_SILENT_PAGES` (30) pages between two of its scenes | - |
| `day-gap` | more than `DAY_GAP_DAYS` (7) days between consecutive frame scenes | informational |

The thresholds are named constants in the core (plan item 10), not rulings. `precedesStoryTime`
is still strict - unknown never precedes - and the rules inherit it.

**Buckets and notes** - `lib/timeline/view.ts`'s `bucketFindings(findings, deliberateKeys)`:
`open` (what the tab's badge counts), `notes` (the two informational kinds), `deliberate`,
`flagged` (the two flag kinds, counted in one line at the foot, never cards). `findingNote`
words each kind over the names only this side knows (`Meera is at Kitchen and at Standpipe at
Day 2 · 06:40 (E1 Sc 9).` · `Farida is present here (Day 1) but is introduced in E2 Sc 3 (Day
3).` · `The heading says NIGHT but the clock says 14:00.` · `Love goes quiet for 1 whole episode
between E1 Sc 12 and here.`); `KIND_LABEL` is the card's chip.

**The verdict** - `timeline_findings` (`0023`, applied to dev in its own run): `kind`, the
check's `key` (unique per project), `a_ref`, `b_ref`, `subject`, `created_at`, cascading with
the project, RLS on the `0022` pattern. A row is `It's deliberate`; `Reopen` deletes it. The
Continuity view lists the open findings as cards (the kind chip, the note, `Against E1 Sc 9`,
`Open →`, `Open in Script →`, `It's deliberate`), the notes and the deliberate under two folds
(`Notes · 4`, `Marked deliberate · 1`, each card with `Reopen`), and the flag count at the foot.
The drawer lists the findings about its scene in a **Continuity** section with the same
buttons. The card's `⚠` is an open finding (its title the kind and the note); `↺` a flashback,
`↻` a flash-forward.

### Phase 4 - threads as a tool

- **Reorder** - the sidebar's rows drag (`application/x-folio-thread`); a drop writes the whole
  order (`orderThreads` → `orderStoryThreads`, one statement over `unnest ... with ordinality`
  that refuses a list disagreeing with the project's threads). `deleteStoryThread`'s CTE gained a
  fourth step: the remaining threads close the gap in `position`, so the column is dense again
  as the schema comment promised.
- **A scene's row is a choice** - the drawer's thread chips carry `▲ Make row` (first = row) and
  `×`; the `＋` menu appends. All three are one write of the whole list (`setSceneThreads` →
  `writeSceneThreads`, which refuses a list naming a thread the project does not have, in the
  same statement) - `linkSceneThread` and `unlinkSceneThread` are gone. A drop onto another
  thread's row is the same write.
- **Ghost cards** - on the thread lanes a scene on threads A and B draws its card in A's row
  and a dashed ghost (`data-scene-ghost`, `--ink3`) in B's - "where threads run in parallel",
  drawn. A ghost opens the same drawer and does not drag.
- **Presence** - each sidebar row carries `EpisodeBars` (`@folio/ui`), one bar per episode
  (`threadPresence` in `view.ts`; the layout hands the counts) - "does the B-plot disappear in
  E3" at a glance.
- **Pacing** - each chronology column head carries the ruler (`.folio-lane-ruler`): a bar as
  long as the day's share of the fullest day's pages (`rulerOf`), under the `3 scenes · 4 6/8 pp`
  line it already printed.
- **Lanes by** - `Lanes by threads ▾ / characters / locations` on the toolbar: the same grid,
  a different `rowsOf` (`GridLanes` in `view.ts`). Character lanes put a scene in every cast
  member's row, whole; location lanes in its set's row; rows by scene count. Solo and drag-to-row
  apply on the thread lanes only.
- **Export** - `⋯ → Story chronology as Markdown` (`lib/timeline/markdown.ts`, pure, tested on
  the Outline export's precedent): a heading per story day, each scene's ref, set, clock and
  threads, the unplaced at the foot; `monsoon-line-chronology.md` through a Blob, the toast
  names it.
- **Read in story order** - `⋯ → Read in story order` (`_timeline/read-modal.tsx`): every
  placed scene on the Scenes route's grained sheet, a scene at a time in story time, `Previous`
  / `Next` and the arrow keys, `3 of 17 · E1 Sc 4 · Day 2 · 06:40` in the meta line. A scene's
  lines are read when the reader turns to it (`readSceneLines`, the one read-on-demand action:
  the document's nodes cut with `lib/scenes/excerpt.ts`), not shipped with the route.
  `_scenes/script-modal.tsx` was split into `PaperModal` (scrim, portal, Escape) and
  `ReadingPaper` (toggle, meta, sheet or refusal, an optional controls row) so both readers are
  the same two pieces; `ScriptModal` is unchanged in what it draws.

### Phase 5 - the assistant reads story time

- **Facts cell** - `lib/timeline/facts.ts` (`createCell`, below): the scene index, the drawer's
  scene with its findings' notes, the unplaced refs, the `thread-silent` findings. The panel's
  three chips on `/timeline` are **reports**, no model: `Which 7 scenes have no story time?`
  (the refs as citation chips), `Why is E1 Sc 14 flagged?` (the open scene's notes; asks for a
  scene when none is open), `Where does a thread go quiet?` (the silent threads' notes). The
  subhead the panel already printed - "Ask how the story sits in time, or where a thread goes
  quiet" - is true now.
- **Focus kind `scene`** - `AskFocusSchema` and `AssistantFocus` gained `{ kind: 'scene', id }`;
  the drawer publishes its scene on mount and clears it on unmount; `sceneFocusBlock` in
  `lib/assistant/context.ts` reads the ref, heading, gist, story time and flag, threads, the
  frame scene before it, the page's cues and the findings on it, and tells the model it cannot
  place the scene itself.
- **The read** - the panel sends `scope: 'project'` and `timeline: true` on `/timeline`;
  `lib/assistant/server.ts`'s `timelineOf` runs the same loader and the same check the route
  draws from (`loadTimeline` over the gate's scope, `bucketFindings`, `findingNote`) and adds a
  **Story time** block to the system prompt - every scene's ref, heading, story time or
  `unplaced`, flag and threads - and the open findings as lines, so "where does the love thread
  stall" is answered from what the route knows. `loadTimeline` now takes
  `Pick<ProjectContext, 'scope' | 'project' | 'episodes'>` so the turn can build it from the gate
  rather than re-run the page loader. This is the widening AGENTS.md puts behind a question; the
  client approved all five phases with the plan, and the read is per route as the other two are.
- **`✦ Suggest placements` is not built** - a model action in the queue is open decision 13's
  (no price, no ledger row); the rules-based queue stands in.

### Cleanup

- `lib/workspace/open-cell.ts`'s `createOpenCell` is now `createCell<T>(initial)` with
  `createOpenCell = () => createCell(false)`; the three facts cells (Characters, Locations,
  Timeline) are `createCell<Facts | null>(null)` instead of three copies of the same store.
- `_characters/use-toast.ts` moved to `_chrome/use-toast.ts` (its own doc said "moves to
  `_chrome/` when a second route needs it"; three routes did).
- Gone: `timeline.ts`'s `continuityFindings` and `ContinuityFinding` (superseded by
  `continuity.ts`); `lib/timeline/server.ts`'s `enterTimeline` (unused), the loaded `findings` /
  `jumps` / `chronology` / `span` / `placed` / `flashbacks` (computed on the client now);
  `view.ts`'s `spanLabel` (unused) and `openFindings` (replaced by `bucketFindings`);
  `linkSceneThread` / `unlinkSceneThread` / `placeUnplacedScenes` (replaced by
  `writeSceneThreads` / `placeScenes`); the `jumps` record across the boundary.
- `scenes.story_time` and `scenes.beats` are still on the row: a column drop is asked for
  (AGENTS.md, When to ask first) and this pass did not take it.

### Judgement calls, flagged

- **`timeline_findings` has no `status` column.** The ruling named `character_findings`' shape
  (`status open | deliberate`); with a row written only when the writer says deliberate, the
  column would hold one value, and a column with one value is a column. A row *is* the verdict;
  `Reopen` deletes it. One column fewer than ruled; reversible in a migration if a second status
  ever means something.
- **`order` is keyed on the scene alone** (`order:<sceneId>`), not on the pair: which scene it
  is measured against changes as the writer places more, and "this one steps back" is what the
  writer marked deliberate.
- **Ghost cards do not drag** and the row a drop lands in is the *first* thread; a ghost's own
  row is reachable through the drawer's `▲`.
- **`next morning` as a quick button was not added** (plan, tier 2): it would write a clock the
  page did not say. `+1 day` is.
- **Two of the plan's key bindings changed**: `←`/`→` navigate the grid (the plan had them nudge
  the day, which collides with arrow navigation); `[` and `]` nudge instead.
- **The proposal queue's `Day N` button is solid only for a proposal read from the page**; a
  carry is a line button, so the eye lands on what the page said.
- **`loadTimeline` reads the node list and the character records on every load** (two reads
  the first pass did not make), for the cues and the introductions. Both are reads Locations and
  Characters make per load already; nothing is stored.
- The E2E's thread drag uses Playwright's `dragTo`, which drives HTML5 drag and drop in Chromium;
  if it proves flaky on another engine the grid's drop is also reachable by keyboard.

### Verification

`pnpm exec turbo run typecheck lint --force`: 12 successful, 12 total. `@folio/script`: 546
tests (32 files) including `time-cues.test.ts` (7) and `continuity.test.ts` (15); web: 519 tests
(41 files) on Node 22.23 including `tests/timeline-view.test.ts` (25). `next build` green,
`assert-no-server-secrets` green. `0023` applied to the dev project. `e2e/timeline-route.spec.ts`
rewritten for the queue, the verdicts, the light rule, the ghost and `▲`, the sidebar drag, the
lanes, the keys, the chronology drag, the reader and the export - the walk's result is in the
pass report.

## Timeline rebuild, phase 1 - the shell and the grid (2026-09-18)

The Timeline route was the last on its pre-redesign chrome inside the v2 shell: a 250px
`ContextColumn`, its own 46px header with glyph tabs, its own 28px footer with a different
save vocabulary, a 272px inline aside for the selected scene, legacy alias tokens throughout,
and `?view=` links that re-ran the page on every tab. The client asked for the whole route
audited - "the design does not match the rest of the website, and the work it does needs
improvement" - and the audit (the plan file, "Timeline route - audit and rebuild brief"; 59
points across chrome, views, data integrity, the continuity check, interactions, the save path,
missing states, accessibility, dead code and the assistant) became a five-phase plan the client
approved. This section is phase 1. The next four are placement (a proposal queue over the
scene's own time cues, drag, keyboard), continuity (eight pure rules and `timeline_findings`
verdicts in `0023`), threads (reorder, ghost cards, presence, pacing, Markdown export) and the
assistant (facts cell, Focus, reading story time).

### Client rulings (2026-09-18)

| Question | Ruling |
| --- | --- |
| Does `Route - Timeline v2.dc.html` still bind the route | **No - the plan is the spec**, the Characters and Locations ruling applied. The README's language, tokens and patterns still apply; the mockup's vocabulary (`Place in time`, `Dim the other threads`, the lead on the Continuity view) is kept where the plan kept it |
| `Story order · Chronology · Continuity` as `?view=` or state | **Client state** (`_timeline/view-state.tsx`, the Locations shape - the route has a layout of its own); the URL stays `/timeline`; `?view=` is an unknown key, a stale link opens story order |
| How much of the plan | **All five phases, in order**, each its own pass and section |
| Where a finding's verdict lives | **A `timeline_findings` table** (migration `0023`, the `character_findings` shape) - a row only when the writer says *deliberate*; the check stays pure and unstored. Phase 3's |

### The audit, in one paragraph

The data layer was sound - two authored things, a pure order, stale thread ids dropped on read
- and the surface above it was not: `Assume continuous` wrote `story_day = 1` to every scene as
authored data indistinguishable from a typed value, so after one click the span read "1 day",
continuity "agreed everywhere" and the empty state never came back (the CLAUDE.md warning in
one button); the empty card claimed sluglines marked `CONTINUOUS` and `LATER` were respected
when nothing read a slugline; `Continue from Day N` counted from the last chronology column,
flashback days included; the scene panel reset its form on every prop change, and every write on
the route refreshed the router, so a half-typed day vanished mid-edit; `chain` wrote the unsaved
flashback flag and `Clear` silently unset it; `linkThread` stored any well-formed id without
checking the thread's project; `deleteThread` was two statements with no transaction; every
action revalidated the whole project layout; `shortSlug` cut `INT. HOUSE - KITCHEN - DAY` to
`HOUSE`; the thread picker was a native `<select>` that closed on blur before `change` in two
browsers; hidden threads only dimmed and stayed in the tab order; the grid was `div`s with no
roles; the continuity check had one rule, compared adjacent pairs only, and had no verdict but
the flashback flag; the assistant panel promised "where a thread goes quiet" and read no story
time. Phase 1 fixes the chrome, the views, the write path, the falsehoods and the interactions;
the check's depth and the assistant are phases 3 and 5.

### What was built

**Shell** - `_chrome/timeline-layout.tsx` on `locations-layout.tsx`'s pattern: the shared
`Sidebar` with four slots (`_timeline/timeline-sidebar.tsx`), `WritingHeader route="timeline"`
handed `TimelineHeaderViews` for its centre, the `folio-surface` card, and the `#timeline-drawer`
slot beside the column. `_chrome/context-column.tsx` and `CONTEXT_PANEL_WIDTH` are deleted -
every route draws the sidebar card now - and the header's and status bar's "Timeline does not
yet" notes are gone.

**Sidebar** - the project name with `+` (`New thread`, through `lib/timeline/compose.ts`'s cell,
so the title row and the group agree), `Find a scene or character` (the shared `FindField`,
narrowing the grid by ref, heading, set or a cast name), the **Threads** group - one row per
thread: the 3×22 colour bar, the name over `E1 → E3 · 6 scenes · +2 shared`, the row count in
mono; a click is a **solo** (`Dim the other threads` - every other lane drops to 40% and out of
the tab order; a second click clears); `⋯` on hover opens the inline editor (rename, recolour,
delete) - and the **Placed in time** widget (`17 / 24`, the accent bar, `7 scenes have no time
yet`). Every write here goes through the provider's one `useRun`, so a rename says `Saving…` in
the body's status bar.

**Views** - `_timeline/view-state.tsx`: `TimelineView`, `TIMELINE_VIEWS`, `TimelineStateProvider`
(the view, the selected scene, the solo thread, `byHand`, the shared `save`/`run`, and the flag
count the body publishes for the Continuity tab's badge), `useTimelineState`,
`TimelineHeaderViews`. `SUB_VIEW_SCHEMAS.timeline` is `z.object({})` and `ROUTE_VIEWS.timeline`
is `[]`; `ViewTab` gained an optional `badge` and `ViewPill` draws it (`.folio-view-pill-badge`,
`--warn-bg`) - the one addition to a shared piece.

**Toolbar** (`timeline-toolbar.tsx`, the shared `RecordToolbar`) - `Timeline`, the count chip
(`17 placed` / `4 flags`), `All episodes ▾` (a `FilterMenu`; only with more than one episode) and
the solid `Place 7 scenes on Day 3` while anything is unplaced. No `✦` on it: nothing reads the
script, so the accent is not earned; phase 2's queue takes its place.

**Lanes** (`lanes-grid.tsx`, `scene-card.tsx`) - `role="grid"` with `columnheader`, `rowheader`
and `gridcell`; `168px` then `minmax(196px, 1fr)` per column, 10px gaps, wider than the surface
and scrolling inside it; a sticky header row of column cards (`E1 · Standpipe · 104 pp · 5
placed · Day 1 → 3`; `Day 2 · 3 scenes · 4 6/8 pp`; a flashback-only day says `flashback` in
`--warn` on `--warn-bg` and tints its cells); sticky row heads. The card: the mono ref, the mark
(`↺` flashback, `⚠` finding, each with screen-reader text and the note as its title), the short
slug (the set as `readSlugline` reads it - `HOUSE - KITCHEN`), the chip that says *when* in story
order and *where on the page* in chronology, the jump arrow, the "also" dots. `aria-pressed`
while it is the drawer's; `--lane-colour` carries the thread's token to the 3px bar. All in one
`.folio-lane-*` block in `globals.css`; no legacy alias anywhere on the route.

**Drawer** (`scene-drawer.tsx`, the shared `DrawerShell`) - `Place in time`, `E1 Sc 14 · p. 36`,
`Ask` and `Open in script` in the head; the slugline and gist; `Day` and `Clock` (the clock
disabled without a day, masked `HH:MM`); the `Flashback` toggle (`.folio-status-tab`, warn); `⇅
Same day as the previous scene`; the relative block (`Same day as E1 Sc 9, 22:15 → 06:40` / `1
day after E1 Sc 9.` / `First scene in story time.` / `Flashback. Sits outside the day count.` /
the finding's note on `--warn-bg`); **Threads** as chips with `×` and a `＋` menu (`folio-menu`,
not a `<select>`); **In this scene** - the cast as pills into `/characters/:id` and the set into
`/locations/:id` (rows carry `set` now: `scene_derivations.location_id` resolved through
`readMentionLabels`, the read the loader already made); the foot: `Open in Script →` (the
heading's `#n-<node id>`), the notice, `Cancel`, `Save`. The draft is initialised once and keyed
on the scene id; `⇅` and `Clear` edit the draft and only `Save` writes; `Clear` keeps the flag.

**Continuity** (`continuity.tsx`) - the lead ("None of these are errors on their own"), one card
per `order` finding with the note, the scene it was compared with, `Open →` (the drawer, in story
order) and `Open in Script →`; the flashback count at the foot; a quiet card at zero. The first
pass's `Flashback` button on a card is gone - the flag is set in the drawer with the scene in
view.

**Empty state** (`empty-timeline.tsx`, the shared `EmptyCard`) - `Place N scenes` and `＋ By
hand`, the caveat `Placing a scene never changes its page order.`; the false slugline line is
gone. **Unplaced** - a `folio-banner` over the grid in both views (`7 scenes aren't placed in
time yet · Place them · ✕`) and, under the chronology only, a dashed strip of the unplaced
scenes' cards so one can be opened from there; in story order an unplaced scene is already in
its episode's column with a dashed `no time` chip. **Status bar** - the shared one:
`17 placed · 7 unplaced · 4 threads · 2 flashbacks` (` · E1 Sc 4` while selected), the toast,
the saved dot, `/timeline`.

**Read model** - `lib/timeline/view.ts`, pure and tested (`tests/timeline-view.test.ts`, 12
tests): `gridOf` (rows, columns, cells, a scope), `threadFigures` and `episodeFigures` (moved
off `server.ts`, where they were untested), `previousFrameScene`, `lastFrameDay` (the frame
story's - flashback days sit outside it), `findingNote`, `relativeLine`, `countsOf`,
`statusLeft`, `countChip`, `placedNote`, `matchesFind`, `shortSlug`, `chipOf`. `TimelineSceneRow`
gained `eighths` and `set`; `StoryThreadRow` gained `lanes`; `TimelineEpisodeColumn` gained
`days`. The repository selects `location_id` and `eighths` from joins it already made.

**Writes** - `deleteStoryThread` is one CTE (unlink every scene, delete the row); `linkSceneThread`
carries `exists (select 1 from story_threads where id = $1 and project_id = $tenant)` in the same
statement, so an id from elsewhere is refused where the column's missing foreign key would have
let it through; `placeUnplacedScenes` answers with the ids it placed and `unplaceScenes` is the
undo over exactly those, only where they still carry that day and no clock. Every action
revalidates `/app/project/:id/timeline`, not the project layout. `Place N scenes` counts from
`lastFrameDay`, and the status bar offers `Undo` for eight seconds.

### Judgement calls, flagged

- **`Assume continuous` retired for a carry the writer can take back.** The plan's answer to the
  authoritative-assumption trap is phase 2's proposal queue; until it exists the toolbar's
  `Place N scenes` is the same one-day write with two differences - the day is the frame story's
  last, not the last column's, and the write answers with its ids so `Undo` is exact. The
  empty card's primary is the same button, on the `EmptyCard`'s accent slot because that is the
  card's shape; phase 2's `✦` queue is the AI action the README means there.
- **The strip is under the chronology, not story order.** The plan said the reverse; in story
  order an unplaced scene is already in its episode's column, so a strip there would list every
  card twice. Under the chronology it is the only place an unplaced scene can be opened.
- **The cast are name pills, not `IdentityChip`s.** The chip needs the record's hue and the
  timeline rows carry ids and names; reading `characters.color` for a pill is a second read for
  a colour. The Characters link beside the section is the way to the faces.
- **Flash-forward is copy, not a column** (plan item 5): the flag means "outside the frame
  story" and phase 3's check derives the direction from the times.
- **Selection is state, not a path** (plan item 8): `/timeline/:sceneId` would name a scene in a
  URL and open decision 10 (`SCENE_xxx`) is exactly that question. The drawer opens by id in the
  provider, so a reload opens with none.
- **Anchors and events stay deferred** (plan item 7), as the 2026-09-12 brief left them.
- **No `loading.tsx` / `error.tsx`.** The audit listed their absence; no route in the app has
  either, and adding them to one route is a shell decision, not a Timeline one.
- **The roving tabindex and the arrow keys** are phase 2's, with drag; phase 1 gives the grid
  its roles and every mark its text.
- **Locations' E2E row.** `e2e/workspace-routes.ts` had `title: 'Locations'` beside an empty
  state whose toolbar (and `h1`) is not drawn; set to `null` with a note, since the Timeline row
  needed the same reading and the walk would have failed there first.

### Not built, by ruling or by absence

- The proposal queue over the scene's own time cues, drag to place, the keyboard model (phase 2).
- The seven further continuity rules, run-level `order`, `It's deliberate` and migration `0023`
  (phase 3); `character_findings`' shape is the model.
- Thread reorder, a scene's row as a choice, ghost cards for parallel action, thread × episode
  presence, pages-per-day ruler, `Lanes by` character or location, Markdown export, `Read
  chronologically` (phase 4).
- The assistant's facts cell, Focus kind `scene`, reading story time and threads, and `✦ Suggest
  placements` (phase 5; the last inherits open decision 13).
- `scenes.story_time` and `scenes.beats` stay as dead columns: a column drop is asked for.
- Membership, not role, on every action - unchanged and flagged again.

### Verification

`pnpm typecheck` (forced, 6 packages) and `pnpm lint` green. `tests/timeline-view.test.ts` (12),
`tests/workspace-routes.test.ts` and `tests/shell-and-state.test.ts` pass on Node 22.23 (55
tests). `e2e/timeline-route.spec.ts` rewritten (five tests: the shell and the empty state, placing
and its undo with the tabs switching without the URL moving, a finding and the flashback flag, threads
made / linked / solo'd / renamed / deleted with a half-typed day surviving a write, reload / scope /
chronology); `e2e/workspace-routes.ts` and `workspace.spec.ts` updated for the card column, the
three tabs and the stale `?view=`. The walk's result is in the pass report.

## Locations rebuild - the script's evidence first (2026-09-18)

The Locations route rebuilt end to end, four phases in one pass, to a written plan rather than
the v2 mockup - the client's ruling, as for Characters. The audit that preceded it (the plan
file, "Locations route - audit and rebuild plan") found the Characters diagnosis again: the data
layer was right (the tree, the roll-ups, the alias table, the queue, the rename with snapshots,
merge with tombstones) and the UI left it dark. Verified against the tree before a line changed:
`peopleAt` defaulted to three so the drawer's `Who's here` listed three; `lastSeen`, `own` and
the queue proposal's `confidence` were loaded and never drawn; `scheduled_days` and
`rollup_shooting_days` were stored and shown nowhere; research clips filed to a place were never
read; `sceneHref` had zero callers under `_locations/` - nothing on the route linked into the
script; the card was an `<article onClick>`; the queue banner was dismissible with no undo and a
native `<select>`; the sheet had no sort, scope, totals or CSV; a sub-set's scene printed twice.

### Client rulings (2026-09-18)

| Question | Ruling |
| --- | --- |
| How far past the script does the route go for the filmmaker | **Surface what exists.** Status, address, one photo and shooting days (`scheduled_days`, already a column); CSV per set and for the sheet. No new table, no scouting layer, not writer-only |
| Does `Route - Locations v2.dc.html` still bind the route | **No - the plan is the spec**, the Characters ruling applied. The README's language, tokens and patterns still apply |
| `Places · Scenes here · Sheet` as `?view=` or state | **Client state** (`_locations/view-state.tsx`, the Characters shape - the route has a layout of its own); the URL stays `/locations`; `?view=` is an unknown key, a stale link opens the places |
| May the assistant read the location records on `/locations` | **Yes, records + Focus.** The panel sends `scope: 'project'` and `places: true`; the open drawer's record is the Focus block; two chips are client-side reports |

### Nothing is stored that can be computed - so no migration

The plan reserved an additive migration for the establishing line, the quadrant and the last
scene. AGENTS.md's exception table makes storing the exception, not the rule, and every one of
these is a reading over rows the loader already has: the establishing line over the project's
node list (`readProjectScreenplayNodes` - the read the Script route makes on every load), the
quadrant over the scene index's `ie` and `light`, the last scene over the same order the first
came from, the similar-set pairs over the records and their bound set texts. So they live in a
new pure module, `packages/script/src/sets.ts` (`matchSetNames`, `similarSets`,
`establishingLines`, `quadrantOf`, `addQuadrants`; 11 tests), and are computed in
`lib/locations/server.ts` at request time. `derive.ts`, `entities.ts`, `schema/derived.ts` and
`contracts/derived.ts` are untouched - which also kept this pass out of the four files the
concurrent Characters session was editing. A later pass that wants to cache one of them stores
what these return.

### What was built

**Core** - `packages/script/src/sets.ts`, exported from the index. `INT` is interior; `EXT`,
`INT/EXT` and `EST` count as exterior (an I/E scene and an establishing shot both need the
outside); a heading with no `DAY`/`NIGHT` is `unlit`, in neither box. `similarSets` keeps
`certain | likely` only and never pairs a sub-set with its own parent.

**Contract** (`packages/contracts/src/locations.ts`, additive) - `LocationSceneRow` + `ie`,
`storyDay`, `storyClock`, `flashback`; `LocationRow` + `scheduledDays`, `bound` (each set text
with provenance, count and first heading), `intro`, `quadrant`, `rollupQuadrant`, `clips`,
`similar`; `people` uncapped; `SluglineResolveProposal.reason`; `SluglineResolveItem.candidates`;
`LocationEditSchema.scheduledDays`.

**Repositories** - `listBoundSluglines` selects `bound_by`; `listSceneStoryTime` (the Timeline's
`0011` columns, read by the route at last); `moveBoundSlugline` (one CTE on `moveBoundCue`'s
pattern); `deleteBlankLocation` (the `New location` undo - a minted record is present the moment
the heading resolves to it, so `deleteAbsentLocation` would refuse); `updateLocationRecord` takes
`scheduledDays`; `listClipsFiledToLocations` in `research.ts` (the reverse read its header
promised).

**Loader** (`lib/locations/server.ts`) - twelve statements once for every row; ranks every open
slugline against the records with `matchSetNames` (the reason chip, the menu's candidates);
hides similar-set pairs the writer rejected (`resolve_decisions` under `set:<a>:<b>`, a key no
pass writes); the establishing line is the set's own first, else the earliest under a sub-set.

**Actions** - `renameLocation` returns the undo (every rewritten heading's two readings);
`previewRename` (the confirm's numbers); `undoRename` (puts back only headings still reading
what the rename left; the record's old name and set text first; refused as `taken` when the old
set text was rebound meanwhile); `moveAlias`; `revokeDecision` (`bound` unbinds, `new-record`
deletes the blank record or unbinds, `attached` clears the edge and deletes a blank minted parent,
`not-inside` deletes the rejection); `decideSimilar` (merge, or "they're different").

**Views** - `Places`: the queue first while it has rows (non-dismissible, reason chip,
confidence-weighted buttons, a `.folio-menu` with the candidates and their reasons, toast +
`Undo`), then content-first cards on `.folio-record-card`: 28px thumbnail or hue mark (the 16:10
tile is gone), status dot, the name as the stretched link, `INT · 4 D · 5 N`, the establishing
line or the description, the `Inside` strip of sub-sets (each a link) on a primary set, the
conflict block, the presence strip, the foot with the linked span and `+N` on the cast. **A
sub-set is drawn inside its parent's card and gets no card of its own** (reachable from the strip,
the sidebar and the sheet). `Scenes here`: one section per primary set, its sub-sets' scenes
listed once with the sub-set named on the row; the head carries the quadrant, the pages and the
days; rows link into the script and print `INT`/`EXT`, the time of day as text, the story day;
`CSV` per set. `Sheet`: sortable (`aria-sort`), episode scope, `Days` (roll-up), `Cast`, `First`
/ `Last` as linked chips, a totals row over the primary sets, `Export CSV`.

**Drawer** - evidence first, on the Characters order: linked meta, `Ask`, `Open in script`; the
name; `On the page` (the establishing line quoted, its ref linked, `Use as description` into the
unsaved field); `Presence` (the strip, `first · last`, the longest gap of five or more);
`Sluglines here` as the alias table (`slugline-table.tsx`: each set text linked to its first
heading, `name` pill, provenance `derived | you | member`, count, `×`, `+ bind a set text`, a taken
set text as a conflict block with `Move it here`); `Scenes` by episode with the quadrant and `+ N
more`; `Who's here` - everyone; `Inside` (sub-sets with counts and days, `+ Add a sub-set`
inline, `Part of`); `Research` (clips filed here, each a link to its source); `Same place?`
(similar records as conflict blocks: `Merge into …` / `They're different`). Last, the
**Production** fold (`<details open>`): status, address, shooting days with the roll-up printed
beside it, description, photo (thumbnail, Upload / Replace / Remove). Foot: `In N scenes · Merge
into…` on a present record, `Delete` on an absent one; the rename confirm (`rename-confirm.tsx`)
fed by `previewRename`, listing the set texts that stay; after a rename the toast carries `Undo`.

**Sidebar** - `Needs a decision` (amber, the open set texts; a click unfolds the queue) ·
`Primary set` (sub-sets indented) · `Recurring` · `One-off` · `Not on the page yet`; rows print
`INT · 4 D · 5 N` and `9 sc`; the foot is `CountsWidget` with `Needs a decision · N` (a button
when > 0) and `Scouted · 4 of 6`. The find field narrows the body too.

**Shared** - `PresenceStrip` in `@folio/ui` (built here; the Characters session's card and
Presence view consume it - states `full | half | none`, the picture's words, each route maps its
own; `PRESENCE_STRIP_LIMIT` per size). The Scenes detail's `Set` field links to
`/locations/:id`. The assistant: `AskFocusSchema` is a union (`character | location`),
`AskInputSchema.places`, `LocationFocusInput` + `PlaceInput` in `lib/assistant/context.ts`,
`placesOf` in `lib/assistant/server.ts`; the panel's `Describe {name} from its scenes`, and two
reports over `lib/locations/facts.ts` - `Find locations used only once`, `Which sets have night
exteriors?` - answered without a model.

### Judgement calls, flagged

- **The find field narrows the body as well as the sidebar.** The v2 pass narrowed the sidebar
  only, which read as a bug in the audit; Characters still narrows its sidebar alone.
- **The sheet's totals are over the primary sets** so a sub-set's scene counts once; a sub-set
  whose parent the filter hid counts for itself.
- **`INT/EXT` and `EST` count as exterior in the quadrant.** A breakdown that wants them apart
  reads the scene rows, which keep the heading's own `ie`.
- **The `data-card-cast` attribute now counts everyone** at the set (the card draws three and
  `+N`); the E2E reads it as a count.
- **`hueOf` stays for the sheet's mark and the thumbnail's stand-in** - 22-32px, never a tile.
- **The assistant's Focus on `/locations` is the same ephemeral cell** the Characters drawer
  publishes into; the panel checks the kind against the route so a stale character focus never
  rides a locations turn.
- **`revokeDecision` on `attached` deletes a minted parent only when it is blank**
  (`deleteBlankLocation`); a parent the writer has written on stays as a primary set.

### Not built, by ruling or by absence

- A scouting layer (notes, contact, candidates, several photos) - ruled out.
- A PDF location report; a map. CSV per set and for the sheet only.
- The Timeline's scene panel linking to a location - the Timeline is still on its pre-redesign
  chrome and its rows carry no location id; left for its pass.
- "Fix the spelling" across the script - a third write-back; escalated.

### Verification

- `pnpm --filter @folio/script exec vitest run` - 30 files, 532 tests (11 new in `sets.test.ts`).
- `vitest run --environment node tests/locations-view.test.ts tests/locations-figures.test.ts
  tests/locations-sheet.test.ts tests/workspace-routes.test.ts` in `apps/web` - 63 pass (new:
  `locations-sheet.test.ts`, 9; `locations-view.test.ts` +7).
- `tsc --noEmit` in `apps/web` clean outside the concurrent session's in-flight `_characters/`
  files; `@folio/contracts`, `@folio/db`, `@folio/ui` typecheck clean. `eslint` over every file
  this pass touched - clean.
- `e2e/locations-route.spec.ts` rewritten to the new contract (`data-card-{link,line,inside,
  sub,span}`, `data-unmatched-{reason,key}`, `data-status-{toast,undo}`, `data-alias-*`,
  `data-drawer-{intro,span,gap,quadrant,scenes,subsets,subset,merge,production,ask,open-script}`,
  `data-scenes-{quadrant,days,export}`, `data-scene-{at,ie,time,story}`, `data-sheet-{export,
  totals}`, `data-sort`, `data-days-rollup`, `data-decisions-total`, `data-locations-widget`) and
  **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` here. A browser check of the three views in both
  themes, a queue decision and its undo, the rename and its undo, and the CSV downloads is the
  next thing a human should do.

---

## Characters rebuild, phase 4 - the model, one action at a time (2026-09-18)

The last of the four phases (the plan, "Characters rebuild, phase 1" below). The assistant reads
the whole project on `/characters` and knows which record is open; the drawer gains two model
actions that write nothing to the script and land only where the writer can see and undo them.
Built in the same pass as phases 2 and 3 on the client's word ("build the entire character route
at once"); the three sections are kept apart so each phase's rulings and flags stay findable.

### Rulings taken

- **The assistant reads the whole project on `/characters`, with a Focus block for the open
  record** (the client, 2026-09-17). `AskInputSchema` (`@folio/contracts`) gains `scope:
  episode | project` and `focus: { kind: 'character', id }`; `lib/assistant/context.ts` renders
  every episode under `[Episode N · Title]` markers with `[E2 Sc 9]` headers, water-filling the
  400k cap across the episodes and saying which it cut; `focusBlock` is the record as the drawer
  shows it, sent as a second, uncached system block so the cacheable prefix stays stable. The panel
  sends project scope on `/characters` **only** - the widening is per route (Locations, Timeline,
  Research still read one episode) - and `data-assistant-scope` / `data-assistant-focus` say so.
  The subhead reads `Reading all 3 episodes.`
- **Model actions carry no price and write no ledger row** - the send button's standing, open
  decision 13 stays open (the bullet above). A rate limiter belongs with that decision and is not
  built.
- **Model prose lands only in unsaved fields.** `draftField` returns text and citations and
  writes nothing; the drawer puts it in the field with `drafted from E1 Sc 4 · not saved`, and
  the existing Save keeps it or Cancel drops it. **Cite or drop**: a draft naming no scene it was
  shown is refused as `Nothing on the page to draft from.`
- **Findings are rows, not a bible.** `character_findings` (migration `0022`, AUTHORED on the
  assistant's word and the writer's verdict): kind `contradiction`, status `open | deliberate`,
  the two heading node ids stored sorted with no key, the two quotes, the claim, and the claim's
  FNV-1a as a plain column so the dedupe index has a target. `replaceOpenFindings` is one CTE -
  delete the open rows a re-check did not reproduce, insert the new set `on conflict do nothing`
  - so a deliberate verdict blocks its own re-insert. AGENTS.md's storage exception table gains
  the row. A finding whose quotes are not on the page (after NFC + straight quotes + one space)
  is dropped and counted: `Checked 52 of 79 scenes · 2 findings · 1 dropped: it did not quote the
  page`.
- **Off the page, no model call.** `draftField` and `checkContradictions` refuse a record with
  no scenes before the SDK is touched, and the buttons say why they are disabled.

### Built

- `lib/assistant/model.ts`: `EVIDENCE_CHAR_CAP`, `DRAFT_MAX_TOKENS`, `CHECK_MAX_TOKENS`,
  `MODEL_ACTION_TIMEOUT_MS`, `FINDINGS_MAX`, `DRAFT_MAX_CHARS`. `lib/assistant/server.ts`
  exports `assistantClient()` - the one door to the SDK; the key never leaves the file.
- `lib/characters/evidence.ts` (pure, tested): `evidenceFor` (whole scenes, script order, a
  visible cut line), `validateDraft`, `validateFindings`, `normaliseForMatch`, `claimHash`.
- `lib/characters/model-actions.ts` (`'use server'`): `draftField`, `checkContradictions`,
  `setFindingVerdict` - `messages.parse` with `zodOutputFormat`, `maxRetries: 1`, every model
  failure a sentence in the writer's terms. No `revalidatePath`: the drawer holds the draft and
  the findings as state, and a refresh under an unsaved draft would race it.
- `packages/db`: `readProjectScreenplayByEpisode`, `listCharacterFindings`, `replaceOpenFindings`,
  `setFindingStatus`.
- The drawer: `✦ Draft from the script` under Description, Wants and Needs (`profile-fields.tsx`,
  `draftFrom`), `Continuity` as the last section (`continuity-section.tsx`), the assistant Focus
  published on mount (`lib/state/ephemeral.tsx`, `assistantFocus`).
- `CitedBody` in the panel turns `E2 Sc 9` into a linked chip alongside `Scene 9`.

### Not built, flagged

- A connected walk: `ANTHROPIC_API_KEY` is not set here, so the two buttons were exercised only
  in their disabled state and the code path against the SDK's types. Runtime checks still to make
  on a connected server: structured outputs on `claude-opus-5` (if a 400 names
  `output_config.format`, fall back to `thinking: { type: 'disabled' }`); a platform proxy timeout
  under 90s.
- The E2E's connected test (`E2E_ASSISTANT=1`) is not written; the disconnected assertions are.

---

## Characters rebuild, phase 3 - the script speaks (2026-09-18)

The core computes what a writer recognises a character by, and the route quotes the page.
Migration `0021`.

### Rulings taken

- **The voice is derived, on the derivation row.** `CharacterRecord` gains `words`, `speeches`,
  `parens`, `namedIn`, `firstLine`, `lastLine`, `longest`, `sceneCounts`, `exchanges`,
  `introducedAt`; `SceneRecord` and `CueTally` gain `words`. All of it arithmetic over the node
  list in `scanNodes`, rebuilt every pass, and `assertExact` in `@folio/contracts` held the split
  to it. The four positions are **JSON `{ nodeId, scene }`** rather than the plan's bare uuid
  columns: the loader needs the scene to cite a line and re-walking the project to find it is the
  cost the plan wanted to avoid. Flagged as the one deviation from the plan's column list.
  `scene_counts` and `exchanges` are JSON lists on the row, not tables (the plan's reasoning).
- **A word is a whitespace-split token; a mention run is one word** - `dialogueWords`, the same
  reading `outlineWordCount` takes. **The longest line is the longest dialogue node**, not the
  longest speech across parentheticals - it is what the drawer quotes, and quoting the first node
  of a three-node speech would misdescribe it. Flagged.
- **An exchange is two different cues in a row under one heading**; action between them does not
  break it, a heading does; an unresolved cue exchanges with nobody; two spellings of one record
  are not a conversation.
- **Introductions read action nodes only, whole tokens, case as written.** A Fountain-typed CAPS
  intro on its own line is a cue and lands in the queue, never here - the drawer says so. `DAY` or
  `MILL` bound as a name will match an action line that uses the word; the test names the false
  positive and accepts it, because the cost is a wrong quote the writer can see, never a wrong
  binding. Open decision 3 is untouched.
- **Rename undo is an inverse rewrite by node id** (`revertCueRewrites`), behind its own
  `before_rename` snapshot, skipping and counting a cue edited since - never
  `renameCharacterCues(to, from)`, which would also rewrite a cue that carried the new spelling
  before. The offer lives in the status bar's toast for the route's lifetime
  (`lib/characters/undo.ts`); `taken` (someone bound the old spelling meanwhile) is refused with
  the merge named.
- **Two records that read as one person** (`similarRecords`: every key of one against every key
  of the other, `certain` / `likely` only) are a row of the queue - `MEERA PAWAR reads like Meera
  - two records.` - with `Merge into <keep>` and `They're different people`. The rejection is a
  `record:<a>:<b>` row in `resolve_decisions` under a plain-text key, as is `intro:<id>:<node>`
  for a waved-through "speaks before introduced"; a pass never sees either key
  (`recordDecisionByKey`). The sidebar's `Needs a decision` counts pairs; the rail badge stays
  rows-only. Flagged.
- **`characters.origin`** (`derived | hand | mention | agent`) is written once at creation and
  never backfilled - records made before `0021` print no origin.
- **The Script editor's touch is read-only decoration** (Script chrome, flagged as separable):
  every cue block carries `data-character-id` / `data-cue-name` / `data-cue-scenes` or
  `data-cue-unresolved` from a cue book `loadScript` reads once (`draft.cues`); `Colour cues` in
  the actions menu (`lib/state/session.ts`, per tab) sets `--cue` to the record's colour; a
  hover card (`_script/floating/cue-card.tsx`) says who a cue is with `Open`, or `No record yet ·
  Resolve on Characters →`. No node attribute, no text change. The book is read per load: a
  record a save mints shows its identity on the next load - flagged, cheap to change.

### Built

- Core: `derive.ts` (the voice scan, `similarRecords`, `dialogueWords`), `introductions.ts`,
  `sides.ts`, `rename.ts` (`CueRewrite.before`, `revertCueRewrites`); tests `derive-voice`,
  `introductions`, `sides`, the rename round trip, and three properties (per-scene lines never
  exceed the total, a first line exists exactly when lines do, exchanges are symmetric).
- `0021_characters_voice.sql` - applied to the dev project with `0022` in one `db:migrate` run
  (drizzle-kit applies every pending entry; both were pending, so "one run each" was not
  available).
- Loader: the first line and the introduction of every record read by id
  (`readScreenplayNodesById`, one query), `pairs`, the intro verdicts; the profile's `voice` and
  `talksTo`. Actions: `undoRename`, `decidePair`, `dismissIntroFinding`, `readSides`.
- The drawer: the stats row (`412 lines · 3,180 words · 14% of dialogue · 3 V.O.`), `Voice`
  (`voice-section.tsx`, `All N lines →` opens `sides-modal.tsx` on the Script route's static
  sheet), `Introduced` (`intro-section.tsx`, `Use this as the description`, the age hint under
  Age, the timing finding as a conflict block with no accept), `Talks to · Anil 40 · Kadam 12`,
  the origin in the meta. The card's quote slot: description, else the first line in quotes, else
  the introduction under a `from the script` eyebrow. The sheet's `Words`, `Share` (a 40×4 bar),
  `Intro`, `Eighths` columns and the `Balance` card (`E1 · Meera 62% of 1,240 words · 6 voices`).
  The Presence view's `silent-pair` finding.
- `thousands()` in `lib/workspace/format.ts` - no `Intl`, the same string in every locale.

---

## Characters rebuild, phase 2 - the shape (2026-09-18)

The content-first card, the presence strip everywhere, the drawer reordered around the script's
evidence, the Presence view in place of the graph, and the dead code out. No migration.

### Rulings taken

- **The Relationships graph is gone, replaced by a Presence view** (the client, 2026-09-17):
  a character × scene grid by episode (`.folio-presence-grid`, 12px cells - filled speaks, hollow
  mentioned, faint absent - sticky episode row and name column), a hover line, `Pairs` (every two
  characters who share a scene, a bar scaled to the strongest, the scenes as linked chips), and
  the finding cards. `relationships-view.tsx`, `graphEdges`, `graphLayout`, `edgeWidth`,
  `.folio-cast-ground`, `.folio-cast-node` and the `--dot` token are deleted; `neverShare` stays
  for the finding card and the panel's report chip. Views are `cast | presence | sheet`, still
  client state.
- **The card is content-first.** The 4:5 face, the scrim and the status badge went with the
  mockup; the card is the name over the role with a 6px status dot (and a 28px thumbnail when
  there is a portrait), the alias line (`MEERA 79 · MEERA (V.O.) 3 · + 2 more`), a quote slot, the
  conflict block, the presence strip, and a foot of `52 speaks · 27 mentioned · 412 lines` with
  the span as linked chips. The whole card is one stretched link (`.folio-record-link`), so a
  middle-click and Space are the browser's; the conflict block sits above it (`[data-raised]`).
- **The strip is one component** - `@folio/ui`'s `PresenceStrip`, written by the concurrent
  Locations session in the same hour with three picture-named states (`full | half | none`) and
  `PRESENCE_STRIP_LIMIT`; this route maps `speaks | mentioned | absent` onto them
  (`cellStateOf`) and falls back to `EpisodeBars` past 96 scenes on a card, 240 in the drawer,
  80 in the sheet. `IdentityChip` gains `shape="square"` for the grid and the drawer's relations.
- **`SceneFacts` is a subtype of `SceneRef`**, never a widening of it: the reading, the set (by
  name, through the location records), speaking and mentioned (as stored - derivation writes them
  disjoint), the measured eighths, the dialogue words. `SceneIndexRow` gains `words` and
  `mentioned`; Locations and Research construct `SceneRef` as before. `CastRow.cues` is required,
  so Production's loader now reads `listCueTallies` for its cast rows too.
- **The drawer is derived first, authored in a fold**: Name and the stats · In the script as ·
  Voice · Introduced · Presence (the strip, `first · last`, `longest gap · 11 scenes · E2 Sc 3 →
  E2 Sc 13`, threshold 5) · Scenes (per episode with a sticky eyebrow `E1 · 28 scenes · 41 2/8`,
  rows `Sc 4 · INT · D · set → Locations · presence · 2/8`, eight then `+ N more`) · Shares scenes
  with (`Presence →`) · Sets (→ Locations, `21 sc · 12 D · 9 N`) · a `Notes` fold (`<details
  open>`) holding the profile fields, the status and the reference image · Continuity. The Arc
  list and the 78×98 tile are gone; `DrawerShell` gains `lead` for the 32px thumbnail.
- **The sheet** trades `Scenes` for `Speaks` and `Mentioned`, gains a `Presence` column, and
  scopes the share against every dialogue word under the chosen episode's headings.
- **Dead code out**: `definedOf`, the `Defined` widget, `CastMark`'s `face`, `.folio-cast-face`,
  `--cast-l3` / `--cast-c3` / `--cast-face-ink`. `.folio-cast-row` is `.folio-record-row` in both
  routes' sidebars; `.folio-cast-card` / `.folio-cast-badge` / `.folio-cast-mark` stay for the
  Locations grid until its pass.

### Verification, all three phases

`pnpm typecheck` 6/6 · `pnpm lint` 7/7 · `@folio/script` 30 files / 532 tests · web 40 files /
494 tests (Node 22.23, `--pool=threads`) · `pnpm build` compiled · `db:check` clean · `0021` and
`0022` applied. The E2E (`e2e/characters-route.spec.ts`) is rewritten to the new contract
(`data-presence-*`, `data-card-cues`, `data-scene-row`, `data-drawer-{strip,span,scenes,sets,
notes,stats}`, `data-voice-*`, `data-sides-*`, `data-pair-*`, `data-draft-*`,
`data-check-contradictions`, `data-assistant-{scope,focus}`; `data-graph-node`, `data-edge-label`,
`data-defined-*`, `data-arc`, `data-card-face` retired) and **not run** - no `E2E_EMAIL` /
`E2E_PASSWORD` here. The concurrent Locations session was mid-pass on `_locations/*`,
`lib/locations/*` and `lib/assistant/{server,context}.ts` throughout; its files were re-read
before every shared edit and are not this pass's.

---

## Characters rebuild, phase 1 - the identity layer gets a surface (2026-09-17)

The client's verdict on the v2 Characters route (phase 5, 2026-09-16): too close to laper.ai,
visually weak, not useful enough - "redesigning or recreating the entire route from scratch if
needed". A 25-agent audit (six read-only mappers, six lenses, two refuters per lens, one
synthesis) found why three builds had not improved it: every pass replaced the pixels and left
the identity layer dark. `mergeCharacters`, `bindAlias` and `unbindAlias` had no caller in the
UI; `CharacterProfile.cues` and `boundCues` were loaded into every drawer and drawn nowhere;
`proposal.confidence` was never drawn; `resolve_decisions` had insert and select and no delete;
`createMentionTarget` inserted a bare row with no bound cue while `createCharacter` bound one, so
an `@`-made record's own cue landed in the queue proposing it - the duplicate factory. The plan
that came out of the audit is four phases; this is the first.

### Rulings taken (the client, 2026-09-17)

| Question | Ruling |
| --- | --- |
| Does `Route - Characters v2.dc.html` still bind this route? | **No. The rebuild plan is the spec**; no new mockup. The mockup stays in the package as history. AGENTS.md, UI fidelity, carries the exception |
| Scope | **All four phases**: identity surface and fixes (this pass); the shape (content-first card, presence strip, drawer reordered, Presence view); the script speaks (words, voice, introductions, exchanges, near-duplicate records, rename undo, migration `0021`); the model (`Draft from the script`, `Check for contradictions`, migration `0022`) |
| The Relationships tab | **Replaced by a Presence view** in phase 2 - a character × scene grid by episode with the pairs list and findings beneath; the force graph, its ground and SVG go. `cast \| presence \| sheet`, still client state |
| What the assistant reads on `/characters` | **The whole project**, every episode with `[Episode N]` markers, and a Focus block for the open drawer's record - phase 4. This pass only says which episode it reads today |

### Assumptions this pass took (flagged; the plan lists them for the client)

- The sidebar foot widget is `Needs a decision · N` / `On the page · N of M` on Characters
  only; Locations and Research keep `ProgressWidget`. The mockup's `Defined N / M` filled with
  accent blue - the README reserves accent for links, selection and AI - over a status the writer
  sets by clicking; it went.
- The status bar's route id is `characters/3f2a9c1e`, the record's first eight characters;
  Locations and Research still print the whole UUID.
- `short` is the full name until a short name is authored: `shortName` gave `Suresh` for
  `Suresh Kadam` and `Kadam's` for `Kadam's man`, and the mockup's `Kadam` is recoverable by no
  rule.
- `Off the page` is the group's name and `0 scenes` the card's count; `Not on the page yet` stays
  the citation line's phrase (README, "Empty meta": a count that reaches zero prints the zero).
- The queue is never dismissed while it has rows (the mockup's `✕` and `Review` go); past five
  rows it folds to five with `Show all N`.
- `Rename Meera → MIRA` from a queue row is the sanctioned record-level rename to the cue's
  spelling, behind the same confirm - not a third write-back. "Fix the spelling" (rewrite `MIRA`
  cues to `MEERA`) and "rename the record only" are escalated, not built.
- The `@`-mention backfill is a read-side heal on the next derive per project
  (`lib/characters/heal.ts`), not a script and not a data migration: there is no script runner in
  the repo, a cross-project listing is an unscoped read, and a migration that writes rows is a
  decision. The same gap exists for `@`-made locations' sluglines and is left alone.
- `Undo` on a `New character` decision deletes the minted record only while it is blank
  (`deleteBlankCharacter`: no profile field, no portrait, `draft`, at most one binding);
  otherwise it unbinds and the cue proposes the record.
- Provenance on an alias row reads `derived` (`bound_by` null), `you` (the signed-in writer) or
  `member`. A record's own origin (minted / by hand / from a mention) needs a column - phase 3.
- `Create a new character instead` saves the other edited fields to the current record first, then
  creates the new one under the typed name with the least-used colour, then navigates to it.
- The `Someone else…` menu lists the three best-ranked records first (`matchCharacterNames`
  over the cast and its bound cues), a hairline, the rest of the cast, a hairline, `+ New
  character`.
- The sheet's `Lines` in an episode scope prints the run's total with the header `Lines · all`;
  per-episode line counts arrive with phase 3's core. Per-episode columns hide in a scoped view.
- `Reading Episode N.` prefixes the assistant subhead on `/characters` and `/locations` - the
  same shell prop, the same one-episode read behind a project-wide route.
- Colour swatches are Tab-focusable radios without arrow-key roving.
- The drawer still first-paints on the client (a portal into the layout's slot); full SSR needs a
  parallel-route slot, an ask-first route change.
- `.folio-cast-*` → `.folio-record-*` and every `globals.css` / token edit wait for phase 2; this
  pass is Tailwind utilities and inline styles only, so it never touches the concurrent
  session's files.
- The Relationships view stays this pass with the filter applied to it; phase 2 replaces it.

### What was built

**Core** (`packages/script`, additive, behaviour unchanged) - `MatchReason` beside
`Confidence` (`entities.ts`): `exact | leading {shorter} | contains {inner} | edits {distance}`;
`scoreMatch` (`alias.ts`) is `compare` carrying the branch it took, and `compare` delegates;
`scoreCandidates` keeps the best reason; `CharacterMatch.reason`; `CharacterNamePool` and
`matchCharacterNames` rank a cue against `{ id, name, boundCues }` rows so the loader can rank
without a derivation read, and `matchCharacters` delegates. Tests: `alias.test.ts` (new),
`derive.test.ts` (the resolve-queue describe), `rename.test.ts` (the `matchCharacters` shape).

**Contracts** - `CastRow.appearance` (Production's cast column prints it); `CueVariantRow.key`;
`AliasProvenance`, `BoundCueView`, `CharacterProfile.bound`; `ResolveProposal.reason`,
`ResolveCandidate`, `ResolveItem.candidates`; the `ResolveItem` comment no longer describes ghost
cards.

**Repositories** - `listBoundCues` selects `bound_by`; `moveBoundCue` (one CTE: unbind there,
bind here - between two statements the spelling would be bound nowhere), `splitBoundCue` (one
CTE: unbind, insert the record, bind), `deleteBlankCharacter`; `deleteResolveDecisions` - the one
delete on `resolve_decisions`, because the insert is `onConflictDoNothing` on `(project, row_key,
target_key)` with no verdict in the key, so deciding the opposite way was a silent no-op;
`createMentionTarget(scope, entity, name, cue)` inserts the character and its bound cue in one
statement; `persistMintedRecords(scope, minted, healed)` takes the heal's rows into the insert it
already issues.

**Actions** (`lib/characters/actions.ts`) - `previewRename` (a pure read: cues per episode, the
bound spellings that stay, whether the new spelling is taken), `moveAlias`, `splitOff`,
`revokeDecision` (walk-on · not-this · bound · new-record); `renameCharacter` and `bindAlias`
return `taken` as a result rather than a refusal string, so the drawer can offer the merge; the
header's ghost-card wording is gone. `lib/script/actions.ts`'s `createMention` passes the cue;
`lib/script/server.ts`'s `rederiveProject` and `deriveSpeculatively` apply `healNameCues`.

**Loaders and figures** - `loadCharacters` reads `listBoundCues` too, ranks every open row's
candidates (top three), sets the proposal's `reason`, and passes proposal-less rows through as
`walkOns`; `loadProfile` fills `bound` with provenance and `cues[].key`. `lib/characters/cast.ts`:
`reasonLabel`, `aliasRowsOf`, `leastUsedColor` (moved from the New drawer), `routeIdOf`,
`onPageOf`, `QUEUE_FOLD`; `sceneLabel(0)` is `0 scenes`; `shortName` is gone. `figures.ts`:
`subMap` (the filter applied to the map), `citeOf` (a scene ref as `{ label, href }`).
`sheet.ts` (new): `sortFigures`, `defaultDirection`, `scopeOf`, `csvOf`. `heal.ts` (new).
`facts.ts` (new): the cell the workspace publishes for the assistant panel. `compose.ts` gains
`queueIntent` and `drawerIntent` cells. `lib/workspace/hrefs.ts`: `ScenePath`, `sceneHref` - the
episode script and the `#n-<node id>` fragment AGENTS.md names; never `?selected=`.

**Shared chrome** (additive; Locations, Research, Production compile and render unchanged) -
`citation-chips.tsx` takes `string | { label, href }` and draws a `<Link>` for the second;
`conflict-block.tsx` makes `accept` optional, takes a `deliberate` label, and `preventDefault`s
both clicks; `drawer-shell.tsx` `meta: ReactNode` and an `actions` slot; `status-bar.tsx` a
`toast` slot (`data-status-toast`, `data-status-undo`); `record-sidebar.tsx` `CountsWidget`.
`project-shell.tsx` / `layout.tsx` hand the panel the read episode's label.

**Body** - `cast-sidebar.tsx` rewritten on the shared parts: `Needs a decision` (amber dot, mono
cue, `N cues`; a row opens the queue) · `Principal` · `Supporting` · `Off the page` (a 6px status
dot, name over role, `N sc`; an off-page row shows a ghost `×` on hover that opens the drawer on
its delete confirm) · `Walk-ons` (collapsed); `CastFootWidget`. `characters-layout.tsx` on
`FindProvider`, quiet when the route is empty; the New drawer moved to the workspace's one slot.
`characters-toolbar.tsx` on `RecordToolbar` / `FilterMenu` / `NewButton` (`+ New`, ASCII), the
chip `3 of 8` while filtered, `No description` as a filter. `characters-workspace.tsx` on
`useRun`, `useToast`, one `shown` for every view, publishes the facts cell, no toolbar while
empty. `cast-view.tsx`: queue → walk-ons line → grid; the dashed tile gone; an empty filter is
one line with `Show all`; every decision a toast with `Undo`. `unmatched-queue.tsx` reshaped:
never dismissed, folds past five, a reason chip per row, `This is <name>` solid for
certain/likely and `Maybe <name>` as a line button for possible, `Someone else…` as a
`.folio-menu` with the ranked records first, `or rename <Name> → <CUE>` under a record proposal
opening the rename confirm with its preview. `walk-ons-line.tsx` (new). `character-card.tsx`:
linked chips, `0 scenes`, the full name, decisions reported to the toast - the geometry waits
for phase 2. `sheet-view.tsx` rewritten: `All episodes ▾`, `Export CSV` (a Blob, no
dependency), sortable eyebrow headers with `aria-sort`, rows as `<Link>`s, status as a dot,
per-episode columns, linked First/Last, a totals row. `alias-table.tsx` (new): `In the script
as` with variants, the `name` pill, provenance, `Split off`, `×`, `+ add a spelling`, and the
`taken` conflict block (`Move it here` / `Merge into <name>` / `Keep it there`).
`rename-confirm.tsx` (new): `Counting cues…`, `Rename everywhere? N cues in the script will read
X: E1 28 · E2 24`, the spellings that stay, `Keep the name` / `Create a new character instead` /
`Rename`, or the `taken` block. `character-drawer.tsx`: linked meta chips, `Ask` and `Open in
script` in the head, the alias table after the fields, `Arc` rows as links, the foot's `In N
scenes · Merge into…` (picker + amber confirm) on an on-page record and a live `Delete` off it,
the rename preview, the delete intent from the sidebar. `profile-fields.tsx`: Gender, Appearance,
the ten colour swatches on `--chip-N`, the shared `StatusTabs`. `new-character-drawer.tsx`
through `run`. `use-toast.ts` (new). `_script/script-workspace.tsx`: `landOnHash` scrolls to
and tints the `#n-<id>` block after Tiptap paints. `_chrome/assistant-panel.tsx`: chips typed
`ask | report`, the first Characters chip names the open record, report chips print a
`report · no model` note from the facts cell (works disconnected), `Reading Episode N.`,
`Scene N` in an answer becomes an `E1 Sc N` chip linked on `/characters`.

**Inbound links** - Scenes (`CastChip href`, the index's `@name`, the detail's `Resolve them on
Characters` as a link that unfolds the queue), Timeline (`Present` chips), Production (cast rows,
which also print `appearance`), Locations (`Who's here` rows, `CastStack` avatars via `hrefOf`),
Research (a character filing chip).

### Verification

- `pnpm typecheck` - 6 of 6. `pnpm lint` - 7 of 7 clean. `pnpm build` - compiled.
- `pnpm --filter @folio/script exec vitest run` - 26 files, 480 tests (one new file, three cases
  extended). The web suite under Node 22.23 (`node node_modules/vitest/vitest.mjs run
  --pool=threads`) - 36 files, 446 tests; the forks pool prints its usual Windows worker
  timeouts and the same counts.
- `drizzle-kit check` not run: no schema change this pass.
- `e2e/characters-route.spec.ts` rewritten to the new contract (eight serial tests: the quiet
  empty state, the reasoned queue, undo and walk-ons, the alias table and the script landing, the
  rename preview and `Create a new character instead`, the merge door and the tombstone
  redirect, the sortable sheet and the CSV and the sidebar delete, the inbound links and the
  panel's report) and **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` here, and it has not run
  since 2026-09-12. A browser check of the queue's menu, the toast's `Undo` at eight seconds,
  the alias table's hover controls, the drawer at 1000px, and the script landing is the next
  thing a human should do.

---

## Redesign phase 8, second pass - Scenes: the views are state (2026-09-17)

One client ruling on the built Scenes route, the one the Storyboard took earlier the same day
(phase 3, fourth pass) and in the same words: clicking Index cards or Scene list "hard reloads"
and the URL becomes `/scenes?view=index`; make it smooth and leave the URL alone, "same for
scene list". No table, no action and no view body changes.

### What the reload was

The Storyboard's, exactly: every tab was a `Link` over `?view=`, the page is a Server Component
that reads `searchParams`, and a changed search param re-renders the page segment on the server -
`loadScenes` again (the node list, the derived rows, the measurement and the cast, through the
pooler) - before the body could change, with the router's loading state in between.

### Rulings taken this pass

| Question | Ruling |
| --- | --- |
| `Cards · Index cards · Scene list` were `?view=` | **Client state; the URL stays `/scenes`.** The third row in AGENTS.md's exception table, beside Characters' and the Storyboard's. `params.ts` parses no `view` for `scenes`; `ROUTE_VIEWS.scenes` is empty; a stale `?view=index` - or `?view=grid` - is an unknown key and opens the cards, not a 404 |
| Where the state lives | **A cell, the Storyboard's shape** (`_scenes/view-state.tsx`): Scenes has no layout of its own either, and the header is the page's sibling. `useSyncExternalStore`, the cards as the server snapshot, so a full load draws the cards lit with no hydration mismatch |
| Where the `<main data-sub-view>` comes from | **The route's own `<main>`, a client component** (`_scenes/scenes-main.tsx`). Scenes was the last route on `_chrome/route-shell.tsx` + `episode-route-page.tsx`, which wrote `data-sub-view` from the parsed `?view=` on a server-rendered `<main>`; with the view a cell only a client tree can write it. Both `scenes/page.tsx` files now take the Storyboard's shape - `enterEpisodeRoute`, then `_scenes/scenes-route.tsx` (`parseSubViews` for unknown keys, the box, the body) - and the two shell files are deleted rather than orphaned (the Bible reading: nothing else read them) |
| Where the reset lives | **The route's root, not the workspace.** The Storyboard resets its cell when its workspace unmounts, and its workspace is mounted in every state. Scenes' workspace is not mounted over an empty episode, so `ScenesMain` - which is - carries the unmount reset: leave on the list, come back by the sidebar row, land on the cards, as the bare link always did |
| The toolbar's word for the view | `VIEW_LABEL` moves from `scene-parts.tsx` to `view-state.tsx` beside the tabs, and the tabs' titles are read from it, so the toolbar's `Index cards` and the tab's tooltip are one string (`tests/workspace-routes.test.ts` asserts it) |

### What changed

- `_scenes/view-state.tsx` (new): `ScenesView`, `VIEW_LABEL`, `SCENES_VIEWS` (the three tabs
  with the mockup's icons, moved out of `ROUTE_VIEWS`), `setScenesView`, `resetScenesView`,
  `useScenesView`, `ScenesHeaderViews`. `_scenes/scenes-main.tsx` (new): the `<main>` and the
  reset. `_scenes/scenes-route.tsx` (new): the server entry, `StoryboardRoute`'s shape.
- Both `scenes/page.tsx`: the Storyboard pages' shape. `_chrome/route-shell.tsx` and
  `_chrome/episode-route-page.tsx` deleted - no caller left.
- `_scenes/scenes-body.tsx` takes `context` and calls `loadScenes` (no `view`);
  `lib/scenes/server.ts` loses `enterScenes`, which only the body called.
  `_scenes/scene-workspace.tsx` reads the cell (no `view` prop) and marks its toolbar row
  `data-mounted` once hydrated; `scene-parts.tsx` loses the type and the labels;
  `index-view.tsx` / `list-view.tsx` name their view, not a param.
- `lib/workspace/params.ts`: `scenes: z.object({})`, the ruling written beside the Storyboard's.
  `lib/workspace/views.ts`: `scenes: []` - no row in the table carries an icon now.
- `_chrome/writing-header.tsx`: the `scenes` branch beside `storyboard`; `header-views.tsx` and
  `view-pill.tsx` name the third state route.
- `tests/workspace-routes.test.ts`: `ROUTE_VIEWS.scenes` is `[]`; `SCENES_VIEWS` asserted from
  its module with `VIEW_LABEL`; the `?view=` routes carry no icon; `parseSubViews('scenes', …)`
  yields `{}` and ignores a stale `view`; the refusal, repeated-key and `currentView` cases move
  to Locations.
- `e2e/scenes-route.spec.ts`: a `toView` helper on the Storyboard's; walk 1 asserts the tabs are
  buttons, a click keeps the URL, and `?view=index` / `?view=grid` are 200s on the cards; walk 5
  opens the index and the list by their tabs and re-opens them after each `setTheme` reload.
  `e2e/workspace.spec.ts`: the sub-view 404 case moves to Locations, and Scenes' stale `?view=`
  is asserted a 200 on the cards. `e2e/workspace-routes.ts`: the Scenes row keeps
  `defaults: { view: 'cards' }` (the bare path still writes it) and takes `title: null` - the v2
  pass removed the page header and its `h1`, and the row had not followed.
- AGENTS.md (Routing, the exception table), both CLAUDE.md files, this section.

### Found on the way

- **Walk 2 of the Scenes spec had never run.** Phase 8 shipped its E2E unrun (no creds), and its
  `[data-scene-count]` locator matched two elements - the board's numeric attribute and the
  toolbar's label span - a strict-mode violation on the first signed-in run. The locator is
  scoped to `[data-scenes-header]`; the markup, which both the walk and the memory rule name,
  is untouched. Its next line asserted the canvas zoom against `/^d+$/` - a `\d` with the
  backslash lost - against a correct `100`; the regex is fixed. Walk 3 reloaded for each theme
  (`setTheme`) with the reading modal open and then clicked its `Asian` toggle - the modal is
  component state and does not survive a reload (the Storyboard walks' trap, fourth pass);
  the tile re-opens it after each reload, so the `scenes-modal-*` screenshots show the modal.
  Walk 4's synopsis click landed before the canvas had hydrated: React replays a pre-hydration
  click once hydration finishes, which on the dev server was past the 5s `expect` (probed: the
  dialog appeared, seconds late, with no second click). The toolbar row now carries
  `data-mounted`, as the Storyboard's does, and a `waitMounted` helper precedes every first
  click in walks 2-5 and every `toView`. Walk 5's `[data-scene-row]` matched four rows: the
  list's two and the writing sidebar's Scenes group's two (`_chrome/sidebar-group.tsx` marks
  its rows the same way); scoped to `[data-scene-board]`.
- **A screenshot straight after a DOM assertion can show the frame before.** The passing
  run's `scenes-index-*` / `scenes-list-*` screenshots showed the body on the index or the
  list with the header's `Cards` tab still lit, while `aria-current` on the clicked tab had
  just been asserted (added to `toView`, and it passes). Twelve probes - clicks before and
  after hydration, each theme, each view - never found the DOM disagreeing with itself, so
  the state is one and the picture is Chrome's paint lagging a busy main thread (the dev
  server hydrating after a reload). Every screenshot in the spec now waits two
  `requestAnimationFrame`s (`painted`). The fix to the picture is unverified visually: the
  dev server broke under a concurrent session's Characters edit (`Export shortName doesn't
  exist`, a 500 on every page) before the next full run got past the import.

### Verified

- `turbo run typecheck --force` 6/6, `turbo run lint --force` 6/6.
- `tests/workspace-routes.test.ts`, `tests/shell-and-state.test.ts`, `tests/scenes-canvas.test.ts`
  and `tests/scenes-sheet.test.ts` on nvm's Node 22.23.2: 48/48.
- `e2e/scenes-route.spec.ts` against the user's `:3000` dev server with a throwaway
  `e2e-scenes-views@example.com` (Supabase admin API, the `e2e-views` precedent; password only
  in the session's scratchpad; flagged for deletion with the others): walk 1 - the tabs are
  buttons, a click keeps the URL, `?view=index` / `?view=grid` are 200s on the cards - passed
  on every one of eight runs. The serial suite stopped at each latent phase-8 fault above in
  turn (runs 1-5), then ran **5/5** twice (runs 6 and 7, 5.2m and 7.1m; run 7 with the
  lit-tab assertion in `toView`). Run 8, after the `painted` waits, passed walk 1 and fell at
  walk 2's Fountain import (`[data-nav-meta="scenes"]` stayed `0`) while a concurrent session's
  Characters edit was landing on the dev server; the server returned a 500 on every page
  minutes later. Nothing in walks 2-5 changed between runs 7 and 8 but the waits before
  screenshots. Eight `Scenes walk …` projects are left on the throwaway account.

---

## Redesign phase 8 - Scenes: the canvas and the reading modal (2026-09-17)

The Scenes route's pass, ruled off the mockup by the client with two screenshots: the Cards
view becomes the Storyboard's canvas - the same dark node, the same free ground, pan, zoom, drag,
the animated thread in story order - with a scene per card; and the script excerpt on a card,
clicked, opens the whole scene on a grey, grained sheet in Courier over a blurred, dimmed
window, with a `Hollywood | Asian` toggle at the top and a round ✕ beside its corner. The
scene-specific data stays on the card: number, heading, cast, lines, pages, `Edit`, `Go to
Production`. `Route - Scenes v2.dc.html` draws a card grid and no modal; the ruling overrides
the grid and adds the sheet.

### Rulings taken this pass

| Question | Ruling |
| --- | --- |
| The mockup's Cards view is a `repeat(auto-fill, 330px)` grid | **The canvas** (client, 2026-09-17, by screenshot). `_scenes/canvas/` is the Storyboard's shape: one world div under `translate() scale()`, a node per scene at 306px - `SCENE_NODE_W = NODE_W`, so the two routes draw one node - and the `.folio-thread` between consecutive scenes |
| The README's "Dark canvas, no paper" | **The reading modal is paper** (client, by screenshot): `--paper` / `--paper-ink` / `--paper-ink2` / `--paper-line`, four new tokens in `palette.css` that move with the theme (a mid grey under light ink on the dark canvas, a light grey under dark ink on the light one), and a grain that is an inline SVG turbulence in `.folio-paper`, not an asset. Nothing outside the modal may reach for them |
| What `Hollywood | Asian` does | **Asks the engine.** The toggle opens on the project's `format` and changes the modal's, not the project's (that is the Script route's Format menu). `lib/scenes/sheet.ts` calls `resolveSheet`: Hollywood lays the scene out at US Letter's insets as proportions of 816px; Asian is open decision 8 and refuses, so the Asian tab draws the refusal - the engine's detail and its two evidence rows - where the sheet would be, with `Read it as Hollywood for now`. Not a guessed A4, not a disabled tab, not a toggle that does nothing |

### Calls made in the pass, flagged

- **Positions are component state.** A shot's position persists (`shots.canvas_x`, migration
  `0020`, by ruling); `scenes` has no such column and the pass did not add one - a schema
  decision, and the ask was the frontend. A dragged card keeps its point while the workspace is
  mounted (a synopsis save does not remount it) and loses it on a reload. If the Storyboard's
  ruling is wanted here too, it is `scenes.canvas_x` / `canvas_y` on the same shape, an action
  on `placeShotOnCanvas`'s pattern, and `scenePosition` reading the row before the map.
- **The canvas opens on the start of the row, not fitted.** An episode has eleven scenes, an
  hour forty, a feature two hundred; a fit of all of them is the minimum zoom with nothing
  readable. `openingWindow` (`lib/scenes/canvas.ts`, tested) is the rect that, handed to the
  Storyboard's `fit`, shows the first cards at 100% from the left edge, or the whole row when it
  fits. The pill's `Fit` still fits everything, which is what the button says.
- **The sheet reads, it does not measure.** The modal's lines wrap where the browser wraps them
  at the sheet's proportional insets; the Script route's ruling (2026-09-16) holds - counts,
  eighths and the page number stay the measurement record's, and no number is read off the
  render. `.folio-script-line` is Courier Prime 14px / 1.6, not the engine's 12pt at 6 lpi,
  because a 720px panel is not a page.
- **The canvas pieces are imported across the route boundary, not moved.** `SceneCanvas` uses
  `_storyboard/canvas/use-canvas-viewport.ts`, `connectors.tsx` and `lib/storyboard/canvas.ts`
  as they are. They belong in `_chrome/canvas/` and `lib/workspace/canvas.ts`, and the zoom pill
  wants to be one component; the move was not made because the Storyboard's fourth pass was in
  flight in the same checkout while this one was built, and its files were not to be edited from
  here. `.folio-scene-node` restates the shot node's five declarations for the same reason;
  merge both into one `.folio-canvas-node` when both passes are in.
- **Both dialogs portal to `body`.** The surface card's `backdrop-filter` and the world's
  `transform` each make their box the containing block for `position: fixed`; a modal rendered
  inside either would cover that box, not the window. `ScriptModal` and `SceneDetail` render
  through `createPortal(document.body)`, so the scrim's blur reaches the sidebar and the rail.
- **The page header is gone.** `RouteShell` is kept for the `?view=` parse and the 404, with
  `header={() => null}`: the shell header draws the views, the sidebar row carries the count,
  and the workspace draws its own toolbar row (the selected scene on the left, `N scenes · N
  pages · synopsis saved` on the right) as the Storyboard does. The old 28px footer is gone with
  it - the writing routes have no status bar. The E2E's header count assertion moved to
  `[data-scene-count]`.
- **Selection, and what a click does.** On the canvas a click selects the card (its border
  lifts to `--line`, the toolbar names it); `Edit` and `No synopsis yet · write one` open the
  detail dialog (the latter with the caret in the editor); the tile opens the reading modal. On
  the index and the list a click opens the detail, as the 2026-09-11 ruling's "detail card in
  place" always did. The detail's excerpt block is gone - reading is the modal's - and it gained
  `Read the scene`, which hands over.
- **Index and list took the tokens, not the mockup's structure.** The index card is the
  mockup's (`--sunk`, a 3px bar, mono number and heading, synopsis, `pg · eighths`) in a flat
  grid - the mockup's act columns and colour-by are not built (acts are not a table); the bar
  is the status. The list is the mockup's table shape with the route's own columns (I/E and
  Time where the mockup folds them into Day / Night; Lines and Status, which it does not draw).
- **`Ready` / `Draft` is the synopsis.** The mockup's two words on its status dot; `sceneStatus`
  in `lib/scenes/canvas.ts`, `--ok` and `--warn`. There is no other status on a scene.
- **The header pill still says `Cards`.** `ROUTE_VIEWS.scenes` is in the other pass's diff and
  was not touched; the tab id `cards` is the URL and stays either way.
- **Icons.** No new icon. The tile's `Read` mark and the `Edit` button reuse `write`; `Go to
  Production` reuses `production`; the ✕ is `close`.

### What changed

- `packages/ui/src/tokens`: `palette.css` the four `--paper*` tokens in the three-block shape;
  `theme.css` registers them.
- `apps/web/lib/scenes`: `canvas.ts` (new, pure: `SCENE_NODE_W`, `scenePosition`,
  `openingWindow`, `sceneStatus`, `tileBadge`) and `sheet.ts` (new, pure: `readingLayout`,
  `READING_FORMATS`); `tests/scenes-canvas.test.ts` and `tests/scenes-sheet.test.ts`.
- `_scenes/`: `scene-workspace.tsx` (the container; replaces `scene-board.tsx`, deleted),
  `canvas/scene-canvas.tsx` and `canvas/scene-node.tsx` (new), `script-modal.tsx` (new),
  `scene-detail.tsx` (the dialog, restyled, portalled), `index-view.tsx` and `list-view.tsx`
  (moved out, on the tokens), `scene-parts.tsx` (the shared formatters and chips),
  `scenes-body.tsx` (the README's empty card, the workspace). `scenes-header.tsx` deleted; both
  `scenes/page.tsx` files pass `header={() => null}`.
- `globals.css`: one block at the end - `.folio-scene-node`, `.folio-scene-tile` and its lines,
  `.folio-modal-scrim`, `.folio-paper` and its toggle, close, button, refusal and script lines.
- `e2e/scenes-route.spec.ts`: the header assertion moved; the canvas's zoom, thread and
  selection asserted; a new walk for the modal (the sheet, `Asian` → the refusal, `Read it as
  Hollywood`, Escape).

### Verified

`pnpm exec turbo run typecheck lint --force`: 12/12. `tests/scenes-canvas.test.ts` (7),
`tests/scenes-sheet.test.ts` (4), and the whole web suite on Node 22.23.2 via nvm (the jsdom
trap): 34 files, 430 passing, with the concurrent pass's changes in the tree. `pnpm --filter web
build` clean, `check:secrets` included. The E2E walks are **unrun**: no `E2E_*` credentials are
configured locally and the walk accounts' passwords are not on disk. The CSS was checked instead
with the static harness (the compiled `.next/static/chunks/*.css` + the node's and the modal's
markup in an HTML file, Playwright screenshots from the scratchpad, both themes, the tile's
hover): the node reads as the shot node, the sheet reads as the reference. What the harness
cannot see - the drag, the wheel, the opening fit, the portals over the real shell - stands on
the Storyboard's tested viewport and the typecheck, and wants a signed-in walk.

---

## Redesign phase 3, fourth pass - Storyboard: the views are state (2026-09-17)

One client ruling on the built Storyboard route, about where the address moves. The client's
words, in intent: clicking Canvas or Shot list "hard reloads" and the URL becomes
`/storyboard?view=canvas`; make it smooth and leave the URL alone, like it looks and feels
better. No table, no action and no view body changes.

### What the reload was

Not a full page load - Next soft-navigated - but every tab was a `Link` over `?view=`, the page
is a Server Component that reads `searchParams`, and a changed search param re-renders the page
segment on the server: `loadStoryboard` ran again (a database round trip through the pooler)
before the body could change, with the router's loading state in between. The view being a URL
cost a server read per click.

### Rulings taken this pass

| Question | Ruling |
| --- | --- |
| `Boards · Canvas · Shot list` were `?view=` (AGENTS.md, Routing: "sub-views are query params") | **Client state; the URL stays `/storyboard`.** The same ruling Characters' tabs took on 2026-09-16 and the Script's switches on 2026-09-11, now a second row in AGENTS.md's exception table. `params.ts` parses no `view` for `storyboard`; `ROUTE_VIEWS.storyboard` is empty; a stale `?view=canvas` - or `?view=grid` - is an unknown key and opens the board, not a 404 (the Characters reading) |
| Where the state lives | **A cell, not a provider.** Characters holds its view in a provider in its own layout; the Storyboard has no layout of its own - `(writing)/layout.tsx` is shared with Script, Outline and Scenes and cannot host one route's state - and the header it renders is the page's sibling, not its child. So the view is the shape `lib/storyboard/coverage.ts` already is for the sidebar: a module-level value with `useSyncExternalStore`, in `_storyboard/view-state.tsx` (the Characters file's name), which the header subscribes to for its tab and the workspace for its body. The server snapshot is the board, so a full load draws the board lit with no hydration mismatch |
| Whether the view survives leaving the route | **No - back to the board on unmount**, as `publishBoardCoverage(null)` is. The sidebar's Storyboard row and the episode menu link the bare path, which opened the board; keeping a canvas across Script → Storyboard would be a behaviour the URL never had. An episode switch remounts the page under its segment and resets the same way |
| Who draws the tabs | **The header itself, on its segment.** The writing layout cannot pass `views` (a layout cannot see which route it renders), so `WritingHeader` branches on `route === 'storyboard'` and draws `StoryboardHeaderViews` - `ViewPill`'s `onSelect` variant, the buttons Characters' tabs are - where the other routes go through `header-views.tsx` and `?view=`. `HeaderViews` itself is untouched |
| The board card and the column's `Open` were `Link`s to `?view=canvas` that selected the scene on the way | **`view.onOpenCanvas(sceneNodeId)`**: selects and sets the view in one callback (`ViewProps`; `canvasHref` is gone). `Open` is a `<button>`; the card is a `role="button"` block with `tabIndex` and Enter / Space, the list's scene-row shape, because its layers are block content a `<button>` may not hold. Drag-reorder is unchanged - `draggable` on the `div` as it was on the `a` |

### What changed

- `_storyboard/view-state.tsx` (new): `StoryboardView`, `STORYBOARD_VIEWS` (the three tabs
  with the mockup's icons, moved out of `ROUTE_VIEWS`), `setStoryboardView`,
  `resetStoryboardView`, `useStoryboardView`, `StoryboardHeaderViews`.
- `lib/workspace/params.ts`: `storyboard: z.object({})`, the ruling written beside Characters'.
  `lib/workspace/views.ts`: `storyboard: []`.
- `_chrome/writing-header.tsx`: the `storyboard` branch in the centre; `header-views.tsx` and
  `view-pill.tsx` name the second state route in their docs.
- `_storyboard/storyboard-workspace.tsx` reads the cell (no `view` or `baseHref` prop), resets it
  on unmount, and hands the views `onOpenCanvas`; `storyboard-route.tsx` still calls
  `parseSubViews` for unknown keys and passes no view; `handlers.ts` `onOpenCanvas` for
  `canvasHref`; `board-view.tsx` two buttons for two links; `storyboard-toolbar.tsx` imports the
  type it used to own. `globals.css`: the `.folio-shot-card` note says button.
- `tests/workspace-routes.test.ts`: `ROUTE_VIEWS.storyboard` is `[]`; the Storyboard's and
  Characters' state tabs are asserted from their own modules (`STORYBOARD_VIEWS`,
  `CHARACTERS_VIEWS`); `parseSubViews('storyboard', …)` yields `{}` and ignores a stale `view`;
  `currentView`'s cases move to Scenes.
- `e2e/storyboard-route.spec.ts`: a `toView` helper clicks the header's tab and asserts
  `data-sub-view`; every `?view=` navigation is a bare load plus a click; each `page.reload()` and
  `setTheme` (which reloads) that expected the canvas or the list back re-opens it by its tab;
  the empty-state walk asserts the tabs are `button`s, the URL does not move on a click, and
  `?view=list` / `?view=grid` are 200s on the board (the `grid` 404 assertion is gone with the
  param). `e2e/workspace-routes.ts` keeps `defaults: { view: 'board' }` - it asserts
  `data-sub-view` on the bare path, which still holds - as Characters' row keeps `cast`.
- AGENTS.md (Routing, the exception table), both CLAUDE.md files, this section.

### Found on the way

- **Walk 2 was one pass stale.** It clicked the fifth proposal and expected the board's
  in-place `[data-shot-editor]` with `Accept` / `Discard` - the editor the card pass (third
  pass, 2026-09-17) removed when a card click became the canvas; that pass rewrote walks 3 and 4
  and left this step, and the suite is serial, so it had not been past walk 2 since. Now: the
  click lands on the canvas (URL unchanged), the fifth node has `Accept` and no `Generate`, its
  `⋯ → Discard` removes it, and the board tab brings the column back with four.

### Verified

- `pnpm typecheck` 6/6 (forced), `pnpm lint` 7/7, `pnpm build` clean including the secrets scan.
- `tests/workspace-routes.test.ts`, `tests/shell-and-state.test.ts` and
  `tests/storyboard-board.test.ts` on nvm's Node 22.23.2: 53/53.
- `e2e/storyboard-route.spec.ts` **5/5 (7.2m)** against the user's `:3000` dev server, with a
  throwaway `e2e-views@example.com` made through the Supabase admin API for this session (the
  `e2e-storyboard` / `e2e-canvas` precedent; password nowhere on disk but the session's
  scratchpad; flagged for deletion with the others). The first run stopped at the stale walk-2
  step above; the second ran through. The canvas and list screenshots are taken after a
  reload and a tab click, and show the canvas and the list.

---

## Redesign, the header's views - the mode pill goes, Storyboard is a row (2026-09-17)

The client's brief, verbatim in intent: remove the Write / Storyboard buttons from the top bar
on every shell - the sidebar has a Script row so `Write` says nothing, and Storyboard goes
below it - and have the top bar show the sub-pages of the page instead (the Storyboard's
boards, canvas, shot list), each with its name and not only an icon, the same on every route.

### Rulings this reverses

| Ruled before | Ruled now |
| --- | --- |
| 2026-09-16: the writing sidebar is Script · Outline · Scenes; Storyboard is the header pill's other half (AGENTS.md, Routing; the README's "Header") | **Script · Storyboard · Outline · Scenes**, Storyboard directly under Script; no mode pill anywhere. AGENTS.md's bullet, the README's "Header" and "Toolbar" (amended in place, the mockups still draw the pill) and `lib/workspace/routes.ts` say so |
| The mockups' Storyboard and Scenes pills are icon-only 34×30 tabs; the record routes' are text | **One shape: icon beside name.** Every tab prints its name; the Storyboard's and Scenes' draw the mockup's icon before it. `_chrome/view-pill.tsx` lost its `shape` prop and `data-shape` |
| The view switcher is the toolbar's, per route | **The header's centre, for every route** - where the pill sat. `lib/workspace/views.ts` is the table, `_chrome/header-views.tsx` lights the tab from `?view=`, and the five toolbars (Storyboard, Production, Locations, Research, Characters) and the Scenes page header stopped drawing theirs |

### Calls made, not ruled

- **Labels.** The Storyboard's tabs print `Boards · Canvas · Shot list` (the brief said
  "storyboard, canvas, shotlist"; `Storyboard` under the Storyboard row is a tautology and the
  sidebar group is already `Boards`); their tooltips stay the mockup's `Scene boards` / `Shot
  canvas` / `Shot list`. Scenes prints `Cards · Index cards · Scene list`. Every other route
  prints the names it already had.
- **Icons only where a mockup draws one.** The Scenes mockup's four-tile `cards` icon is
  transcribed into `icons.tsx` (the set "grows only when a mockup does"); `index` reuses
  `board` and `list` reuses `list`, as the mockup does. Production, Characters, Locations,
  Timeline and Research have text tabs in their mockups and there is no icon to transcribe -
  drawing one would be the lookalike AGENTS.md refuses. The `write` and `storyboard` icons the
  pill drew stay in the set, orphaned.
- **The header reads `?view=` itself** (`useSearchParams`, under a `Suspense`) rather than the
  page publishing its parsed view to a cell: it is the same string the page parsed, the page
  already 404s an unknown value, and no cell needs seeding. Two routes cannot use that rule and
  hand the header their own tabs through a new `views` slot: Characters (`CharactersHeaderViews`,
  its views are state) and Research (`ResearchHeaderViews`: a source page, `/research/:sourceId`,
  is the `source` view with no query in its address - the shared rule lit `Library` under a source
  body until the review pass caught it; the segment below `research/layout.tsx` says which).
- **The header at its narrowest** (1200px, sidebar and assistant both open - the README's smallest
  in-flow case): three named tabs are wider than the two-tab pill was, so the halves give way
  first - the right half keeps `min-width: fit-content` (Share and the orb never slide under the
  tabs) and the episode crumb's wrapper is `min-w-0 shrink` (it truncates after the project
  title does). Measured: at 1200px with both panels open the crumb is `Res… / ⌄`, the pill and
  Share intact.
- **Timeline is untouched.** It has no 60px header yet - it still draws its pre-redesign
  `ContextColumn` and its own 46px header with glyph + name tabs - and building the shell header
  there is the Timeline pass. Its row in `ROUTE_VIEWS` exists so the table is total and the test
  holds; nothing reads it yet.
- **The writing routes' crumb is unchanged** (`Project / Episode ▾`); the lit sidebar row names
  the route. The record routes keep their third crumb.
- **`ROUTE_VIEWS` is typed against `SUB_VIEW_SCHEMAS`** and `tests/workspace-routes.test.ts`
  asserts the two agree both ways, in order - a new `?view=` value without a tab fails the unit
  test before it fails a walk.

### Found on the way

- **The Locations route crashed on load** - `locations-layout.tsx` (a Server Component) called
  `sidebarRowOf`, a function exported from the `'use client'` module `location-sidebar.tsx`,
  and React refuses that ("Attempted to call sidebarRowOf() from the server"). Reported in the
  2026-09-16 user walk; fixed here by moving `LocationSidebarRow` and `sidebarRowOf` to
  `lib/locations/view.ts`, the plain module both sides import.
- **`e2e/workspace-routes.ts` had drifted** from the v2 bodies: the Storyboard row still
  expected an `h1` (the v2 toolbar has none) and Production's still said `context 250` (the v2
  layout draws the sidebar card). Corrected to what the routes draw, so the workspace walk can
  pass; the walk now also asserts the header's centre per route (`HEADER_VIEWS`).
- `tests/workspace-routes.test.ts` still expected `parseSubViews('characters', {})` to yield
  `view: 'cast'`, one pass behind the ruling that made Characters' views state. Corrected.
- `CONTEXT_PANEL_WIDTH` still listed `production: 250` with a comment saying Production had not
  had its pass; the v2 Production layout draws the sidebar card. Now `{ timeline: 250 }` -
  Timeline is the one route left on a context column - and `ContextColumn`'s route type says so.
- The workspace walk's `expectSidebar` asserted the Scenes group's empty copy on the Outline row,
  where the second group is `In this outline` (`[data-toc-empty]`). Branched per route.
- Root `CLAUDE.md`'s "Done" list omitted Locations (rebuilt 2026-09-16); `apps/web/CLAUDE.md`
  still had the project shell drawing "the Characters overlay", deleted by the Characters second
  pass. Both corrected.

### Files

`lib/workspace/views.ts` (new), `lib/workspace/routes.ts` (`SIDEBAR` four rows; `WRITING_MODES`,
`writingModeOf`, `WRITING_MODE_TARGET` deleted), `_chrome/header-views.tsx` (new),
`_chrome/writing-header.tsx`, `_chrome/view-pill.tsx`, `_chrome/record-toolbar.tsx` (no `pill`),
`_chrome/characters-layout.tsx`, `_characters/view-state.tsx` (`CharactersHeaderViews`),
`_chrome/research-layout.tsx`, `_research/research-header-views.tsx` (new), the five toolbars,
`_scenes/scenes-header.tsx` and both Scenes pages, `packages/ui/src/icons.tsx` (`cards`),
`globals.css` (`.folio-pill-tab` deleted; `.folio-view-pill` one shape), `lib/locations/view.ts`,
`_locations/location-sidebar.tsx`, `_chrome/locations-layout.tsx`, `_chrome/context-column.tsx`,
AGENTS.md, both CLAUDE.md files, the design README, the unit test and seven E2E files.

### Verified

- `pnpm typecheck` 6/6, `pnpm lint` 7/7, `pnpm build` clean including the secrets scan - after the
  review fixes.
- `tests/workspace-routes.test.ts` 23/23 and `tests/shell-and-state.test.ts` (35 between them) on
  nvm's Node 22.23.2 (`node_modules/vitest/vitest.mjs` directly; the default 22.5.1 hits
  `ERR_REQUIRE_ESM` on jsdom, root `CLAUDE.md` trap 2). The new `the header's views` block asserts
  `ROUTE_VIEWS` against every schema, the labels and icons, and `currentView`'s default.
- A five-lens review (runtime, types and leftovers, UI and design rules, tests and E2E, docs), each
  finding put to two adversarial verifiers, confirmed fourteen and refuted two. The one behavioural
  regression - Research's source page lighting `Library` - is fixed above; the rest were the header
  at 1200px, the Outline row in the walk, `CONTEXT_PANEL_WIDTH`, and comment and doc slips, all
  fixed the same pass.
- Browser walk on the `:3000` dev server (`e2e-canvas@example.com`), 1440 and 1200px, both themes:
  the header's centre names the route's views on Storyboard (board, canvas, list), Scenes,
  Production, Characters, Locations and Research, lit tab following `?view=` across soft
  navigation, Characters switching without changing the address, Script and Outline with an empty
  centre; the sidebar's Storyboard row lit on the Storyboard with its `4 shots` meta; Locations
  loads (it crashed before).
- E2E against the same server: `storyboard-route.spec.ts` 5/5 (7.1m); `research-route.spec.ts` 4/4
  (3.8m, after the source-page fix); the shell walks of `production-route`, `locations-route` and
  `characters-route` (walks 1-2) pass. Not green, not mine: `characters-route` walk 3 fails on
  `[data-unmatched-match]` (the concurrent Characters second pass's queue), and the suite is
  serial, so walks 4-6 - including walk 6's click on the `relationships` tab, now in the header -
  did not run; the suite cannot be started at walk 6 (`charactersUrl` is set by walk 1), and the
  same click succeeded in the browser walk above. Rerun the suite once that pass settles.
  `workspace.spec.ts` was not run (it creates two projects per run); its rows were corrected
  against the routes as drawn.

---

## Redesign phase 3, second pass - the Storyboard canvas (2026-09-17)

The Storyboard's canvas view becomes a free surface. Phase 3 built the mockup's "CANVAS" as a
CSS-scaled strip of nodes joined by hairlines; the client asked for the Laper AI shape instead -
pan, zoom, cards dragged anywhere, the sequence drawn as a linked list with animated threads,
each card a `Storyboard | Lens` toggle, `Generate` beside a `⋯` with Upload image / Clear image /
Delete, `Add shot` in the toolbar, and one `Display` menu on the list for sort and filter. The
board (scene columns, Auto board) stays as built.

Four rules collided with the ask; the client ruled on each before the pass started.

### Rulings taken this pass

| Question | Ruling |
| --- | --- |
| A card's position needs a home; `shots` had only `order_key` | **Persisted, per shot**, in migration `0020`: `canvas_x` / `canvas_y`, nullable integers in world px, both or neither by a check. Null means "laid out from `order_key`" (`lib/storyboard/canvas.ts`, `autoLayout`). Position is cosmetic: the thread, the number the card prints and the order a reel renders all still read `order_key`, so dragging a card never reorders anything. The alternatives - auto layout with drag as reorder, or a per-tab `sessionStorage` position - were offered and declined |
| `docs/ui design/README.md`: "Transitions are .14s on background, colour, border and opacity - nothing else animates. The one exception is the assistant orb's 9s drift" | **The thread animates**, and the README now names two exceptions. `.folio-thread` is a dashed SVG path whose `stroke-dashoffset` loops (`@keyframes folio-thread`, 1.6s, 6 + 8 = 14px so the loop is seamless); `prefers-reduced-motion` stops it |
| AGENTS.md: a dependency needs approval, every time | **Hand-rolled.** `@xyflow/react` was named and declined: pan, zoom, drag and threads are pointer capture, one `translate() scale()` on a world div, and an inline SVG (`_storyboard/canvas/`, ~600 lines with the card). No new package |
| `Upload image` had no backend: a frame is a `frame_generations` row, and a generation needs a job | **`shots.frame_upload_url text`**, in the same migration - a URL the way a generation's `frame_url` is one. The upload goes to R2 through `lib/storage/r2.ts` on the location photo's pattern, gated on the `R2_*` block; without it the menu item is drawn disabled with the reason in its title |

### Calls made in the pass, flagged

- **One scene per canvas**, as the strip was. Every write is per scene, no cross-scene move
  exists, and a thread is one scene's sequence. The scene is picked by the canvas toolbar's
  `‹ Scene NN ›` stepper, the sidebar's `Boards` group, or the board column's new `Open`. The
  selection stays component state (open decision 10 untouched): Next 16 keys the page segment
  without its search params, so `StoryboardWorkspace` stays mounted across `?view=` and `Open`
  lands on the scene it named. Verified in `layout-router.js`, not assumed.
- **Upload precedence.** A new `FrameState` kind, `uploaded { url }`, rather than a `drawn` with
  a fake job. `foldUpload` (`@folio/db`, `repositories/storyboard.ts`) prefers the upload over
  every settled generation - empty, drawn, failed, blocked, cancelled - and lets a `queued` or
  `running` job show through, because the writer needs its Cancel / Stop and its reservation
  notice more than the picture. `readBoardCoverage`'s `drawn` count says the same in SQL. The
  Production route's tiles read `uploaded` as done; its takes stay generation-only.
- **`placeShotOnCanvas` is not gated by `notLocked`.** A finalized reel locks what it renders
  from; a position renders nothing. Every other shot write still carries the predicate.
- **`FilterMenu` is gone; `[data-filter-menu]` with it.** The one `Display` menu has three
  sections - Show (descriptions, frames), Sort (list view only), Filter - and the button prints
  the filter's name when one is set. Walk 3's two clicks moved. Sort is `sortShots` in
  `lib/storyboard/board.ts`: story order, shot size (by the vocabulary), lens (null last),
  needs-work-first; stable over the sequence; the list header says `sorted by lens` when it is
  not the sequence. This overrides phase 3's "a sort that reorders the print would be a different
  document" - the header line is what keeps it honest.
- **`Add shot` appends a blank node immediately** (`BLANK_SHOT` through `onAdd`) and the card is
  edited where it lands; the board column's form-based add is unchanged.
- **The card edits in place, two ways.** The description is a click-to-edit textarea on the
  `Storyboard` tab (blur or Cmd+Enter saves through the label book, Escape leaves); the `Lens`
  tab's four selects each save the whole spec on change (`shotEditOf` fills the rest). The long
  form with the duration is still `⋯ → Edit`. Editing a proposal still accepts it.
- **Lens is a select of presets** - 14, 24, 35, 50, 85, 135, 200 - plus whatever the row holds
  when it is none of those, plus `—`. The contract's lens stays a free integer.
- **The `wheel` listener is added by hand with `{ passive: false }`.** React's `onWheel` is
  passive, so `preventDefault` there is a no-op and the page would scroll under the zoom. Noted
  in `apps/web/CLAUDE.md`.
- **Icons.** No plus, trash or sparkle was added to `packages/ui/src/icons.tsx` - the set grows
  only when a mockup does. `+` and `⋯` stay text glyphs; the board's `Open` reuses `canvas`.

### What changed

- `packages/db`: `0020_storyboard_canvas.sql` (applied to dev); `schema/storyboard.ts` three
  columns and a check; `repositories/storyboard.ts` `foldUpload`, `placeShotOnCanvas`,
  `setFrameUpload`, the coverage SQL; `repositories/production.ts` folds the upload into a
  shot's frame.
- `packages/contracts`: `ShotSchema` gains `canvasX`, `canvasY`, `frameUploadUrl`;
  `FrameStateSchema` gains `uploaded`; `CanvasPositionSchema`; `FRAME_UPLOAD_MAX_BYTES`.
- `apps/web/lib/storyboard`: `canvas.ts` (new, pure, tested); `board.ts` `SHOT_SORTS`,
  `sortShots`, `shotEditOf`, `uploaded` in `isDrawn` / label / tone; `actions.ts`
  `placeShotOnCanvas`, `uploadFrame`, `clearFrame`; `server.ts` `storage`. `lib/storage/r2.ts`
  `keyOfPublicUrl`. `lib/production/{view,status}.ts` read `uploaded`.
- `_storyboard/canvas/` (new): `canvas-view.tsx`, `use-canvas-viewport.ts`, `connectors.tsx`,
  `shot-node.tsx`, `lens-panel.tsx`, `node-menu.tsx`. The old `canvas-view.tsx` is deleted.
  `storyboard-toolbar.tsx` one menu; `handlers.ts` three handlers and `sort` / `storage` /
  `canvasHref`; `board-view.tsx` `Open`; `list-view.tsx` sort; `shot-parts.tsx` draws an
  upload. `globals.css`: the ground, the world, the grip, the tabs, the thread and its keyframe.
- Docs: the README's motion rule; this section; `apps/web/CLAUDE.md`; `packages/db/CLAUDE.md`.

### Verified

`pnpm typecheck` 6/6, `pnpm lint` 7/7, `pnpm --filter @folio/db db:check` clean, `0020` applied
to dev, `pnpm build` clean (`check:secrets` included). `tests/storyboard-canvas.test.ts` (new),
`storyboard-board.test.ts`, `production-view.test.ts`, `production-status.test.ts`: 67 passing
on local Node 22.5.1 (node environment; the jsdom trap does not apply). The E2E walk
(`storyboard-route.spec.ts`, walks 3 and 5 extended: the merged Display menu, the fitted zoom,
the grip drag surviving a reload with the number unchanged, the Lens select, Add shot and
Remove from the canvas, Upload refused with its reason, the stepper, the list sort) ran **5/5**
against the dev server on `:3000` with a throwaway account created through the Supabase admin
API (`e2e-canvas@example.com`, password in the session's scratchpad only; flagged for deletion
with the other `e2e-*` accounts). The first run failed walk 5 on an assertion that the canvas
opens at `100%` - it opens fitted, `63%` at Playwright's 1280px viewport - and the assertion
was rewritten to read the fitted value; the rerun was clean. Two things the browser found: the
E2E screenshots are captured before hydration, so the fit moved from `useEffect` to
`useLayoutEffect` to spare the writer the identity-then-fitted flash; and a thread in `--line`
sinks into the grid dots (both ~10% white), so it is drawn in `--ink3`. Both themes checked on
the board, the canvas (Storyboard and Lens tabs, the `⋯` menu) and the list's Display menu.

---

## Redesign phase 3, third pass - the board card is the frame (2026-09-17)

One component: the shot card inside a Boards-view scene column (`_storyboard/board-view.tsx`,
`ShotCard`). The mockup's card is text-first - the scene heading as an eyebrow, the number,
`WS · 24mm`, a 104×59 thumbnail beside them and two lines of description, all at once - and the
client ruled it cluttered and replaced it with a frame-first card that reveals its text under the
pointer. The canvas node, the list row, the column header and `FrameTile` are untouched; the
card simply stops calling `FrameTile` and draws its own full-bleed media layer.

The card is the column's width at 16:9, 12px radius on `--line2` over `--s1`, `cursor: grab`,
`flex-shrink: 0` - the column is a scrolling flex column and without it the aspect height
collapses to ~83px. Three layers: the media (the picture over the `--frame-a → --frame-b`
gradient and the 3×3 grid, or the dashed tile with the job's state in mono - `no frame`,
`queued`, `drawing`, `refused` - and, under it, the notice `frameNotice` gives, since a refusal's
reason is never hidden in a hover); the number pill and, when the shot has a description, a
three-lines mark (the icon set's `list`, at 11px), both on a blurred `--shot-scrim`; and the
detail overlay - description clamped to three lines, `@` chips from `mentionChips`, and
`WS · 24MM · STATIC` (size short · lens · movement) in mono. Hover is CSS alone
(`.folio-shot-card` in `globals.css`): the media scales 1.03 and blurs 2px at half brightness,
the overlay fades and rises 6px, the mark fades out, the card lifts 1px onto `--line`, all
300ms ease-in-out on transform, filter, opacity and border-color only. `:focus-visible` reveals
the same for the keyboard. Nothing re-renders on a mouseover.

Three things settled on the way:

- **The colours are tokens.** The brief wrote eight rgba values; AGENTS.md, Conventions puts every
  colour in `packages/ui/src/tokens/`, so they are `--shot-scrim`, `--shot-scrim-ink`,
  `--shot-over-a/b/c`, `--shot-over-ink`, `--shot-over-sub`, `--shot-chip` in `palette.css`,
  beside `--frame-badge` and with the same argument for having no light override: light ink on
  a dark scrim over a picture reads the same on either canvas. The mark's ink is
  `--frame-badge-ink`, the same value.
- **Chips are the label book's `@Name`, and there is no technique tag.** The brief named
  `@ADE, @MAYA` plus a tag like `Handheld`. A shot has no tag field; movement is the closest real
  thing and is already the camera line's third word, so it is not also a chip. The chips keep
  the book's casing rather than upper-casing - the book is the one source for a label.
- **The clip is an inner box.** `.folio-drop-before` draws its accent line 5px above the card;
  `overflow: hidden` on the card itself would clip it, so the card stays visible-overflow and a
  `.folio-shot-clip` at `inset: 0` clips the layers at the radius less the border.

`Frames` off in Display hides the picture and the tile says `drawn`; `Descriptions` off hides
the description and the mark together, since a mark for text the overlay will not show would
mislead. The walk's selectors (`[data-shot]`, `[data-shot-number]`, `[data-frame]`,
`[data-shot-description]`, `[data-mention]`, `[data-frame-notice]`) are all still on the card,
and Playwright's `toContainText` reads `textContent`, so the overlay's `35mm` and `CU ·` match
without a hover.

**A click opens the canvas, not the editor** (ruled the same day, second ask). The card is a
`Link` to `view.canvasHref` that selects its scene on the way - the column's `Open`, on every
card - so a click lands on the canvas view with that scene fitted, where the shot is authored
(the inline description, the `Lens` tab, `Generate`, `⋯ → Edit / Remove`). The board's in-place
editor for an existing shot is gone with it (`editing` state, `editorActionsFor` import); `+ New
shot` still opens one for a new card. Drag-reorder is unchanged - an `<a draggable>` carries the
custom type as the `div` did. The walk's third and fourth tests now author from the canvas: a
card click asserts `data-sub-view="canvas"` and `Scene 01 · 4 shots`, the lens and the `@Meera`
description go in through the node's `⋯ → Edit` and are read back on the board card, Remove is
the node's `⋯`, and the credits walk drives the node's `Generate` / `Cancel` (same `data-cost`
and `title`) with the board card's tile checked once after the reload. Not landed on the
specific shot: the canvas fits the scene, as `Open` does; centring on the clicked card would
need a focus-shot state in the workspace and was not asked for.

---

## Redesign phase 5, second pass - Characters: the rail is a link, the views are state (2026-09-16)

Two client rulings on the built Characters route, both about where the address moves and where it
does not. Neither touches a table, an action or a view body.

### Rulings taken this pass

| Question | Ruling |
| --- | --- |
| The rail's Characters icon opened the 330px peek overlay on the writing routes (phase 1's ruling, from the writing mockups' "CONTEXT OVERLAY") and navigated only on the record routes | **A plain link to `/characters` from every route.** The client: "take me directly to the /characters route, don't open the side tab." The overlay (`_chrome/characters-overlay.tsx`), its read (`lib/characters/peek.ts`) and its ephemeral flag (`contextOverlay` in `lib/state/ephemeral.tsx`) had no other reader and are deleted rather than left unreachable - a peek nothing can open is a placeholder. The rail's one `button` branch goes with them: six `Link`s, one shape |
| `Cast · Relationships · Sheet` were `?view=` (AGENTS.md, Routing: "sub-views are query params") | **Client state; the URL stays `/characters`.** The client's words: "keep it smooth ... don't change the route." The same ruling the Script route took on 2026-09-11 for its Script / Cover and Info / Collaboration switches, now a row of its own in AGENTS.md's exception table. `params.ts` parses no `view` for `characters`; a stale `?view=relationships` is an unknown key and opens the cast, not a 404 (the Script's stale `?doc=` reading) |
| Where the state lives | **The route's layout**, `_characters/view-state.tsx`, beside `CastSidebarProvider`. Opening a record is a navigation (`/characters` → `/characters/:id`) and the page subtree remounts; state in the workspace would snap back to the cast on every graph node or sheet row clicked - which is what the URL-borne view already did, since `characterHref` carried no query. In the layout the view rides across the drawer's open and close, and resets to the cast on a full load |
| The pill's tabs were `Link`s over `?view=` in the shared `_chrome/view-pill.tsx` | **A second target on the same component.** `ViewPill` takes `baseHref` (links, as before, for the five routes still on `?view=`) or `onSelect` (buttons). Same class, same `aria-current`, same `data-view-tab`, so the CSS and the E2E read one shape. The link variant keeps its guarantee through a conditional: `baseHref` is `never` unless every item is an `AnySubView` |
| The drawer's `Relationships →` linked to `?view=relationships`, which also closed the drawer | **A button that sets the view**, drawer left open with the record's node lit in the graph. Closing it as a side effect was the link's accident, not a design |

### What changed

- `_chrome/rail.tsx`, `_chrome/project-shell.tsx`, `layout.tsx`: the overlay wiring and the
  shell's unused `title` prop go; `Escape` no longer has an overlay to close.
- Deleted: `_chrome/characters-overlay.tsx`, `lib/characters/peek.ts`; `CONTEXT_OVERLAYS` /
  `contextOverlay` out of `lib/state/ephemeral.tsx`.
- `lib/workspace/params.ts`: `characters: z.object({})`, with the ruling written beside the
  Script's.
- `_characters/view-state.tsx` (new): `CharactersView`, `CHARACTERS_VIEWS`,
  `CharactersViewProvider`, `useCharactersView`. `characters-layout.tsx` wraps the route in it;
  the workspace, toolbar and drawer read it; `CharactersRoute` no longer passes `view`.
- E2E: `workspace.spec.ts`'s overlay walk is now "the rail navigates straight to `/characters`";
  `characters-route.spec.ts` clicks the tabs and asserts the URL does not move, and asserts a
  stale `?view=` is a 200 on the cast. Both unrun (need credentials).

### Verified

`pnpm --filter web exec tsc --noEmit` clean; eslint clean on every touched file.

---

## Redesign phase 7 - the Research route (2026-09-16)

The seventh route rebuilt to the v2 package, and the first built from nothing: `docs/ui
design/Route - Research v2.dc.html` on the shell phase 1 built, with no route body, no table and
no contract before it (`schema/index.ts` listed "research sources" as deliberately absent). Three
views - Library, Source, Clips - behind the toolbar's text pill; a source read at
`/research/:uuid`; one drawer to add and edit. Built beside the Characters (phase 5) and
Locations (phase 6) passes in the same working tree, on their shared pieces where those existed
by the time this pass reached them. The mockup's `data()` was read for the shape the UI needs;
every derived field it authors (`snippet`, `byline`, the `src · meta` line, `clips`, the highlight
spans, the widget) is a pure function in `lib/research/view.ts`, tested, over the real rows.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The brief and the README's table say `Library · Source`; the mockup's `view` prop is `library \| source \| clips`, its pill has three tabs, the Source footer links `All clips →` and the widget counts filed clips | **The mockup.** Three views; `params.ts` already accepted the three. The same reading phases 5 and 6 took |
| The mockup files clips to `Bible · Water · rule 3` and its empty copy says "file to the Bible, a character or a scene"; the Bible was removed (`0015`) | **Three targets: a character, a location, a scene.** `research_filing_kind` has no Bible value and the empty card's sentence reads "a character, a location or a scene" - specified copy, edited because it named a route that does not exist. Flagged |
| How a source links to a scene; the README's citation pattern runs script → record | **Reversed, on purpose, and authored.** A clip comes from outside the script and cannot be derived, so its link is a filing on the clip's side: `research_clip_filings.scene_node_id`, the heading node's id with **no foreign key**, exactly `shots.scene_node_id` - a heading that leaves and returns by undo keeps its clips. Character and location filings are real keys and cascade. Nothing on the script side refers to a clip; the reverse read is one index (`research_clip_filings_scene_idx`) for a later route |
| The route had no `:id` segment; the mockup's status bar writes `/research/<id>` | **`/research/:sourceId`**, the `/characters/:uuid` precedent, added on the brief's authority (AGENTS.md, When to ask first - a route segment). `?view=source` on the bare path goes to the first source, else back to the library; on a source's path the view is the source whatever the param says |
| Conflict blocks and `Not on the page yet`: the brief names both; the mockup draws neither | **Not drawn.** A clip cannot disagree with the script; the mockup's equivalents are the drawer's `Not filed yet` and the dashed `Send to…`, and both are drawn. `citation-chips.tsx` and `conflict-block.tsx` are imported nowhere on this route |
| The drawer's fields are Title · Type · Collection · Origin · Note; the brief expects a status control; the transcript the Source view reads arrives from nowhere | **The mockup's five, plus `Text`.** No status - the mockup has none and a source has no lifecycle to name. `Text` is the body: there is no file ingestion or page fetcher in this repository (either is a dependency and a product call), so the copy is typed or pasted. Flagged |
| The card's snippet, the source's byline and the `src · meta` line are fixture text | **Derived.** Snippet = the body's first paragraph cut to a line (else the note); byline = the note (else the origin); the mono line = `origin · N words` (else the kind). AGENTS.md, "nothing is stored that can be computed" |
| Collections: the mockup lists five with a hue each; it draws no way to make or delete one | **Made by naming, dropped by leaving.** The drawer's Collection select offers the project's, `No collection` and `New collection…` (a name, created with the save, coloured with the least-used of five closed names → `--coll-<name>-h`); the repository prunes a collection when its last source leaves it, in the same transaction. No standalone collection UI |
| `Send to…` has no picker in the mockup; filings are plain spans; nothing unfiles or deletes a clip | **One popover, `_research/clip-menu.tsx`**, from three doors - a washed line in the source, a clip card's `Send to…` or chip, the drawer's clip row: `Filed to` chips with `×`, a find field over present scenes, live characters and live locations (a place already filed is not offered), `Remove clip`. The one addition past the mockup; a clip would otherwise be write-only. Flagged |
| The mockup's `Clips` tab shows `Send to…` only while unfiled | **Kept.** A filed clip's chips open the same menu, so a second filing and unfiling are reachable without a second button |
| The type button cycles the five kinds on click | **A menu** (`FilterMenu`, the shared piece), one click per kind - the shape phases 5 and 6 gave the same control |
| The assistant's Research chips (`Pull clips from this source`, `Which clips aren't filed?`) need the assistant to read sources | **Not added.** "Widen what the AI can read" is an ask-first; the panel keeps its subhead, "Research sources are not readable yet". When that ruling comes, `research_sources.readable` is the per-source gate AGENTS.md already names - not added ahead of it |

### Where the mockup disagrees with the shell

- The mockup's sidebar title is the project's with `+` for `Add source`, and it draws the README's
  search field (`Search sources and clips`). **The mockup's**, through the `Sidebar` slots; the
  field narrows the library (title, origin, note, body) and the clips list (the line), and is not
  drawn while the library is empty.
- The mockup's view pill is a 2px-gap `--s1` pill; the shared text pill (`view-pill.tsx`, from
  the Production mockup) has a 3px gap. **The shared component.**
- The mockup's breadcrumb is `Monsoon Line / Research`, no episode. **`WritingHeader` with
  `route="research"` and no `current`.**
- The source page's title is the mockup's `h1`; the toolbar already carries the route's `h1`.
  **An `h2` at the same 26px/400**, so the smoke test's one-`h1` contract holds.

### What was built

**Shared** - `_chrome/drawer-shell.tsx` (moved from `_characters/`, a `route` prop names the slot;
the Characters copy is a one-line wrapper; the Locations pass took it up the same hour),
`_chrome/find-field.tsx` (`FindProvider`, `FindField`, `useFind`), `_chrome/use-run.ts` (the
save-indicator hook - written by both passes within minutes, one API). Reused from phases 5 and
6 as they stand: `record-sidebar.tsx` (`RecordGroup` gains `empty` and `countAttr`),
`record-toolbar.tsx` (`RecordToolbar.total` takes the mockup's worded chip; `NewButton` takes a
label), `empty-card.tsx`, `view-pill.tsx`, `status-bar.tsx`, `use-dismiss.ts`, the
`folio-drawer-*`, `folio-delete-button`, `folio-line-button`, `folio-menu` classes.

**Tokens** - `--mark` (the mockup's own); `--src-l/c` with `--src-<kind>-h` and `--coll-l/c` with
`--coll-<name>-h`, the two inline hue families transcribed as theme pairs and hue angles;
`--text-14-5` (the card title). Composed in `globals.css` (`.folio-src-hue`, `.folio-src-bar`,
`.folio-coll-dot`) and nowhere else.

**Data** - migration `0019`: `research_collections`, `research_sources`, `research_clips`,
`research_clip_filings`, three enums, RLS on the `0016` pattern. `@folio/contracts` `research.ts`:
the kinds and their labels and glyphs, the five collection colours, `ResearchSourceEditSchema`
(with `ResearchCollectionPickSchema`), `ResearchClipEditSchema`, `ResearchFilingTargetSchema`, and
the read model (`ResearchSourceRow`, `ResearchClipRow`, `ResearchFilingRow`,
`ResearchCollectionRow`); four id brands. `@folio/db` `repositories/research.ts`: every count is
`count(*)`; a scene filing comes back as its node id (`StoredFiling`) and `lib/research/server.ts`
joins it to the scene index. `lib/research/actions.ts`: `addSource`, `saveSource`,
`removeSource`, `clipLine`, `removeClip`, `sendClip`, `unsendClip` - gate → repository → result,
each revalidating the workspace layout. Nothing re-derives; nothing writes a node.

**Body** - `_research/research-workspace.tsx` (toolbar, one of three views or the empty card,
the status bar), `research-toolbar.tsx`, `library-view.tsx` (`minmax(268px, 1fr)`, the 3px hue
strip, the kind badge, `❝ N`, two clamped lines each, the mono line and the collection pill, the
dashed `+ Add source`), `source-view.tsx` (720px; the selection → `❝ Clip this line` pill →
`clipLine`; a washed line is a button to the clip menu), `clips-view.tsx` (860px), `clip-menu.tsx`,
`source-drawer.tsx` (add and edit), `research-sidebar.tsx`, `kind.tsx`, `empty-research.tsx`.
`_chrome/research-layout.tsx` on the Characters layout's pattern; `research/layout.tsx`,
`research/page.tsx`, `research/[sourceId]/page.tsx`. `lib/research/compose.ts` holds the drawer
target and the collection filter as cells the layout and the page share.

**Removed** - `_chrome/project-column-layout.tsx` and `_chrome/project-route-page.tsx` (Research
was their only caller - checked); `CONTEXT_PANEL_WIDTH.research` and the research entry in
`ContextColumn`'s route type; the walk's `column: context` row for the route.

### Judgement calls, flagged

- **A source's kind hue and a collection's dot** are `oklch(L C H)` with `L`/`C` from the theme
  and `H` from the row, composed in three CSS classes. The mockup computes the same string in
  `renderVals`; here the row names a hue token and the stylesheet does the arithmetic.
- **`Paste a link` reads the clipboard** (`navigator.clipboard.readText`) and prefills the origin
  when the browser allows it and the text is an `http(s)` URL; otherwise the drawer opens with
  the origin focused. No fetch of the page.
- **A clip is found again by text**, first occurrence, once per clip, overlapping later clips
  losing. An edited body that no longer holds the line keeps the clip in the list without a
  wash. Offsets were not stored: they go stale on the first edit and the text does not.
- **`_characters/cast-sidebar.tsx`, `characters-toolbar.tsx`, `empty-characters.tsx`** still
  carry their own copies of `find-field.tsx`, `record-sidebar.tsx`, `record-toolbar.tsx` and
  `empty-card.tsx`. Not edited here: that directory was under the Characters pass's hand in the
  same tree. Each is a one-import change.
- **`lib/research/compose.ts` is a typed cell, not `createOpenCell`** - the drawer target carries
  a payload (`new` with an origin, `edit` with an id) and the collection filter is an id. The
  factory could grow a type parameter; left for whichever pass touches it next.
- **A clip filed to a scene that later leaves the script** keeps its filing and reads
  `Scene · not in the script`; the picker offers only present headings. Unfiling it is the
  writer's, through the chip's `×`.

### Not built, by ruling or by absence

- File upload and page fetching for sources; the assistant reading a source (and with it the
  `readable` gate); a per-source status; assistant chips for this route.
- Renaming or recolouring a collection; a collection with no source in it.
- A scene, character or location page listing the clips filed to it (the reverse read).

### Verification

- `pnpm typecheck` (all six), `pnpm lint` (all seven tasks) - clean.
- `pnpm --filter @folio/db db:check` - journal clean with `0019` (generated with placeholder env
  values present; `generate` opens no socket). **Applied** to the dev project with `db:migrate`
  after the Characters pass had applied `0017` and `0018`; recorded in `packages/db/CLAUDE.md`.
- `vitest run tests/research-view.test.ts` - 13 pass; `--environment node
  tests/workspace-routes.test.ts` - 17 pass (jsdom does not start on local Node 22.5.1; the
  known trap).
- `pnpm --filter web build` - clean, both research routes in the manifest, the secret scan clean.
- **`e2e/research-route.spec.ts` - 4 of 4 pass** against the user's `:3000` dev server with a
  throwaway `e2e-research@example.com` account (made through the admin API; password not kept):
  the shell and the empty card in both themes, `?view=grid` a 404, `?view=source` back to the
  library; add a source through the drawer with a new collection and land on its page; the type
  filter; a selection cuts a clip that washes the line, counts `❝ 1 clip` and `0 / 1`, lists in
  Clips with `Send to…`, reads `Not filed yet` in the drawer, and is removed from the mark's
  menu; delete takes the source and prunes its collection; the old URL is a 404. Screenshots in
  `test-results/research-*.png`. Filing itself is not walked - the project has no script, cast or
  set to file to; the menu's empty copy is what the walk checks.

---

## Redesign phase 6 - the Locations route (2026-09-16)

The sixth route rebuilt to the v2 package: `docs/ui design/Route - Locations v2.dc.html` on the
shell phase 1 built, all three views - Places, Scenes here, Sheet - behind the toolbar's text pill,
the edit drawer at `/locations/:uuid`. Built beside the Characters pass (phase 5) in the same
working tree, on purpose the same shape: the two routes share the sidebar slots, the toolbar
pieces, the drawer frame, the card and sheet classes, the empty card and the save indicator, and
differ in content. The mockup's `data()` was read for the shape the UI needs; every derived field
it authors (`kind`, `ieKind`, `metaLine`, `dn`, `first`, `scouted`, the groups) is a pure function
in `lib/locations/view.ts`, tested, over the real rows.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The brief and the README's table say `Grid · Detail`; the mockup's `view` prop is `places \| scenes \| sheet` and it has no Detail view | **The mockup.** Three tabs; "Detail" is the drawer at `/locations/:uuid`, which is where the mockup puts the single place (`drawer: true`). The same reading phase 5 took for `Profile` |
| `?view=` accepted `record \| breakdown \| resolve`; the mockup's tabs are `Places · Scenes here · Sheet` | **The mockup's values.** A param change (AGENTS.md, When to ask first) taken on the brief's authority; `?view=record` now 404s. The breakdown's per-episode cells survive as `perEpisode` counts; the resolve view is the banner's queue |
| Scouting status (`Pending \| Scouted \| Locked`), an address, a photo: no columns | **Migration `0018`, additive on those three.** `location_status`, `locations.status` (default `pending` - what a pass mints), `address`, `photo_key` on the portrait's pattern (R2 through `lib/storage/r2.ts`, gated on `R2_*`) |
| The arc note per episode ("How this place changes", `location_arc_notes`, `0009`): the mockup draws nothing like it | **Dropped, in `0018`.** Its only readers were the route's own loader, action and record view (checked: `lib/locations/*`, `_locations/record.tsx`, the repository, the contracts, the schema) - the `0015` case, not the `revisions` one. The brief asked for removals to be real, not flagged |
| `scheduled_days` and the roll-up's `own_/rollup_shooting_days`: the drawer has no field | **Left in place, out of the edit schema, flagged.** The pure core's derive and its tests read the column (14 files) and AGENTS.md's "how many days in the chawl" names it. A drop is a ruling on the domain, not on the mockup |
| The mockup's `kind` (`Primary set`, `Recurring exterior`, `One-off`) is authored data | **Derived** (`kindOf`): a record with sub-sets is a primary set; one under a parent is `Inside <parent>`; the rest are recurring (with the I/E word), one-off, or the README's `Not on the page yet`. The sidebar's three groups are the kinds, a sub-set filed under its parent's |
| The tree (AGENTS.md: "a location is a tree, not a list") has no surface in the mockup - no Inside / Attach, no sub-set strip | **One field the mockup does not draw:** `Part of` in the drawer, under Type - a primary set of its own, or inside one. The other tree writer is the conflict block's accept. A record's sub-sets read as `Inside X` cards and indent one step in the sheet and the sidebar |
| Conflict blocks (README): the mockup draws none; what disagreement does the model detect? | **The resolve queue's structure proposals.** An open row saying a record reads like part of another (`INT. TANK ROOM` under `Kamathi Chawl`) turns that card's border `--warn` and draws the block: `Move it inside` writes the edge (minting the parent when the headings imply one nobody made), `It's deliberate` records the rejection so the pass never proposes it again. The script is never edited |
| The banner's `Review` has no behaviour | **Unfolds the queue in place** - one row per open slugline: `This is <name>` / `New location` takes the proposal, `Somewhere else…` picks a record or a new one. No `Not a location`: a heading always names a place |
| Merge: the mockup's foot is `Delete` alone; delete is refused while the record is in the script | **Merge lives inside Delete.** On a present record, Delete offers `Still in the script (N scenes). Merge it into another location instead:` with a picker; on an absent one, the confirm. The domain operation stays reachable without a second foot button |
| The alias table (bind / unbind a set text): the mockup's chips are the counted headings | **Kept as drawn, plus its authored half:** a bound set text no heading uses yet is a dashed chip with `×` (never the last one); `+ Bind a set text` opens an input. The only place a writer can see and change what makes `THE CHAWL` and `KAMATHI CHAWL` one record |
| Per-episode distribution: the brief keeps it; the mockup has no episode bars | **The README's `EpisodeBars` under the drawer's meta line, on a series.** Not on the card - the mockup's foot is the meta line and the cast, and it is kept |
| The `⌖` over the tile: the mockup draws its gradient as the photo's stand-in with the glyph on top | **Not drawn over a real photograph.** The gradient is the tile with no photo in the mockup's terms; here that state is the dashed inset with the glyph and `Drop a photo` (dropped on the card, it uploads, with storage) |
| The mockup's `kind` groups the sidebar as `Primary set · Recurring · One-off` | **Those three, plus `Not on the page yet`** for records the script no longer holds - AGENTS.md's "0 appearances · record kept" needs a row |

### Where the mockup disagrees with the shell

- The mockup's sidebar title is the project's with `+` for `New location`, and it draws the
  README's search field (`Find a location or slugline`). **The mockup's**, through the `Sidebar`
  slots phase 5 added; the field narrows the list by name, counted heading or bound set text.
- The mockup's breadcrumb is `Monsoon Line / Locations`, no episode. **`WritingHeader` with
  `route="locations"` and no `current`**, as phase 5 built it.
- The assistant's chips name the selected place (`Describe Kamathi Chawl`); the panel is the
  shell's and cannot see the drawer. **`Describe a location from its scenes`**; the other two
  verbatim.

### What was built

**Shared** - `_chrome/record-sidebar.tsx` (`RecordTitleRow`, `RecordGroup`, `SidebarNote`,
`ProgressWidget` - the pieces `_characters/cast-sidebar.tsx` wrote for one route, generalised),
`_chrome/record-toolbar.tsx` (`RecordToolbar`, `FilterMenu`, `NewButton`),
`_chrome/empty-card.tsx` (the README's 440px card), `_chrome/status-tabs.tsx` (the drawer's
segmented control), `_chrome/drawer-parts.tsx` (`SectionHead`, `DrawerNotice`),
`lib/workspace/open-cell.ts` (the `New <record>` drawer's cell as a factory;
`lib/locations/compose.ts` is one), `lib/storage/image.ts` (the portrait's byte sniff, for both
image uploads). Reused from phase 5 as they stand: `_chrome/drawer-shell.tsx` (with `locations`
in its route union), `find-field.tsx`, `citation-chips.tsx`, `conflict-block.tsx`, `use-run.ts`,
`view-pill.tsx`, `status-bar.tsx`, the `folio-cast-*`, `folio-sheet-row`, `folio-drawer-*`,
`folio-status-tab`, `folio-delete-button` classes, `CastMark`, `EpisodeBars`.

**Tokens** - `--set-hue` with `--set-a/b/c` (the mockup's `grad(hue)`, three lightnesses per
theme, a hair off the Characters stops so not reused), `--set-glyph`, `--set-mark-ink`.

**Data** - `LocationRow` is one shape for every view (`@folio/contracts`): the record, its kind,
counts, status, address, photo URL, counted and bound sluglines, scenes with cast and eighths,
people, per-episode counts, first / last, the rename's heading count, its open conflicts.
`LocationRecordView`, `BreakdownRow`, `BreakdownCell`, `LocationEpisodeBar`, the arc-note types
and `ArcNoteEditSchema` go. `loadLocations` reads eight statements once for every row;
`loadSelectedLocation` is the tombstone redirect. `setLocationPhotoKey` in `@folio/db`;
`uploadLocationPhoto` / `removeLocationPhoto` in `lib/locations/actions.ts`; `saveLocation`
takes `address` and `status`.

**Body** - `_locations/locations-workspace.tsx` (toolbar, one of three views or the empty card,
the status bar, the drawer), `locations-toolbar.tsx`, `places-view.tsx` + `location-card.tsx`
(`minmax(248px, 1fr)`, the 16:10 tile, the conflict block, the cast stack, the dashed `+ New
location` tile), `unmatched-queue.tsx`, `scenes-view.tsx` (1080px sections, `E1 · 1`, the light
square, the heading over the synopsis, the eighths), `sheet-view.tsx` (900px, the mockup's seven
columns, one step of indent per depth), `location-drawer.tsx` + `location-fields.tsx` +
`new-location-drawer.tsx`, `location-sidebar.tsx`, `set-parts.tsx` (the tile, its foot, the sheet
mark, the badge, the cast stack), `empty-locations.tsx`. `_chrome/locations-layout.tsx` on the
Characters layout's pattern; `locations/layout.tsx` is one line.

**Removed** - `location-nav.tsx`, `record.tsx`, `record-panel.tsx`, `breakdown.tsx`,
`resolve-queue.tsx`, `day-night-bar.tsx`; `enterLocations`; the Locations context column
(`CONTEXT_PANEL_WIDTH`, `ContextColumn`'s route type, `ProjectColumnLayout`'s find placeholder);
`listLocationArcNotes`, `writeLocationArcNote`, `saveArcNote`, the merge's arc-note CTE.

### Judgement calls, flagged

- **`_characters/drawer-shell.tsx`, `cast-sidebar.tsx`, `characters-toolbar.tsx`,
  `empty-characters.tsx` and `profile-fields.tsx` still carry their own copies** of the pieces
  now in `_chrome/` (the drawer frame is already the shared one behind a one-line wrapper). Each
  is a one-import change for the Characters pass, which was in flight in the same tree; not made
  here to avoid editing files under someone else's hand. `lib/characters/actions.ts`'s portrait
  sniff is the same story (`lib/storage/image.ts`).
- **The card and sheet classes are named `folio-cast-*`** and serve both routes. A rename to
  `folio-record-*` is cosmetic and waits for both passes to land.
- **A sub-set's card counts its own scenes; its parent's counts the roll-up**, so a scene is on
  two cards and under two sections of `Scenes here`. That is what "counted in the parent total"
  means, and the sheet's `Scenes` column reads the same way.
- **A location's hue is a hash of its id** (`hueOf`); the mockup authors one per place. Stable
  across visits, distinct between records, nothing to edit.
- **`New location` writes twice** - `createLocation` (the record, its name bound, the parent)
  then `saveLocation` for the address, description and status when any is set. One statement
  each; a record is never left half-made because the second refused.
- **The empty card's paragraph counts distinct headings from the speculative pass**
  (`derivable.sluglines`), the mockup's `15 sluglines across 9 distinct places`.

### Not built, by ruling or by absence

- A location report; scheduling; any use of `scheduled_days`.
- A photo on the `Scenes here` rows or the sheet (the mockup draws the gradient mark only).
- The assistant reading a location's record (it still reads the script alone).

### Verification

- `pnpm --filter @folio/contracts typecheck`, `pnpm --filter @folio/db typecheck` - clean.
  `apps/web` `tsc` - clean outside the Research pass's in-flight files (theirs, this tree).
- `pnpm --filter @folio/db db:check` - journal clean with `0018` (generated with placeholder
  env values present; `generate` opens no socket). **Applied** to the dev project - by the
  Characters pass's `db:migrate` run for `0017`, which took every pending entry; so
  `location_arc_notes` is gone there and the three columns exist.
- `vitest run --environment node tests/locations-view.test.ts tests/locations-figures.test.ts
  tests/workspace-routes.test.ts` in `apps/web` - 41 pass. New: `tests/locations-view.test.ts`
  (17).
- `eslint` over every file this phase touched - clean. `pnpm build` not run: the Research pass's
  files do not compile yet in this tree.
- `e2e/locations-route.spec.ts` rewritten to the v2 contract (`data-location-card`,
  `data-card-kind`, `data-unmatched-*`, `data-conflict-*`, `data-location-drawer`, the sheet and
  scenes rows, the `Scouted` widget) and **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` here. A
  browser check of the three views in both themes, the drawer's save and rename, a photo drop
  with `R2_*` set, and the conflict block's two buttons is the next thing a human should do.

---

## Redesign phase 5 - the Characters route (2026-09-16)

The fifth route rebuilt to the v2 package: `docs/ui design/Route - Characters v2.dc.html` on the
shell phase 1 built, all three views - Cast, Relationships, Sheet - behind the toolbar's text pill,
the edit drawer at `/characters/:uuid`. The mockup's `data()` was read for the shape the UI needs;
every derived field it authors (`perEp`, `first` / `last`, `group`, the conflict, the graph's
positions) is a pure function in `lib/characters/cast.ts`, tested, over the real rows.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The README's table says `Cast · Profile`; the mockup's `view` prop is `cast \| relationships \| sheet` and it has no Profile view | **The mockup.** Three tabs; "Profile" is the drawer at `/characters/:uuid`, which is where the mockup puts the single character (`drawer: true`) |
| `?view=` accepted `overview \| relationships \| casting`; the mockup's tabs are `Cast · Relationships · Sheet` | **The mockup's values.** A param change (AGENTS.md, When to ask first) taken on the spec's authority; `?view=overview` now 404s as any unknown value does. Flagged |
| Status (`Draft \| Defined \| Locked`), `Wants`, `Needs`: no columns - `0013` dropped `wants` / `needs` with the first profile on the client's ruling | **Migration `0017`, additive.** The v2 package is the newer ruling and draws the three; only those three come back - no sources, no flaw, no arc turns |
| `Principal \| Supporting` in the sidebar: `0013` dropped the `group` column too | **Computed, not a column.** A principal has at least a fifth of the lead's scenes (`PRINCIPAL_SHARE`); the rest on the page are supporting; a record with no scene sits under the README's own `Not on the page yet`. The mockup's six come out as drawn. A judgement |
| `Arc · from the script`: the mockup's rows are authored prose per ref, the last amber as "unwritten" | **The character's scenes, ref and heading** - what the eyebrow claims and the model holds; first six, `+ n more scenes`. No prose is invented, no amber row |
| Conflict blocks (README): the mockup draws none; what disagreement does the model detect? | **The resolve queue, per record.** An open cue whose proposal names a record (`MIRA` reads like Meera) turns that card's border `--warn` and draws the block: `It's Meera` binds the spelling, `It's deliberate` rejects that one candidate (a new `resolveCue` choice, `not-this`). The script is never edited |
| The banner's `Review` has no behaviour in the mockup | **Unfolds the queue in place** - one row per open cue with the second pass's three answers. The ghost cards go |
| The graph's nodes are hand-placed (`x: 38, y: 48`) | **A deterministic force layout** (`graphLayout`): repulsion, attraction by shared scenes, gravity, 240 fixed steps; the same cast draws the same picture. The dashed `never share a scene` edge is drawn between principals only; the finding names the busiest such pair, and its second line says what can be counted, not the mockup's story prose |
| The sidebar's `Find a character` and the toolbar's `All characters ▾` have no behaviour | **Both real.** The field narrows the sidebar's groups (a context the layout wraps the card in); the menu filters the cast and the sheet by group or status. Component state |
| The drawer is a sibling of `<main>` in the mockup, full height; the drawer is the page's and a page renders inside the surface | **A portal** into a slot the layout leaves after the column (`#characters-drawer`); `New character` is nobody's page and mounts in the layout, opened through `lib/characters/compose.ts` from its three doors. The shell learns a drawer is open through `lib/workspace/drawer.ts` for the README's forced-closed rule |
| Gender, the colour picker, appearance, the alias table, merge: the second pass's drawer controls, not in the v2 drawer | **The surfaces go; the actions stay.** The colour is chosen at creation (least used of the ten). Flagged - a colour cannot be changed from the UI now |

### Where the mockup disagrees with the shell

- The mockup's sidebar title is the project's with `+` for `New character`, and it draws the
  README's search field; the writing sidebar has neither. **The mockup's, through two new
  `Sidebar` slots** (`title`, `find`) - the route is project-scoped, so no episode row.
- The mockup's breadcrumb is `Monsoon Line / Characters`. **`WritingHeader` learns a
  project-scoped mode** (no `current` episode: no episode menu, no pill).
- The README says the status is "a dot in lists, a pill on detail pages"; the mockup's card
  draws a small bordered badge. **The badge**, in the status tone; the sheet has the pill.

### What was built

**Shared** - `@folio/ui`'s `EpisodeBars` (14×4, `--ink2` at 60% of the peak, `--ink3` below,
`--line2` absent, `E1 28 · E2 24` in the title - Locations and Research reuse it), `search` in
the icon set; `_chrome/citation-chips.tsx` and `_chrome/conflict-block.tsx` (the README's two
patterns, for every record route); `_chrome/characters-layout.tsx` on Production's pattern;
`_chrome/sidebar.tsx` (`title`, `find`, `label` slots), `_chrome/writing-header.tsx`
(project-scoped), `_chrome/view-pill.tsx` (a project route path), `_chrome/project-shell.tsx`
(reads the drawer cell), `_chrome/assistant-panel.tsx` (the Characters subhead and three chips;
the first says "a character" - the panel cannot see the drawer's record).

**Tokens** - `--chip-N-h` (the hue angle of each `--chip-N`, so the flat chip and the gradient
mark are one colour), `--cast-l1..3` / `--cast-c1..3` (the mockup's `grad()` stops, per theme),
`--cast-face-*` / `--cast-scrim-*` (ink and scrim over a real portrait), `--dot` (the graph
ground, the mockup's own value - fainter than the Storyboard's `--grid-dot`).

**Data** - `0017`: `character_status`, `characters.status` (default `draft`), `wants`,
`needs`. `CastRow` carries the three; `CharacterProfileEditSchema` accepts them.
`loadCharacters` adds `index` (every scene as a ref - the join for the bars, `First` / `Last`,
the arc) and `derivable.top` (the empty card's three busiest cues). `resolveCue` gains `not-this`.

**Body** - `_characters/` rewritten: `characters-workspace.tsx` (toolbar, view, status bar,
drawer), `characters-toolbar.tsx` (the pill, the filter menu, `＋ New`), `cast-view.tsx` (the
banner, the `minmax(212px, 1fr)` grid, the dashed tile), `character-card.tsx` (the 4:5 face -
portrait with scrim, or the dashed inset with the 42px/200 initial and `Drop a reference`, a
real drop; the badge; the three-line description; `N scenes` beside the bars; the conflict
block), `unmatched-queue.tsx`, `relationships-view.tsx` (the 540px ground, SVG edges, `N sc`
labels at 38%, node pills, the finding), `sheet-view.tsx` (the 880px table at the mockup's
widths), `character-drawer.tsx` and `new-character-drawer.tsx` over `drawer-shell.tsx` (the
400px panel, portal, Escape) and `profile-fields.tsx` (Name, Role / Age, Description, the
status control, Wants, Needs), `cast-sidebar.tsx` (title row, find, groups, `Defined`),
`cast-mark.tsx` (the gradient mark at every size), `empty-characters.tsx` (the README's 440px
card, the mono cue block, `✦ Derive N characters` / `＋ By hand`, the caveat verbatim).
`globals.css` gains the route's block.

**Removed** - `casting-table.tsx`, `character-form.tsx`, `chip.tsx`, `new-character-modal.tsx`,
`overview-grid.tsx`, `portrait-tile.tsx`, `relationships.tsx`, `unmatched-card.tsx`,
`lib/characters/graphs.ts` (the three older graphs) and their tests.

### Judgement calls, flagged

- **`db:migrate` applied `0018` too.** The Locations pass had journaled `0018_locations_v2`
  (with its `DROP TABLE location_arc_notes`) before this phase's migrate ran, and drizzle-kit
  applies every pending entry - there is no one-at-a-time. `0017` and `0018` are on the dev
  project; `0019` is not. Recorded in `packages/db/CLAUDE.md`.
- **The drawer's first paint is a client paint** - a portal needs its slot, which exists after
  hydration. A fresh load of `/characters/:id` shows the grid, then the drawer.
- **Only the first conflict is drawn on a card**, with `+ n more in the queue`; the banner's
  `Review` lists them all.
- **`shortName` takes the first word**, or the second past an article (`The Driver` → `Driver`);
  the mockup authors `Suresh Kadam` → `Kadam`, which no rule recovers.
- **`No description yet.` / `No role yet`** in `--ink3` where the mockup's data is never empty.
- **The status bar's route id is `characters/<uuid>`**, the mockup's `/characters/meera`
  with the real id.
- **`Drop a reference` is drawn only with storage configured**; without it the face has no hint
  and no drop, and the drawer's `Upload reference` is disabled with the reason.
- **The `Defined` bar counts `defined` and `locked` together**; the note reads `N still drafts`.

### Not built, by ruling or by absence

- A Profile view (none in the mockup). Presence, `Read`, `Help` - as every phase.
- Generate (the look-sheet job): no worker. A way to change a record's colour, gender or
  appearance notes, bind an alias by hand, or merge two records - the actions exist, the v2
  drawer has no control for them.
- The Locations and Research episode bars: the component is shared; those routes' passes draw it.

### Verification

- `tsc --noEmit` in `apps/web` - clean for every Characters file; the remaining errors are the
  Locations pass in progress in the same checkout (`_locations/`, `lib/locations/`,
  `tests/locations-*`), which also stops `next build` (eight `Export … doesn't exist` errors, all
  in `_locations/`). `@folio/contracts`, `@folio/db`, `@folio/ui` - clean. `eslint` - clean on
  every touched file.
- `vitest run --environment node tests/characters-cast.test.ts tests/characters-figures.test.ts
  tests/workspace-routes.test.ts` - 43 pass. New: `tests/characters-cast.test.ts` (16).
- `drizzle-kit check` - journal clean; `0017` applied (see above).
- `e2e/characters-route.spec.ts` rewritten to the v2 contract (`data-card-name`,
  `data-card-status`, `data-episode-bars`, `data-conflict`, `data-unmatched-row`,
  `data-status`, `data-defined-count`, the sheet, the filter) and **unrun** - no `E2E_EMAIL` /
  `E2E_PASSWORD` here. `e2e/workspace.spec.ts` gains the `card` column kind. A browser check of
  the three views in both themes, the drawer at both breakpoints, a drop on a card and the
  conflict block is the next thing a human should do.

---

## Redesign phase 4 - the Production route (2026-09-16)

The fourth route rebuilt to the v2 package: `docs/ui design/Route - Production v2.dc.html` on the
shell phase 1 built, over the backend the Production phase left (`lib/production/`, migration
`0014`). The first route outside the writing surface to be rebuilt, so the first to wear the
shell's sidebar and header without the mode pill, and the first with the README's status bar.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The brief and the README's file table name the views Shots · Frames · Reels; the mockup's switcher is Scene \| Episode, with Shots, Frames and In this reel as the three columns of a reel card, and `?view=` already accepts `scene \| episode` | **Scene \| Episode, as the mockup draws it** (the client, asked, delegated: "do whatever is needed"). The three columns are built in full; changing what `?view=` accepts is AGENTS.md's "ask first" and was not taken |
| The mockup declares `--bad` / `--bad-bg`, a fifth hue (red) the README's "No other hues" does not allow, for a refused shot, its tile, and an overrun | **Transcribed verbatim** as the Production route's tokens in `palette.css`, three-block, with the timing bar's four segment colours beside them. The mockup is the spec for its route; nothing outside it may reach for `--bad` |
| The mockup draws the Write / Storyboard pill in Production's header; the README says it was removed there | **The README wins** (the brief said the same): no pill, and the breadcrumb grows the route's title as its third crumb |
| The mockup prints `Generating 62%`; `jobs` has a status and no progress column, and no worker | **No percentage.** The tile prints `Generating` with an indeterminate bar and takes a percentage in its view model (`FrameTile.progress`), so a `jobs.progress` column is one wire-up. Adding the column is a schema change and was not taken |
| `Suggest rewrite` on a refused shot; the assistant is read-only | **Opens the assistant with the refusal as the question** (`useEphemeral().assistantPrompt`, consumed once by the panel). The assistant answers; the writer edits the shot. Nothing the AI reads or writes widened |

### Where the mockups disagree with the README, and with the data

- The mockup's shot chips read `Wide · push in · eye level`; the vocabulary is the pure core's
  closed set, so the chips print its names - `Wide shot · Static · Eye level`.
- The mockup sets a spoken line in full ink, italic. The description model has text and mention
  runs and no quote run, so `quotePieces` splits a text run at a pair of double quotes,
  straight or curly - a presentational parse; an unclosed quote stays text.
- The mockup's `Compare` has no model behind it; it lays the shot's drawn takes out under the
  tile, the kept one marked, and a click brings that take into view. Component state.
- "Top up to continue" is copy. No billing exists; the sentence says what would fix it.
- The cast tile's `17 · lead` is `CastRow.age · role`; a record with neither reads
  `in this scene`. The location line is the heading's resolved record, else the heading's set
  with "Not on the page yet".

### What was built

**Tokens** - `--bad`, `--bad-bg`, `--seg-1..4` (`palette.css`); `--color-bad`, `--color-bad-bg`,
`--color-seg-*`, `--text-26` for the stat tiles' 26px/300 figure (`theme.css`).

**Shell** - `_chrome/writing-header.tsx` takes an explicit `route` (a layout that is the route
knows it; the segment hook cannot see it from there), draws the pill only for a writing route,
and adds the third crumb. `_chrome/sidebar.tsx` takes `slots` - a route's own group and widget -
and draws them in place of the three rows and the segment-driven group, reading nothing the
route does not need. `_chrome/view-pill.tsx` is the toolbar's view switcher for every route with
sub-views (icon shape for the Storyboard, text shape here; `UrlObject` hrefs so typed routes take
a query on a dynamic path from a generic component). `_chrome/status-bar.tsx` is the README's
28px bar: counts, Hide/Show nav, the save dot, the mono route id. `_chrome/production-layout.tsx`
composes the four; the two `production/page.tsx` files render `_production/production-route.tsx`.

**Body** - `_production/`: `production-workspace.tsx` (the rows, every write, the geometry),
`production-toolbar.tsx` (name, count chip, the pill, `720p ▾` over `render_resolution`, the
credits chip), `scene-view.tsx` (the strip, the orphan strip, the empty card, the reel cards),
`reel-section.tsx` (header with rename, timing bar, clip lengths, status pill, Render, `⋯`;
the three columns; the gate box), `shot-row.tsx` (number, seconds, chips, description with
mentions and quotes, the proposal row, the refusal block, `↑ ↓ ✕`, the Storyboard's editor in
place), `frame-tile.tsx` (one per shot in shot order, the caption row, takes with Keep and
Compare), `in-this-reel.tsx`, `episode-view.tsx` (four tiles, the table), `sidebar-slots.tsx`,
`mark.tsx` (the mockup's text glyphs kept as text). `lib/production/view.ts` is the mockup's
`data()` over rows - every label, tone and count, pure, `tests/production-view.test.ts` (19);
`lib/production/coverage.ts` the cell the sidebar reads, on `lib/storyboard/coverage.ts`'s shape.
`status.ts`'s three sentences moved to the v2 mockup's (`describeReason`: generating, blocked,
rendered) with `remaining` and `frames` on their reason codes.

**Counts** - one derivation. `episodeStats` + `coverageRows` over the same `scenes` state feed the
toolbar chip, the sidebar rows and widget, the strip dots, the four tiles, the table and the
status bar; the credits chip and every cost label read `balance.available` and the two placeholder
constants. Nothing on the page is hardcoded and nothing is stored.

**Assistant** - Production's subhead and three chips (`assistant-panel.tsx`), verbatim; the
one-shot prompt (`lib/state/ephemeral.tsx`).

### Every state, and how to reach it

| State | Where | From |
| --- | --- | --- |
| No script | the 440px card | an episode with no screenplay document |
| No scenes | the same card, its second copy | a script with no heading |
| Empty scene | the dashed card with `✦ Propose shots from scene` / `＋ Empty reel` | a scene with no reel |
| Orphans | the strip over the reels | `scene.unreeled` accepted shots |
| Writing shots | reel pill `--s2`; reason names the shot | an accepted shot with no description, or none at all |
| Proposed | amber dashed row, `Proposed from the scene · Accept · Discard`, a `Proposed` tile | `shots.state = proposed` in the reel |
| Ready | `✦ Generate N frames · C cr` live | every accepted shot described, none in flight |
| Needs credits | reason in `--live`, Generate off, credits chip orange | pending × cost > balance |
| Queued / Generating | accent pill `Generating frames`, tile `◐ Queued` / breathing `Generating` with the sliding bar, `Stop generating` | a `queued` / `running` job |
| Blocked | red row with the refusal and `Suggest rewrite`, red tile `Can't render — Rewrite shot N`, red pill | a `blocked` job on a shot not edited since |
| Failed / Cancelled | live `Failed · refunded` / `Cancelled · awaiting frame` tiles | the job row |
| Done | the picture, `take i of n ◂ ▸ Keep Compare` | a drawn generation |
| Frames done | green pill, Finalize live | every frame drawn, the clip filled exactly |
| Finalized | green pill, Unlock, Render live | `finalized_at` set |
| Rendering | accent pill, `Rendering… · stop` | a render job in flight |
| Rendered | green `Rendered · view` pill and button, both the clip's link; `Regenerate` off with its title | a rendered clip |
| Overrun | red tail on the timing bar, red `12 / 8 s` | shots longer than the clip |

### Judgement calls, flagged

- **The credits chip turns orange for the selected scene**, not the episode: the mockup's
  `noMoney` is one reel's shortfall. The same rule lights the `Needs credits` tab dot.
- **A proposal's tile reads `Proposed · Accept the shot to generate`** in amber; the mockup has no
  tile state for a proposal (its proposed shot carries a `needs` tile).
- **`Regenerate frames` on a finalized or rendered reel is drawn and off**, its title saying to
  unlock first: the gate refuses a write to a locked reel and the mockup draws the button live.
- **`Stop generating` cancels every in-flight frame of the reel**; the mockup has no stop.
- **The status bar's last word is the first reel's status**, or `No reels`; the mockup's
  `reelStatus.label` is one reel's.
- **The empty card's `✦ Propose shots from scene` is two writes** - a reel, then a proposal for
  it - because a proposal needs a reel to land in.
- **The shot's `↑ ↓` are off on a proposal**: the server orders accepted shots.
- **The Storyboard's shot writes return rows without takes**; the workspace carries the takes in
  hand over by id (`mergeShots`) rather than re-reading the scene.

### Not built, by ruling or by absence

- A progress percentage (no column); presence avatars; the `Read` button.
- Billing behind "Top up"; a worker to move a queued job.
- A `progress` column, a compare model, a quote run - each named above.

### Verification

- `pnpm --filter web typecheck` - clean for this route's files. (The working tree also carries
  the concurrent Storyboard pass; its `tests/storyboard-board.test.ts` was mid-edit while this
  was checked and is not this phase's.)
- `pnpm lint` - 7 of 7 clean.
- `vitest run --environment node tests/production-view.test.ts tests/production-status.test.ts`
  - 40 pass.
- `pnpm --filter web build` - blocked at check time by the concurrent pass's in-flight
  `packages/contracts/src/index.ts` (`CHARACTER_STATUSES` re-export), not by this route.
- `e2e/production-route.spec.ts` written to the v2 contract and **unrun** - no `E2E_EMAIL` /
  `E2E_PASSWORD` here; `e2e/workspace.spec.ts`'s Production assertion moved from the old context
  column to the sidebar's group. A browser check of both views, every tile state and both themes is
  the next thing a human should do.

---

## Redesign phase 3 - the Storyboard route (2026-09-16)

The third route rebuilt to the v2 package: `docs/ui design/Route - Storyboard v2.dc.html` on the
shell phase 1 built, all three views - Board, Canvas, List - behind the toolbar's icon pill. The
mockup's `data()` was read for the shape the UI needs; every derived field it computes (the
scene's status dot, the shot count, `Boards drawn 1 / 3`, `2 shots waiting on a frame`) is a pure
function in `lib/storyboard/board.ts`, tested, over the real rows.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The sidebar's second group and its widget: the mockup draws `Boards` (dot · `Scene NN` · slug · count) and `Boards drawn N / M`; the shell draws `Scenes` and Credits | **The route's, both** - the README says "one summary widget pinned to the bottom (coverage, budget - whatever that route counts)". `sidebar-group.tsx` gains a `storyboard` branch and the widget is a Client Component of its own (`sidebar-widget.tsx`) choosing by segment. Live through a published cell (`lib/storyboard/coverage.ts`, the Outline TOC's shape); seeded by `readBoardCoverage`, one statement of counts, not the three-statement board |
| The mockup's card has no buttons and no drawer prop; where is a shot edited? | **In place.** A card opens into the editor (the Scenes ruling: detail in place); its footer is the README's drawer footer - Remove / Discard left, `Draw frame · N cr` / Cancel frame / Accept beside Cancel and Save |
| The card is `cursor: grab` | **Real drag.** Native HTML5 drag reorders a shot in its scene through a new `placeShot` action (drop at an index); no dependency. The canvas node's `⋯` has Move left / right for the keyboard path |
| `Group: Scene ▾` | **Not drawn.** Shots group by scene and by nothing else - a shot hangs off a heading - and a menu with one row is a placeholder (phase 1's rule for Help). Flagged; grouping by location is a later question |
| `All shots ▾` and the display-options button | **Real.** A filter over the same rows in every view (all · with a frame · waiting on a frame · proposed) and two toggles (descriptions, frames). Component state - a way of looking, not an address |
| `+ New scene` at the end of the board | **A link to the script.** A scene is a heading and is written there and nowhere else; a button that created one here would make the board authoritative |
| `Auto board` on a scene that already has shots (the mockup only draws it in the empty column) | **A small foot button beside `+ New shot`.** The proposer is per scene and re-proposing replaces only what is still waiting |
| Shot states: the mockup has `drawn | queued`; the rows have seven frame states plus `proposed` | **The real state, in the mockup's places.** The node's mono label reads `no frame · queued · drawing · drawn · failed · refused · cancelled · proposed`; dots follow the README's strict colour - drawn green, failed or refused orange, a proposal amber (a decision waiting), the rest `--ink3`. A refusal's reason is printed on the card and the node, never only in a tooltip |
| The count and saved dot: the mockup's toolbar has neither | **Carried, between the pill and the buttons**, as phase 1 moved `104 pp · saved` into the Script's toolbar row. On the canvas it names the scene: `Scene 01 · 3 shots · saved` |

### Where the mockup disagrees with the shell

- The mockup's sidebar rows read `Outline · prose`, `Scenes · 3`, its title is the project's, and
  its `+` is titled `New shot`. **The shell's, unchanged** - the Script wins on chrome (phase 2's
  ruling): `N acts` / `—`, the episode's title row, `+` is `New episode`. `New shot` lives at the
  column's foot and on the canvas.
- The mockup draws presence avatars and `Read` in the header. **Not built**, as ruled in phase 1.

### What was built

**Shared** - `_chrome/use-dismiss.ts` (the click-outside / Escape hook the Script's and Outline's
toolbars each carried a copy of; both now import it). `_chrome/sidebar-group.tsx` (`Boards`),
`_chrome/sidebar-widget.tsx` (Credits or `Boards drawn`), `_chrome/sidebar.tsx` (reads
`readBoardCoverage` in parallel). `_chrome/assistant-panel.tsx` (the Storyboard subhead and its
four chips, verbatim; the model still reads the script, as the Outline ruling). Four icons
transcribed from the mockup's toolbar (`board`, `canvas`, `list`, `sliders`). The view pill is
the shared `_chrome/view-pill.tsx` the Production pass extracted the same day (icon shape here,
text shape there); its two shapes' CSS (`.folio-view-pill`, `.folio-view-pill-tab`) landed with
this route - the two passes ran in one checkout at once, and this record names what each wrote.

**Tokens** - the mockup's six route tokens (`--frame-a/-b`, `--frame-ink`, `--frame-grid`,
`--grid-dot`, `--shade`) with their light values, in `palette.css`'s three-block shape;
`--frame-a/-b` leave the alias block, where the older Storyboard's guessed values sat. Two named
from the mockup's inline badge (`--frame-badge`, `--frame-badge-ink`).

**Data** - `BoardCoverageRow` in `@folio/contracts`; `readBoardCoverage` in `@folio/db`
(accepted, proposed and drawn per present scene, with the reading's `ie` and `set`, one
statement, the frame chosen by the same kept-else-latest precedence `readFrames` uses);
`placeShot` in `lib/storyboard/actions.ts`. The slug under `Scene NN` is the reading's
`INT./EXT. + set` without the time of day (`sceneSlug`), as the mockup prints
`EXT. COMMUNITY PITCH · DUSK`; a heading that did not read prints as written.

**Body** - `_storyboard/storyboard-workspace.tsx` rewritten: one container owning the rows, the
selection, the filter, the display toggles, the save state and every write; three layouts over
`ViewProps` (`handlers.ts`): `board-view.tsx` (340px columns, the 104×59 tile, drag, the
in-place editor, the empty column, `+ New scene`), `canvas-view.tsx` (306px nodes on the dotted
ground, the 158px frame with its badge, tag and mention chips, `Generate · N cr` / `⋯`, the link
lines, `+ Add shot node`, the zoom pill - a CSS scale with `Fit` computed from the ground's width),
`list-view.tsx` (the 1020px table at the mockup's column widths, sticky eyebrow header, group
rows that fold and select). `shot-parts.tsx` holds what the three share: the frame tile at its
three sizes, the description with mention chips, the editor, the empty block. The toolbar is
`storyboard-toolbar.tsx`. The empty states are the README's 440px card. `globals.css` gains the
route's block.

**Removed** - `scene-column.tsx`, `shot-canvas.tsx`, `shot-list.tsx`, and the old header,
subheader and status bar (the writing routes have none).

### Judgement calls, flagged

- **The empty-state card has no AI action.** The README's pattern pairs an accent AI action with
  a manual one; there is nothing to propose over a script that does not exist, so the card has
  `Open the script` alone and its caveat line.
- **A column's chevron folds it**; the mockup draws the chevron at 45% opacity and gives it no
  behaviour. Same on the list's group rows.
- **A proposal's card has a `--warn` dashed border** and `Proposed ·` in its eyebrow; the mockup
  has no proposals. The `N proposed · accept or edit` bar with `Accept all` sits above them on
  `--warn-bg`.
- **The frame tile's other five states** print the state in mono inside the dashed tile, in
  the shot's tone; the card and node also print the reason line (`Refused: …`, `Queued · 4
  credits reserved…`).
- **`Boards drawn` counts scenes with at least one accepted shot**, `waiting` accepted shots
  without a drawn frame - the reading that makes the mockup's `1 / 3` and `2 shots waiting` come
  out of its own data.
- **The sidebar reads the board's coverage on every writing route** (one statement, in parallel
  with its other reads), as it reads the outline's headings - a layout cannot see the route.
- **The drop indicator is a 2px accent line** above the card the drag will land before, or at
  the list's foot. Not in the mockup.
- **The list's rows are read-only**, as the mockup draws them; a group row selects the scene.

### Not built, by ruling or by absence

- `Group: Scene ▾`. Presence avatars, the `Read` button.
- A worker: `drawn` is drawable from the row shape and reachable by no job yet (`apps/worker` is
  empty on purpose), so every frame today is `no frame`, `queued` or `cancelled`.
- A shot drawer at the shell (no mockup draws one).

### Verification

- `pnpm exec turbo run typecheck --force` - 6 of 6. `pnpm lint` - 7 of 7 clean.
- `pnpm --filter web build` - clean, secret scan clean.
- `vitest run --environment node tests/` in `apps/web` - 336 pass; the 7 that fail are the same
  three jsdom files as phases 1 and 2 on local Node 22.5.1. New: `tests/storyboard-board.test.ts`
  (10).
- `e2e/storyboard-route.spec.ts` rewritten to the v2 contract (`data-view-tab`,
  `data-board-row`, `data-boards-drawn`, the in-place editor's `data-draw-frame` / `data-cost`,
  the `⋯` menu, the zoom pill) and **run, 5 of 5**, against the user's `:3000` dev server with
  a throwaway account created through the Supabase admin API (`e2e-storyboard@example.com`,
  password in the session transcript only; flagged for deletion with the earlier `e2e-*`
  accounts). Both themes screenshotted for each view; the drag, the filter, the credits refusal,
  the reservation, the cancel and the sidebar's live `Boards` all walked. Two things the walk
  found: the credits fixture assumed `packages/db/.env`, which this checkout lacks (it now
  falls back to `apps/web/.env`), and the old spec's `[data-nav-meta="storyboard"]` assertions,
  stale since phase 1 removed the sidebar row. One run was broken mid-walk by the concurrent
  Production pass's file saves reloading the dev server; the rerun was clean.
- **Not mine, and red at the end of this pass:** `_chrome/view-pill.tsx` (a typed-route error
  on its generic `?view=` href) and `lib/production/view.ts` / `packages/db/src/schema/derived.ts`
  (`CHARACTER_STATUSES`) - the Production pass's files, mid-edit in the same checkout.

---

## Redesign phase 2 - the Outline route (2026-09-16)

The second route rebuilt to the v2 package: `docs/ui design/Route - Outline v2.dc.html` on the
shell phase 1 built. The Outline mockup is the Script mockup's shell with a different body,
sidebar group, toolbar and menu rows; where the two mockups disagree on chrome the Script's wins
(AGENTS.md, Feature workflow), and that decided two things below.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The toolbar's title reads `Outline · Draft 2`; the outline has no draft number, only `versions` rows | **`Draft N`, N = manual snapshots + 1.** A `⌘S` snapshot ends a draft; the title menu lists the snapshots under a `Drafts` eyebrow. Empty: `Untitled outline` |
| The `⋯` button is titled `Export outline`; nothing exported an outline | **Snapshot now, Export as Markdown, Undo**, then the statistics. Markdown is built client-side from the block list (`lib/outline/markdown.ts`, pure, tested); no server work |
| The assistant subhead and chips are outline-specific; the ruling is a chat over the script | **Script only for now.** The panel shows the outline copy on `/outline`; what the model reads is unchanged. Widening the context to the outline is AGENTS.md's "ask first" and is not taken |
| The sidebar's `In this outline` list must be live ("Headings appear here as you write them") but the sidebar is the layout's | **A published cell** (`lib/outline/toc.ts`): the workspace publishes headings + the lit row on every change, the sidebar group reads it, the server seeds the first paint through a `cache()`d document read the page shares |
| Comment threads: the Outline mockup draws no card, the data has `outline_block` anchors and the old panel that read them is gone | **Inline, as the Script.** The same cards and composer, opened from the `+` handle with the `outline_block` anchor; the outline's existing threads stay readable |

### Where the mockups disagree

- The Outline mockup's sidebar row for Outline reads `prose` / `empty`; the Script mockup's
  reads `3 acts`. **`N acts` / `—` stays** - the Script wins on chrome, and it is the format
  convention (`lib/workspace/format.ts`).
- The Outline mockup's sidebar header and breadcrumb name the project (`Not Magic, Just This`);
  the Script's name the episode. **The shell's, unchanged.**
- The mockup's footnote reads "Beats written here sync to the Beats route; the script is never
  rewritten from this page." The Beats route was cut 2026-09-12. **"Beats written here stay in
  the outline; the script is never rewritten from this page."** - the half that is still true.
- The mockup's slash menu shows five rows (Text, Heading, Quote, Numbered list, Divider). The
  block set is closed at seven and every one must stay reachable: **`Heading 2` and `Heading 3`
  sit beside `Heading`**, under the mockup's one `Add` eyebrow. The older story names (act,
  sequence, scene, research note) stay as keywords, so `/act` still finds the heading.
- The mockup's `@` hint ("Mention a character or location to keep it linked") was the Script's;
  the outline had no `@` combobox. **It has one now** - the Script's `mention-suggestion.ts` and
  combobox, reused, with `createMention` behind the two `New …` rows.

### What was built

**Shell changes** - `_chrome/sidebar-group.tsx` (client) picks the second group by segment:
`In this outline` on `/outline`, `Scenes` elsewhere; `sidebar.tsx` reads both lists and hands
them down (`loadOutlineToc`, whose document read is `cache()`d with the page's `loadOutline` in
`lib/outline/server.ts` - no second query on the Outline route, one extra read on the other
three). `assistant-panel.tsx` takes the route from the shell (`workspaceRouteFromSegments`) for
the Outline's subhead and chips. The `+` / `⠿` handle widget moved out of the Script's
`sheet-decorations.ts` into `_script/editor/extensions/handles.ts`, built by both editors.
`ThreadCards` / `ThreadComposer` take the `hosts` slice and an anchor kind rather than the Script
store; `openThreadOnNode` takes the kind (`ThreadNodeKind` in `lib/script/panel.ts`).

**Body** - `_outline/outline-workspace.tsx` rewritten without the paper: no 816px sheet, no
ruler, no zoom, no right panel, no status bar. The toolbar row is `outline-toolbar.tsx` (title
menu with the drafts; `⋯` with snapshot, Markdown export, undo, statistics). The column is the
Script's (`.folio-script-column`, 818px, 58px gutter); the prose is Geist 17px at 1.85 in
`--script`, blocks 26px apart, the title block at 32px over the mono date, headings 20px, a
quote's accent hairline, a rule's `--line2` line, beats numbered in mono with a 600 lead, 10px
apart. The empty state is the same column with `data-empty-state`: `Untitled outline` in
`--ink3`, the caret line "Start typing, or type '/' to add a block" (the editor's own ghost), two
key hints. The first keystroke turns the title into the episode's; the first save creates the
document, as before.

**Editor** - `decorations.ts` keeps five sets now: beats, handles, caret (`data-caret` + the
ghost), labels, thread hosts; it also reads the heading list after every change and publishes it
through the store (`headings` slice) only when one moved. The slash menu and the new
`outline-handle-menu.tsx` draw the v2 rows (mono glyph, name, `↵` on the lit row). A drag-move
keeps its id (`clipboard.ts` reads `view.dragging.move`, as the Script's). `static-outline.tsx`
draws the ghost on a trailing empty block so the first paint matches the editor's.

**Removed** - `outline-panel.tsx`, `outline-status-bar.tsx`, `_script/comments/legacy-thread-card.tsx`
(its only reader was the panel), `_script/view-tab.tsx` (no reader left). `BLOCK_LABEL` in
`lib/outline/keyboard.ts` stays: the tests hold the table.

**Tokens** - `--text-32` (the title block), in `packages/ui/src/tokens/theme.css`.

### Judgement calls, flagged

- **H2 at 18px and H3 at 17px.** The mockup draws only the H1 (20px); the two under it are a
  step each, the smallest still above the 17px body, weight 500 in `--ink`. An inference.
- **The title block has no handles.** The mockup draws `+` / `⠿` beside `Not Magic, Just This`;
  the title is the episode's title, not an outline block, and a handle on it would insert below
  nothing. Every real block has them.
- **`In this outline` counts the title row.** The mockup's `tocCount` is 4 for a title and three
  headings. The list draws the copy ("Headings appear here as you write them") whenever there is
  no heading, so a lone title row is never listed.
- **Clicking a TOC row puts the caret at the heading's start and scrolls to it**; the title row
  scrolls to the top. The mockup gives the rows no behaviour.
- **The statistics in `⋯` are Words, Blocks, Acts, Beats (the outline's) and Scenes, Characters,
  Locations (the script's)**, the old panel's list minus shots and relations, which were zeros.
- **The Markdown export writes the title as `#`, H1 as `##`** and so on, so the file has one
  document title; beats are a numbered list with the lead in bold.
- **The sidebar reads the outline on every writing route** (document + blocks, in parallel with
  its other reads) because a layout cannot see the route. Two statements on Script / Scenes /
  Storyboard renders; none extra on Outline. Deciding by URL server-side would need middleware.

### Not built, by ruling or by absence

- The assistant reading the outline (needs a ruling). Presence avatars, the Read button.
- Bold / Italic marks: still no inline run for them (a node-schema change).
- A drop cursor for the drag (a dependency; flagged with the Script's).

### Verification

- `pnpm exec turbo run typecheck lint --force` - 12 of 12 (6 packages, both tasks).
- `pnpm --filter web build` - clean, secret scan clean (275 files).
- `vitest run --environment node tests/` in `apps/web` - 326 pass; the 7 that fail are the same
  three jsdom files as phase 1 (`project-card`, `workspace.test.tsx`, the `sessionStorage`
  assertion) on local Node 22.5.1. New: `tests/outline-toc-markdown.test.ts` (6);
  `outline-pm-model.test.ts`'s slash expectations moved to the v2 rows.
- `e2e/outline-route.spec.ts` rewritten to the v2 contract (`data-toc-*`, `data-word-count`,
  `data-document-menu`, `data-caret`, the `⋯` statistics) and **unrun** - no `E2E_EMAIL` /
  `E2E_PASSWORD` here. A browser check of both states in both themes, the handles' drag, the
  TOC's lit row and the Markdown download is the next thing a human should do.

---

## Redesign phase 1, second pass - episodes: switch, name, rename (2026-09-16)

The client, on the first pass: "there is no option to switch between the episode in the script
route, and while creating a new episode no one asks for the name of it". Both true.

### What was wrong

- **The switcher was built and invisible.** The header's `Episode 1 ▾` breadcrumb was the
  episode menu since the redesign - but its container copied the mockup's `overflow:hidden`
  (there to ellipsise a long project title), and the menu, absolutely positioned inside it,
  was clipped to nothing on open. Found by clicking it in a browser, not by reading the code.
  The container no longer hides overflow; the project title truncates on its own.
- **`+` created `Episode N` on the click** and redirected. Nothing asked for a name and nothing
  could change one afterwards - renaming was filed under project settings, a stub (open
  decision 7). The sidebar then read `Ep 1 · Episode 1`.

### Rulings taken

| Question | Ruling |
| --- | --- |
| Where an episode is named and renamed, with `/settings` a stub | **In the writing chrome, both doors.** The sidebar's title row: the name is a button titled `Rename episode` - the Production mockup's own idiom (`title="Rename reel"` on the reel's name) - and `+` is `New episode`; either opens one form in flow under the row. The header's episode menu gains `Rename Episode N…` and `New episode…` at its foot, opening the same form in the menu's box. Open decision 7 is untouched: nothing here is settings |
| A popover under `+` | **In flow, not a popover.** The sidebar card clips its overflow (the 16px radius needs it) - the same clipping that hid the header menu. The title row is `flex-wrap`; the form wraps onto its second line |
| An empty name on create | **The default, not a refusal.** The placeholder says `Episode N`; Enter on an empty field is "just add one". Rename refuses an empty name |
| The sidebar's title | **`Episode 1 · Standpipe`**, as the mockup reads, and plain `Episode 1` while the title is the default - `episodeLabel` in `lib/workspace/format.ts`. The header's button stays `Episode N` (the mockup) |
| Deleting an episode - AGENTS.md's "delete or purge user data" question | **Asked; ruled: hard delete, confirmed.** `Delete Episode N…` at the menu's foot, drawn only while there is more than one; a confirm naming what goes and that it cannot be undone; the action refuses the last episode and a film; the walk lands on the neighbour (before, else after). `deleteEpisode` in `@folio/db` sweeps the four node-keyed tables with no foreign key onto the episode - `shots`, `reels`, `comment_threads`, `scenes` - by the episode's node ids in the same transaction, then lets `ON DELETE CASCADE` take the rest. `jobs` and the ledger stay: paid is paid |
| Reorder | **Not built** - "Open, and blocking" above |

### What was built

`packages/db`: `renameEpisode(scope, id, title)`, `deleteEpisode(scope, id)`.
`apps/web/lib/workspace/actions.ts`: `createEpisode(projectId, title | null)`,
`renameEpisode(projectId, slug, title)` and `deleteEpisode(projectId, slug)` on the
shared gate (`lib/script/gate.ts`), `TitleSchema` for the name, no `redirect()` - they return
the episode and its script URL (`lib/workspace/result.ts`) so a refusal draws under the field
and the form navigates. `_chrome/episode-form.tsx` is the one form; `_chrome/episode-title-row.tsx`
the sidebar's row (replacing `new-episode-button.tsx`); `_chrome/episode-delete-confirm.tsx`
the confirm; `writing-header.tsx`'s menu holds the list, a check on the current episode, and
the three foot items. `e2e/workspace.spec.ts`'s `+` step now names the episode, switches
through the menu, renames from it, and deletes the second episode back out.

### Verification

Walked in a browser against the running dev server with a throwaway account
(`e2e-redesign@example.com`, created through the Supabase admin API like the earlier `e2e-*`
accounts): the menu opens and lists every episode, `+` → name → Enter lands on `ep_00N/script`,
the sidebar title renames in place, the menu's rename form does the same, and the toolbar's
title follows; `Delete Episode 4…` → confirm removed the row and landed on `ep_003`. `tests/workspace-routes.test.ts` covers the label. `pnpm typecheck` is red only
in `_outline/`, another session's in-progress pass, not this change.

---

## Redesign phase 1 - the shell and the Script route (2026-09-16)

The client ruled the old UI bad and delivered a full design package: `docs/ui design/README.md`
plus nine `Route - * v2.dc.html` mockups. Routes are rebuilt to it one at a time; Script first,
new features built end to end.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The mockup sets the script in Geist 17px, proportional; the engine paginates in Courier at 6 lpi and the screen matched it line for line | **Geist, as designed.** Page breaks become `Page N` dividers placed from the measurement record; the engine's counts, eighths and export stand; the screen no longer wraps where the engine wraps |
| The orb opens a 400px assistant panel; no agent backend existed | **Real, read-only, persisted.** `@anthropic-ai/sdk` approved and pinned; `ANTHROPIC_API_KEY` optional; chats per episode; no writes to the script; no credits charged |
| Block handles `+` / `⠿` (ruled "No" 2026-09-13) | **Follow the design.** `+` inserts below or opens a thread; `⠿` reorders through ProseMirror's own drag |
| The sidebar credits card (AGENTS.md: "cut, do not build") | **Follow the design.** Built from the ledger balance |
| Storyboard in the sidebar (AGENTS.md: "Storyboard sits above Scenes") | **Follow the design.** Sidebar is Script · Outline · Scenes; Storyboard is the header pill's other half |
| The `Share` button | **Share links end to end** - `share_links`, the popover, `/share/:token` |
| The `Read` (read-through) button | **Left out** |
| Presence avatars | **Not built** - needs the realtime that is cut |
| `docs/build-decisions.md`, deleted in the working tree | **Kept deleted; restarted** with this phase. Links in `CLAUDE.md` / `AGENTS.md` fixed |
| The rail's Characters icon opens an overlay in every writing mockup | **Overlay on the writing routes**, with the full route linked inside; the rail navigates elsewhere |
| Comment threads: inline (the mockup) or a panel | **Both kinds inline.** Comment nodes are cards; threads are cards under their block with reply and resolve; creation from the `+` handle; the Collaboration panel goes |

### Where the mockups disagree with the README

- The Script mockup's rail order is Writing · Characters · Locations · Research · Timeline ·
  Production; the README and the other eight mockups say Timeline before Research. **The README
  and the eight win.**
- The README says every route has a 28px status bar; none of the five writing mockups draws one.
  **Writing routes have none.** Their `104 pp · saved` moved into the toolbar row.
- The README lists `Help` at the foot of the rail. Help has nowhere to go and the account menu
  (settings, sign out) needs a home, so **the avatar takes the slot.** A button that cannot do
  what it says is a placeholder.
- The mockup's slash menu shows five blocks (Text, Scene, Dialogue, Parenthetical, Transition).
  The type set is closed at eight and `script-slash.test.ts` holds the menu to it; **all eight
  are listed** in the mockup's chrome, `Action` keeping its name.

### What was built

**Tokens and type** - `packages/ui/src/tokens/palette.css` is the README's `:root` block
verbatim, three-block shape kept; the older token names (`--desk`, `--panel`, `--sel`, `--add`,
`--note`, `--sheet`...) alias onto the new ones so the six unrebuilt routes render on the new
palette without a line changed. `theme.css` republishes the new names (`bg-s1`, `text-ink2`,
`rounded-panel`...) and moves the old radius scale to the new geometry. Geist and Geist Mono are
self-hosted subsets fetched from Google's `css2` endpoint the way the earlier files were
(`apps/web/app/fonts.css`); Inter is gone; Courier Prime stays, pinned, as the measured face.

**Icons** - `packages/ui/src/icons.tsx`: inline stroke SVGs transcribed from the mockups. The
Unicode glyph set (`glyphs.ts`) stays for the unrebuilt routes, minus `◎`.

**Routes** - Insights removed: page, schema, rail item, tests. Nine routes.
`lib/workspace/routes.ts` gains `SIDEBAR`, `WRITING_MODES`, the README widths and breakpoints.

**Shell** - `_chrome/project-shell.tsx` (client) draws the ambient glows, the rail, the assistant
panel and the Characters overlay, and owns `html[data-nav-open]` and the breakpoints ("solve it
at the shell"). `_chrome/writing-layout.tsx` draws the sidebar (a server card: rows, clickable
scene list, credits), the header (breadcrumb with an episode menu, the Write / Storyboard pill,
Share, the orb) and the main-surface card. `⌘J` toggles the assistant anywhere. (The episode
menu shipped clipped and `+` shipped nameless - the second pass above.)

**Script body** - `_script/script-workspace.tsx` rewritten without the paper: no 816px column,
no page frames, no per-line margins, no zoom, no status bar, no right panel. The toolbar's title
menu switches script / title page and lists revisions; the `⋯` menu holds import, export, undo,
pagination, format and the statistics. `lib/script/pages.ts` replaces `layout.ts`:
`pageBreaksOf(record)` is the whole arithmetic. The decorations plugin now keeps six sets: page
dividers, block handles, caret (`data-caret` + ghost), pills, labels, thread hosts. Threads are
widget hosts React portals cards into (`_script/comments/thread-cards.tsx`), with
`stopEvent` / `ignoreSelection` keeping the editor out of a textarea in its own DOM. A drag-move
keeps its id (`clipboard.ts` reads `view.dragging.move`). Every block renders `id="n-<uuid>"` so
the sidebar's `#n-…` rows land on it.

**Assistant** - `packages/db/src/schema/assistant.ts`, repositories, `lib/assistant/`:
`context.ts` renders the script as prose with `[Scene N]` markers and mention labels (not
Fountain - a model cannot say "Meera" from `@{character:<uuid>}`), `server.ts` gates through
`openEpisodeWith`, appends the turn, streams from `claude-opus-5` with the system block cached,
and appends the answer when the stream ends - partial answers included, so a closed tab never
leaves a question without one. `app/api/assistant/route.ts` is the streaming door: `text/plain`
chunks, nothing to parse.

**Share links** - `share_links` (`0016`), `lib/share/`, the popover (copy, role, revoke; one live
link per project, issuing revokes), `app/share/[token]/page.tsx` outside `(app)` so the token
survives a sign-in round trip; revoked and unknown tokens get a page, not a 404.

**Migration `0016`** - `share_links`, `assistant_chats`, `assistant_messages`, two enums, RLS on
the `0014` pattern. Additive only.

### Judgement calls, flagged

- **Drag-and-drop has no drop cursor.** `prosemirror-dropcursor` is a dependency; the handle is
  usable without it and the writer sees the caret. Ask before adding.
- **The static first paint places a mid-block page divider at the block's start**; the editor
  moves it to the engine's offset on mount. One divider can shift a few lines on hydration.
- **Dialogue, cues and parentheticals are centred**, as the mockup draws them
  (`text-align: center` inside `padding: 0 90px`). Unusual for a screenplay; it is the design.
- **The assistant's context is capped at 400k characters**, cut at a scene boundary, and the
  system prompt says so. A longer script is a rare feature-and-a-half.
- **The assistant panel's `+` attach and dictate buttons are drawn disabled** with their titles
  saying so; the composer's "@ to add context" placeholder is the mockup's and is not parsed.
- **The Characters overlay's `New character` links to the route**; the modal there is component
  state with no param to open it (adding one needs a human).
- **`replyThread` and `resolveThread` no longer `revalidatePath`**; they return the thread and
  the Script replaces the card. The Outline's legacy card (`_script/comments/legacy-thread-card.tsx`)
  calls `router.refresh()` instead, until its pass.
- **`whenLabel` renders `14:02` / `3 Sep` in the server's locale and zone** at request time, as
  the earlier card did.
- **The credits caption reads `≈ N frames · no expiry`**, N at `FRAME_GENERATION_COST`; the
  mockup's "full-draft passes" is an agent cost that does not exist.
- **The `+` / `⠿` handle widget exists on every block** (3,000 tiny nodes on a feature), hidden
  until hover or caret. A hover-tracked single widget would be cheaper and was not needed.

### Not built, by ruling or by absence

- Presence avatars; the `Read` button; `Help` in the rail.
- Assistant writes, proposals, tools, credits; chat deletion has an action and no button.
- A drop cursor; a rename of the Unicode glyph set's remaining consumers.
- The other six route bodies, Research, Production's body, `/settings` - each its own pass.

### Verification

- `pnpm typecheck` - 6 of 6. `pnpm lint` - clean. `pnpm --filter web build` - clean, secret scan
  clean, `/share/[token]` and `/api/assistant` present, no `/insights`.
- `vitest run --environment node tests/` - 318 pass; the 8 that fail are the three jsdom files
  (`project-card`, `workspace.test.tsx`, the `sessionStorage` assertion) on local Node 22.5.1
  (`ERR_REQUIRE_ESM`, `apps/web/CLAUDE.md` trap 1).
- `pnpm --filter @folio/db db:check` - journal clean with `0016`.
- The E2E walks (`workspace.spec.ts`, `script-route.spec.ts`, `theme.spec.ts`, `glyphs.spec.ts`)
  are rewritten to the new contract and **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` on this
  machine. A browser check of the Script route, the handles' drag, the thread portals and the
  assistant stream is the next thing a human should do.
