@AGENTS.md

# apps/web

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before touching auth or reaching for a Supabase client, read
[lib/auth/NO-BROWSER-CLIENT.md](lib/auth/NO-BROWSER-CLIENT.md). Before putting anything in a
client store, read [lib/state/README.md](lib/state/README.md). Before building a route, read
that route's section in [docs/build-decisions.md](../../docs/build-decisions.md) - the v2 design
package was deleted by the client on 2026-09-20 and is not to be read from git history; the built
routes and `packages/ui/src/tokens/` are the pattern.

- **State:** Google OAuth **and** email + password (AGENTS.md Constraints was rewritten for this —
  `docs/build-decisions.md`), session in Server Components, route protection in two places. Two
  shells under one boundary: [app/(app)/layout.tsx](app/(app)/layout.tsx) is `requireUser()` and
  the frame; [app/(app)/app/(home)/layout.tsx](app/(app)/app/(home)/layout.tsx) draws the
  four-item sidebar for the six list routes (three views over one query in `_projects/`, plus
  `new`, `trash`, `settings`); [app/(app)/app/project/[projectId]/layout.tsx](app/(app)/app/project/[projectId]/layout.tsx)
  draws the workspace shell through `_chrome/project-shell.tsx` (56px rail, the assistant panel), and `_chrome/writing-layout.tsx` the 236px sidebar, 60px header and
  main-surface card for the four writing routes. Seven of the nine workspace routes have bodies
  (root `CLAUDE.md`, Repository map).
- **The header's centre is the route's views (2026-09-17).** `lib/workspace/views.ts` is the
  table (one row per route, typed against `SUB_VIEW_SCHEMAS`, `label`/`title`/`icon`);
  `_chrome/header-views.tsx` reads `?view=` with `useSearchParams` and draws `_chrome/view-pill.tsx`
  in `WritingHeader`'s centre slot; Characters hands the header its own state-driven tabs as
  `views`, and the header draws the Storyboard's (`_storyboard/view-state.tsx`, a cell the
  workspace also reads - ruled 2026-09-17, the Characters ruling again) itself on that segment,
  since the shared writing layout cannot hand them in. Route toolbars draw no view switcher, and
  `SIDEBAR` is Script · Storyboard · Outline · Scenes. Trap: a new `?view=` value needs a row in
  `ROUTE_VIEWS` or `tests/workspace-routes.test.ts` fails (it asserts the table against the schemas).
- **The shell owns `html[data-nav-open]`.** Route bodies read `useSession().navOpen` for their own
  geometry and never write the attribute; `useViewport()` (`lib/state/viewport.ts`) is the one
  resize listener. Below 1200px an open assistant panel forces the sidebar closed there.
- **The workspace, in one directory:** [lib/workspace/](lib/workspace/). `routes.ts` is the route
  tree and both orders (rail, episode nav); `params.ts` the sub-view params; `hrefs.ts` every
  workspace URL and the film/series shape; `context.ts` the membership gate and the `cache()`d
  loaders; `format.ts` the `104pp` / `—` / `empty` / `0` convention. The film shape is a
  second static tree under `project/[projectId]/(film)/` — Next has no optional segment — and
  each page canonicalises the URL for the project's type.
- **The Script route since the redesign:** `_script/script-workspace.tsx` is the body inside the
  surface card - toolbar (title menu, `⋯` actions menu), banners, the scrolling column. Threads
  are widget hosts in the editor DOM that React portals cards into (`_script/comments/`); the
  `+` handle's menu inserts blocks or opens a thread composer; the `⠿` handle node-selects and
  ProseMirror's own drag moves the block (`clipboard.ts` keeps its id on a move). Page breaks
  are widget dividers from `lib/script/pages.ts`.
- **The Outline route since the redesign:** `_outline/outline-workspace.tsx` is the same shape -
  toolbar (`Outline · Draft N` menu over the snapshots, `⋯` with snapshot, Markdown export, undo,
  statistics), banners, the column - with no sheet, panel or status bar. The sidebar's second
  group is the route's (`_chrome/sidebar-group.tsx`): `In this outline` reads the cell the
  workspace publishes to (`lib/outline/toc.ts`), seeded by a `cache()`d document read the page
  shares (`lib/outline/server.ts`). Handles, threads and the `@` combobox are the Script's pieces
  (`_script/editor/extensions/handles.ts`, `_script/comments/`, `mention-suggestion.ts`).
