# Build decisions

One section per phase, newest first. Restarted 2026-09-16 with the v2 redesign: the phases
before it - every route's first build, the cuts, the editor rebuild - are in git history
(`git show 7a541bd:docs/build-decisions.md`). They describe chrome that no longer exists and are
not the reference for a rebuilt route; `docs/ui design/README.md` and the `Route - * v2.dc.html`
mockups are.

## Open, and blocking

The live list. AGENTS.md's open-decisions table is the contract; this is what each one refuses
at in the code today.

- **Assistant cost (open decision 13).** `assistant_messages` has no cost column, the send button
  names no price, and nothing writes the ledger. "Cost is named before it is spent" is unmet
  because there is no number to name.
- **Open decision 8, A4.** `resolveSheet('asian')` refuses; the Script route's banner says so.
- **Open decision 10, `SCENE_xxx`.** Unchanged. The sidebar's scene rows are `#n-<node id>`
  fragments, which name a node, never a scene record; `?selected=` stays unwired.
- **Open decision 11, past green; 12, locked pages.** Unchanged, both refused at the engine.
- **Membership roles are stored and enforced nowhere.** A share link issues `writer | reader`
  and `addMembership` writes it; nothing reads it back. Deciding that a `reader` cannot share,
  comment or write is a capability model nobody has specified.
- **`ASSISTANT_MODEL` is `claude-opus-5`**, the API reference's default, written once in
  `lib/assistant/model.ts`. A cheaper model is a product call about the answers, not a setting.
- **Reordering episodes** is ADR 0002's open product claim and is not built; `ordinal` moves
  are the machinery, the ruling is missing.

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