- **The Storyboard route since the redesign:** `_storyboard/storyboard-workspace.tsx` is one
  container (rows, selection, filter, sort, display toggles, every write) over three layouts -
  `board-view.tsx`, `canvas/canvas-view.tsx`, `list-view.tsx` - that share `shot-parts.tsx` and
  the `ViewProps` in `handlers.ts`. The toolbar is `storyboard-toolbar.tsx`'s one `Display`
  menu (show / sort / filter) - the view switcher is the shell header's since 2026-09-17, three
  buttons over the `view-state.tsx` cell (not `?view=`; the URL stays `/storyboard`, a board card
  and the column's `Open` set the view through `onOpenCanvas`); a shot is
  edited in place, a board card drags to reorder (`placeShot`). The sidebar's `Boards` group and
  `Boards drawn` widget (`_chrome/sidebar-group.tsx`, `_chrome/sidebar-widget.tsx`) read the cell
  the workspace publishes (`lib/storyboard/coverage.ts`), seeded by `readBoardCoverage`; every
  derived count and colour is `lib/storyboard/board.ts`, pure and tested. Toolbar dropdowns share
  `_chrome/use-dismiss.ts`. Details: `docs/build-decisions.md`, "Redesign phase 3".
- **The Storyboard canvas (2026-09-17)** is a free surface: `_storyboard/canvas/` holds the view,
  the viewport hook (pan by pointer capture, zoom by ctrl/cmd + wheel), the SVG threads, the card
  with its `Storyboard | Lens` tabs, the lens selects and the `⋯` menu; every number it needs is
  `lib/storyboard/canvas.ts`, pure and tested. A card's position is `shots.canvas_x` / `canvas_y`
  (migration `0020`), cosmetic - the thread and the number follow `order_key`. Trap: the ground's
  `wheel` listener is added by hand with `{ passive: false }`; React's `onWheel` is passive and
  `preventDefault` there does nothing. Details: `docs/build-decisions.md`, "Redesign phase 3,
  second pass".
- **The Scenes route (v2, 2026-09-17):** `_scenes/scene-workspace.tsx` is the body - a toolbar row
  (the selected scene, `N scenes · N pages`), the banners, one of `canvas/scene-canvas.tsx`
  (Cards), `index-view.tsx` or `list-view.tsx`, and two dialogs portalled to `body`:
  `scene-detail.tsx` (the synopsis editor, the route's one write) and `script-modal.tsx` (the scene
  on a Courier sheet, `Hollywood | Asian` through `resolveSheet` - Asian draws the open-decision-8
  refusal). The canvas is the Storyboard's: `use-canvas-viewport`, `connectors` and
  `lib/storyboard/canvas.ts` are imported across the route boundary, a scene card is `NODE_W`;
  `lib/scenes/canvas.ts` and `sheet.ts` hold what is scene-specific, pure and tested. Positions are
  component state (no `scenes.canvas_x`); the canvas opens on `openingWindow`, not a fit. No page
  header, no status bar. **The three views are client state, not `?view=`** (ruled 2026-09-17, the
  Storyboard's ruling of the same day): `_scenes/view-state.tsx` is the cell the header's tabs and
  the body share, `_scenes/scenes-main.tsx` the route's own `<main data-sub-view>` that resets it
  on unmount, `_scenes/scenes-route.tsx` the server entry both `scenes/page.tsx` files render
  after `enterEpisodeRoute` - the Storyboard's shape. `_chrome/route-shell.tsx` and
  `episode-route-page.tsx` went with it (Scenes was their last route). Details:
  `docs/build-decisions.md`, "Redesign phase 8" and its second pass.
- **The Research route (v2, 2026-09-16):** `_research/research-workspace.tsx` is the body -
  toolbar (the shared `_chrome/record-toolbar.tsx` pieces; the views are the header's), one of Library /
  Source / Clips or the empty card, the status bar - and `_chrome/research-layout.tsx` the shell
  on the Characters pattern, with the drawer (`_research/source-drawer.tsx`, the shared
  `_chrome/drawer-shell.tsx` portalled into `#research-drawer`) mounted once in the layout and
  opened through the cells in `lib/research/compose.ts`. The source being read is the path
  (`/research/:sourceId`); a clip is cut from a text selection in `source-view.tsx` and found
  again by text (`lib/research/view.ts`, `highlightParagraphs`); a filing points at a scene by
  its heading node id with no key. Everything the route reads is one `cache()`d `loadResearch`.
  Details: `docs/build-decisions.md`, "Redesign phase 7".
- **The Locations route (rebuilt 2026-09-18, the plan is the spec):** `_locations/locations-workspace.tsx`
  is the body - toolbar (count chip, status filter), one of `places-view.tsx` (the queue, then cards
  on `.folio-record-card` with sub-sets drawn inside their parent's card), `scenes-view.tsx` (one
  section per primary set, rows linked into the script, CSV per set) or `sheet-view.tsx` (sort,
  episode scope, totals, CSV), the status bar with its toast, and `location-drawer.tsx`
  (evidence first, the Production fold last). The views are state in the layout
  (`_locations/view-state.tsx`); the sidebar's find narrows the body too. Every derived line is
  `lib/locations/view.ts` or `lib/locations/sheet.ts`, pure and tested; the readings over the
  script are `@folio/script`'s `sets.ts`, computed in `lib/locations/server.ts` - nothing new is
  stored. Trap: a queue decision's `Undo` is `revokeDecision`, keyed by the row's key, and a `New
  location` undo deletes the minted record only while it is blank.
- **The Timeline route (rebuilt 2026-09-18 in five phases - the written plan is the spec):**
  `_timeline/timeline-workspace.tsx` is the body and runs the pure core itself - the loader
  (`lib/timeline/server.ts`) hands rows, threads, episodes, the introductions and the verdict keys,
  and the workspace computes the chronology, the jumps, the continuity findings and the placement
  proposals over them with `@folio/script` (`timeline.ts`, `continuity.ts`, `time-cues.ts`), so a
  write lands as a *patch* over its row (`applyPatches` / `patchLanded` in `lib/timeline/view.ts`)
  before the refresh. Pieces: the toolbar (`timeline-toolbar.tsx`: count chip, `Lanes by ▾`, the
  episode scope, `⋯` with `Read in story order` / `Story chronology as Markdown`, `Place N scenes`
  opening the queue), the banner, `proposal-queue.tsx` (a day per unplaced scene read from the
  page's cues with its reason and citation; `Accept` / `Skip` / `Accept all` with `Undo`), the
  lanes (`lanes-grid.tsx` over `scene-card.tsx`: drag to a day column or a thread row, a trailing
  `＋ Day N` column, ghost cards for a scene's further threads, a roving tabindex with `[` `]` `F`
  `D` `C`; `unplaced-strip.tsx` under the chronology is a drop target both ways), `continuity.tsx`
  (open cards, `Notes` and `Marked deliberate` folds, `It's deliberate` / `Reopen`), the empty
  card, the status bar, `scene-drawer.tsx` (`Place in time`: day / clock / flashback, `⇅` and
  `+1 day`, **What the page says** citation chips, the findings on the scene, thread chips with
  `▲ Make row` and `×`, cast and set links; it publishes the assistant's `scene` Focus) and
  `read-modal.tsx` (the Scenes sheet's `PaperModal` + `ReadingPaper`, a scene at a time via
  `readSceneLines`). `_chrome/timeline-layout.tsx` is the shell; the sidebar
  (`timeline-sidebar.tsx`) is the Threads group (a row is a solo, carries `EpisodeBars`, drags to
  reorder, `⋯` opens `thread-editor.tsx`) and the `Placed in time` widget. The views, the
  selected scene, the solo thread and the one `useRun` are `_timeline/view-state.tsx`; the drawer
  is not a path (open decision 10). `lib/timeline/facts.ts` is the panel's cell; the assistant
  sends `timeline: true` on the route and `lib/assistant/server.ts`'s `timelineOf` runs the same
  loader and check. Every write is one statement (`writeSceneThreads` whole-list with the
  project check inside it, `placeScenes` / `unplaceScenes` over `unnest`, `orderStoryThreads`,
  `deleteStoryThread`'s CTE that also densifies `position`, `markFindingDeliberate` /
  `reopenFinding` on `timeline_findings`, `0023`). Traps: the drawer's draft is keyed on the
  scene id and never reset from props; a card's id is readable on drop, not during the drag, so
  the workspace decides what a drop writes; the check's thresholds are constants in
  `continuity.ts`, not rulings. Details: `docs/build-decisions.md`, "Timeline rebuild, phases 2-5"
  and "phase 1".
- **The Characters route (the fourth pass, 2026-09-20 - laper.ai's shape by the client's
  ruling; the Relationships graph removed again 2026-09-21 - the canvas's own threads already
  show a relationship between two cards, so the graph was a redundant second view of it):**
  `_characters/characters-workspace.tsx` is the body - the toolbar row
  (`characters-toolbar.tsx`: the count, the `Needs a decision · N` pill, `＋ New character`), one
  of Characters / List (`view-state.tsx`, client state) or the empty card, the status
  bar with its `toast` slot (`_chrome/use-toast.ts`; the rename's undo offer is
  `lib/characters/undo.ts`), **one thing in the drawer slot** (the New drawer, the queue panel, or
  the edit drawer) and the relationship modal (`relationship-modal.tsx` on the new
  `_chrome/modal.tsx`). `_chrome/characters-layout.tsx` has **no sidebar** - the header with the
  two tabs, the surface, the drawer slot. `canvas/character-canvas.tsx` is the Storyboard's
  canvas with a person per card (`_storyboard/canvas/use-canvas-viewport.ts` imported; the zoom
  pill, node drag and measure lifted to `_chrome/canvas/`): `character-node.tsx` (redrawn 2026-09-21: a
  `Portrait · Advanced · Look sheet` strip on the card's top edge, component state; the face is
  the grip and the click, a deep tint off `--face-*` with the name printed white on it;
  `Edit · Upload`, then `✦ Generate` disabled; the ring connect grip) and
  `relationship-threads.tsx` (`.folio-rel-thread` glow + rail + gradient dash per row, a
  two-label pill at the midpoint - 13.5px, raised from 11.5px 2026-09-21 so the two labels read
  at a glance - that lights its thread on hover and opens the relationship modal on click);
  positions persist through `placeCharacterOnCanvas` (`0024`), an unplaced card takes the first
  free grid cell (`lib/characters/canvas.ts`, `lib/workspace/canvas.ts`). The Relationships graph
  (`graph/relationships-view.tsx`, its `graph-edges.tsx` and `graph-node.tsx`) is gone
  (2026-09-21, "Characters, relationships view removed"); `lib/characters/graph.ts`'s deterministic
  Fruchterman-Reingold, circle and dialogue-edge arithmetic stays - still tested
  (`tests/characters-graph.test.ts`), `authoredEdges` still feeds the canvas's own threads - but
  `dialogueEdges` and the loader's `dialogue` field are now unread past `lib/characters/server.ts`,
  same treatment as `character_findings`. `list/list-view.tsx` +
  `display-menu.tsx` sort `lib/characters/list.ts`'s columns and export its CSV. The identity
  layer is unchanged and re-homed: `queue-panel.tsx` hosts `unmatched-queue.tsx` (never
  dismissed, a reason chip, confidence-weighted buttons, pair rows) and `walk-ons-line.tsx` behind
  the pill, with the undo toasts. The drawer (`character-drawer.tsx`) is a form: `profile-fields.tsx`
  (`Basic info · Bio · Appearance notes`), `Portrait`, `Relationships` (rows from this side,
  `＋ Add relationship`), `Delete · Cancel · Save`; a changed name is still the rename with
  `rename-confirm.tsx`'s preview and the status bar's Undo, verbatim from the third pass. The
  loader (`lib/characters/server.ts`) reads no node: records, tallies, relationships
  (`listRelationships`), the scene index as refs with words, the queue. `lib/characters/
  relationships.ts` sorts a pair and reads a row from either side; `facts.ts` publishes the open
  record, the no-description and the no-relationship lists for the assistant's report chips.
  `lib/characters/heal.ts` binds the name's cue to a record that has none on the next derive.
  Details: `docs/build-decisions.md`, "Characters, fourth pass" and "Characters, relationships
  view removed"; the third pass's "Characters rebuild" is history.
- **The Script autosave is a delta and every write it runs is one statement.** Over the
  transaction pooler a parameterised statement costs two round trips and cannot be pipelined
  (`packages/db/src/client.ts`), so on the request path the cost is statement count, not row
  count. Add to an existing statement or defer with `deferAfterSave`; never add a sequential
  query to a save.
- **Both editors are Tiptap and the document is not React state.** `_script/editor/` and
  `_outline/editor/` hold the extensions; `lib/script/pm-model.ts` and `lib/outline/pm-model.ts` are
  the one boundary each to its node list; the chrome reads store slices (`editor-store.ts`,
  `outline-store.ts`), never the editor value. The Outline reuses the Script's framework pieces -
  the `@mention` atom and its combobox, the identity plugin, the handles, the floating layer, the
  slice cell, the thread cards - and shares no block node with it. Details: `docs/build-decisions.md`,
  "Redesign phase 1" and "Redesign phase 2".
- **Every episode segment goes through `parseEpisodeSegment`** (`@folio/contracts`) in
  `[episodeId]/layout.tsx` before any lookup. Do not add a route that reads `params.episodeId`
  without it.
- **No Supabase SDK reaches the browser.** Every auth path is a server action.
- **Public env is [lib/env/public.ts](lib/env/public.ts)** — the two `NEXT_PUBLIC_SUPABASE_*`
  values only. Secrets are in `@folio/db/env`, which throws in a browser. `process.env` anywhere
  else is a lint error; `scripts/` and test-runner configs are the only exemptions.
- **The service-role key is kept out of the bundle by a check.**
  [scripts/assert-no-server-secrets.mjs](scripts/assert-no-server-secrets.mjs) runs after
  `next build`, scans `.next/static/**` and every served `.html`/`.rsc`, and fails on the
  variable's name, its value, or the env module's browser-refusal string — without printing the
  match. Verified by poisoning a client component.

## Commands

```bash
pnpm --filter web test                              # fails locally — see trap 1
pnpm --filter web check:secrets                     # bundle scan alone; needs a prior `next build`
pnpm test:e2e                                       # needs `pnpm --filter web exec playwright install chromium` once
E2E_EMAIL=… E2E_PASSWORD=… pnpm test:e2e            # also runs the signed-in walks (e2e/*-route.spec.ts) against the .env project
E2E_PORT=3000 …                                     # point the walks at a running dev server
pnpm --filter web exec playwright test -g "glyph"   # one e2e
```

Traps:

1. **`pnpm --filter web test` fails on a fresh run** — `ERR_REQUIRE_ESM` from jsdom. Local Node is
   22.5.1, below the `>=22.12.0` in `engines`; `.npmrc` sets `engine-strict=false`, CI reads
   `.nvmrc` and never hits it.
2. **A dev server reached over `127.0.0.1` renders but never hydrates.** Next 16 treats it as a
   cross-origin dev request unless it is in `allowedDevOrigins` and withholds assets. No error page:
   every Client Component is inert, every `useEffect` silently never runs.
   [playwright.config.ts](playwright.config.ts) uses `localhost` for this reason; `smoke.spec.ts`
   has one test that fails if hydration stops.
3. **The Script walk imports the golden corpus and diffs the rendered page map against it** —
   a pagination change that moves pages fails there, not only in `@folio/script`.
4. **`typecheck` runs `next typegen` first, and must.** `typedRoutes: true` types `href` and
   `redirect()` against a generated union that does not exist on a never-built checkout — `tsc`
   alone reports every route as invalid.
