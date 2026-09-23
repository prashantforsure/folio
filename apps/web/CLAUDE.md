@AGENTS.md

# apps/web

Loads when you work in this directory. Root `CLAUDE.md` still applies.

Before touching auth or reaching for a Supabase client, read
[lib/auth/NO-BROWSER-CLIENT.md](lib/auth/NO-BROWSER-CLIENT.md). Before putting anything in a
client store, read [lib/state/README.md](lib/state/README.md). Before building a route, read its
paragraph below and the route as built - the v2 design package was deleted by the client on
2026-09-20 and is not to be read from git history, and `docs/build-decisions.md` (the written
route record) was deleted on 2026-09-22; the built routes and `packages/ui/src/tokens/` are the
pattern, and Production alone has a spec on disk (`docs/production/`).

- **Roles are enforced, since 2026-09-23** (ADR 0003 D2, roadmap task 1.2): `lib/auth/roles.ts`
  is the matrix - `reader` < `writer` < `owner`, one row per family of action - and every gate
  takes the minimum role its caller needs (`openProject`, `openEpisode`, `openEpisodeWith` in
  `lib/script/gate.ts`; `openForActor` in `lib/projects/actions.ts`). A member whose role falls
  short gets "Your role on this project doesn't allow that", never the not-found refusal a
  stranger gets. A new action passes a `ROLE.*` capability, never a bare role.
- **State:** Google OAuth **and** email + password (AGENTS.md Constraints was rewritten for
  this), session in Server Components, route protection in two places. Two
  shells under one boundary: [app/(app)/layout.tsx](app/(app)/layout.tsx) is `requireUser()` and
  the frame; [app/(app)/app/(home)/layout.tsx](app/(app)/app/(home)/layout.tsx) draws the
  **238px account sidebar** for the four account routes (`new`, `projects`, `trash`, `settings`,
  plus three redirects) and reads the two live numbers it prints;
  [app/(app)/app/project/[projectId]/layout.tsx](app/(app)/app/project/[projectId]/layout.tsx)
  draws the workspace shell through `_chrome/project-shell.tsx` (56px rail), and `_chrome/writing-layout.tsx` the 236px sidebar, 60px header and
  main-surface card for the four writing routes. All **ten** workspace routes have bodies
  (`WORKSPACE_ROUTE_COUNT`, `lib/workspace/routes.ts`; root `CLAUDE.md`, Repository map).
- **The account routes (2026-09-22, the client's `handoff-account-v2/` - supplied with the brief,
  never committed; the routes as built and this paragraph are the spec):** the shell is
  `_shell/home-sidebar.tsx` (the workspace header with a disabled switcher, `home-nav.ts`'s four
  rows with a live count on Projects, the scrolling middle, `credits-card.tsx`, `account-menu.tsx`)
  beside `_shell/route-frame.tsx` (the 60px breadcrumb header with the round theme toggle, then
  `.folio-surface`; `scroll={false}` when a route lays the panel out itself). `_shell/sidebar.tsx`
  and `nav.ts`'s `SIDEBAR` went with it; `nav.ts` keeps the two shared paths.
  **Projects** (`(home)/projects/page.tsx` + `_projects/`) is one query - `listProjectsFor` with
  `kind: 'all'`, which now also reads each project's members, its first blocks of script and its
  live generation count - over `projects-workspace.tsx`: chips, sort, grid/list, selection and
  every write, all client state (AGENTS.md's exception table), with `project-card.tsx`,
  `project-row.tsx`, `project-preview.tsx` and `card-menu.tsx` drawing. `lib/projects/view.ts` is
  the pure half (filters, counts, sort, stage, the stats line), tested in
  `tests/projects-view.test.ts`. **New** (`(home)/new/`) is `compose-new.tsx` or `first-run.tsx`,
  decided by the project count: the compose box collects the **logline** and opens
  `new-project-dialog.tsx` (the one creation form, also behind the grid's dashed card), and the
  first-run card walks the three axes with the progress bar reading how many are answered.
  **Settings** (`(home)/settings/`) is `settings-workspace.tsx` over `lib/settings/sections.ts`'s
  seven sections, with `profile-form.tsx` and `security-section.tsx` split out; the writes are
  `lib/settings/actions.ts`. Deviations from the handoff, each drawn rather than dropped:
  `Duplicate` refuses (open decision 15), `Pin to sidebar` and `Export PDF` are disabled (nothing
  to pin to; no PDF engine), `Delete` is `Move to trash` (deleting for good is the Trash route's
  refusal), the card's stage and chips are derived from what exists (no draft numbers, no
  schedule), the plan tiers carry no prices (nothing is wired to Dodo), the editor and
  notification toggles are disabled with the reason on each (no per-person store; no mail
  provider), Collaborators has no invite field (an invite is a project's share link) and no
  permission table (a role is granted by the share link that invited somebody, not edited here),
  and there is no device list (Supabase does not expose one user's sessions; `Sign out everywhere`
  is `scope: 'global'`).
  Traps: the dialogs are native `<dialog>` elements with `showModal()`, not the workspace's
  portal `Modal`, so Escape, the backdrop and the focus trap are the browser's; `useDismiss` moved
  to `lib/chrome/use-dismiss.ts` and the workspace path re-exports it; and **a `'use server'`
  module may export nothing but async functions** - `lib/settings/actions.ts` briefly exported its
  idle constant, which typechecked, linted and built and then 500'd on every post ("A 'use server'
  file can only export async functions, found object"). The constants live in a sibling
  `result.ts`, as `lib/projects/` and `lib/auth/` already had them. Only a browser walk finds it.
- **The header's centre is the route's views (2026-09-17).** `lib/workspace/views.ts` is the
  table (one row per route, typed against `SUB_VIEW_SCHEMAS`, `label`/`title`/`icon`);
  `_chrome/header-views.tsx` reads `?view=` with `useSearchParams` and draws `_chrome/view-pill.tsx`
  in `WritingHeader`'s centre slot. Research is the only route with a `?view=` row left: the
  record routes with a layout of their own (Characters, Locations, Timeline) hand the header
  their state-driven tabs as `views`, and the header draws the Storyboard's and Scenes' cells
  (`_<route>/view-state.tsx`) itself on those segments, since the shared writing layout cannot
  hand them in. Route toolbars draw no view switcher, and `SIDEBAR` is Script · Storyboard ·
  Outline · Scenes. Trap: a new `?view=` value needs a row in `ROUTE_VIEWS` or
  `tests/workspace-routes.test.ts` fails (it asserts the table against the schemas).
- **The shell owns `html[data-nav-open]`.** Route bodies read `useSession().navOpen` for their own
  geometry and never write the attribute; `useViewport()` (`lib/state/viewport.ts`) is the one
  resize listener. Below 1200px an open assistant panel forces the sidebar closed there.
- **The assistant panel is app-wide** (roadmap task 2.2, 2026-09-23): `app/(app)/layout.tsx` mounts
  `_shell/assistant/assistant-host.tsx` once, beside `children`, so no navigation re-mounts it. Inside
  a project it draws the chat panel (`_shell/assistant/assistant-panel.tsx`) for the project and
  episode `project-shell.tsx` publishes into `lib/assistant/project-cell.ts`; outside one, the
  launcher (`_shell/assistant/launcher.tsx`, ADR 0003 D15) - recent projects and a disabled
  `Start from a story`, **no composer** (ruled 2026-09-23: a launcher turn has no project to be
  recorded on). Closed, the chat panel is **hidden, never unmounted**; the open chat per episode and
  the draft are in the session store. The host owns `⌘J`; the project shell keeps the nav-collapse
  rule and reads `assistantOpen` for it.
- **The workspace, in one directory:** [lib/workspace/](lib/workspace/). `routes.ts` is the route
  tree and both orders (rail, episode nav); `params.ts` the sub-view params; `hrefs.ts` every
  workspace URL and the film/series shape; `context.ts` the membership gate and the `cache()`d
  loaders; `format.ts` the `104pp` / `—` / `empty` / `0` convention. The film shape is a
  second static tree under `project/[projectId]/(film)/` — Next has no optional segment — and
  each page canonicalises the URL for the project's type.
- **The Script route since the redesign:** `_script/script-workspace.tsx` is the body inside the
  surface card - toolbar (title menu, `⋯` actions menu with Import, `Export as .fdx`,
  `Export as .fountain` and Undo), banners, the scrolling column. Threads
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
  `_chrome/use-dismiss.ts`.
- **The Storyboard canvas (2026-09-17)** is a free surface: `_storyboard/canvas/` holds the view,
  the viewport hook (pan by pointer capture, zoom by ctrl/cmd + wheel), the SVG threads, the card
  with its `Storyboard | Lens` tabs, the lens selects and the `⋯` menu; every number it needs is
  `lib/storyboard/canvas.ts`, pure and tested. A card's position is `shots.canvas_x` / `canvas_y`
  (migration `0020`), cosmetic - the thread and the number follow `order_key`. Trap: the ground's
  `wheel` listener is added by hand with `{ passive: false }`; React's `onWheel` is passive and
  `preventDefault` there does nothing.
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
  `episode-route-page.tsx` went with it (Scenes was their last route).
- **The Research route (v2, 2026-09-16):** `_research/research-workspace.tsx` is the body -
  toolbar (the shared `_chrome/record-toolbar.tsx` pieces; the views are the header's), one of Library /
  Source / Clips or the empty card, the status bar - and `_chrome/research-layout.tsx` the shell
  on the Characters pattern, with the drawer (`_research/source-drawer.tsx`, the shared
  `_chrome/drawer-shell.tsx` portalled into `#research-drawer`) mounted once in the layout and
  opened through the cells in `lib/research/compose.ts`. The source being read is the path
  (`/research/:sourceId`); a clip is cut from a text selection in `source-view.tsx` and found
  again by text (`lib/research/view.ts`, `highlightParagraphs`); a filing points at a scene by
  its heading node id with no key. Everything the route reads is one `cache()`d `loadResearch`.
  The only route still on `?view=` (`library | source | clips`).
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
- **The Props route (built by the Props pass - this paragraph and the route as built are its only
  spec):** the one record route with **no derived half at all**. Nothing in a screenplay's grammar
  is a prop - a cue is a person, a slugline is a set, a bat is a noun in a line of action - so
  there is no derivation pass, no tally table and no resolve queue, and **the script is read back
  at request time as evidence** (`packages/script/src/props.ts`, `propEvidence`), never stored.
  The empty card therefore has **no `✦ Derive`**: there is nothing to derive, and minting records
  out of prose is what `entities.ts` deliberately refuses. `_props/props-workspace.tsx` is the
  body - toolbar (count chip, one `Display` menu holding the status filter, `＋ New`), one of
  `overview-view.tsx` (the card grid) or `list-view.tsx` (`Name ⇅ · Category ⇅ · Description`,
  the sort on the columns, not in a menu), the status bar, and `prop-drawer.tsx`. The views are
  client state (`_props/view-state.tsx`, **the provider is in the layout** or opening the drawer
  resets the tab); the URL stays `/props`, and `/props/:propId` is the drawer.
  `_chrome/props-layout.tsx` is the shell; the sidebar groups by **category**, because that is
  the only grouping a writer here has authored and the status is already the dot on every row.
  **The alias table is the route.** "Game Ball" is a record name; the page writes "the ball", so
  a record collects nothing until a spelling is bound (`prop_aliases`, `alias-table.tsx`) - and
  that table is `location_bound_sluglines` **minus its unique-per-project index**, because two
  props may both be "the bag" and both should collect the line. So binding has no `taken`
  outcome, there is no conflict block and there is no queue. Category is **free text offered from
  what the project already uses** (an input with a `<datalist>`, never a `<select>` and never an
  enum). A rename is **not** a write-back: a prop's name is written nowhere the app owns, so
  `renameProp` swaps the spelling that *was* the name and touches no node - AGENTS.md's "there is
  no third case" is untouched. Every derived line is `lib/props/view.ts`, pure and tested
  (`tests/props-view.test.ts`); `lib/props/server.ts` is one `cache()`d `loadProps` with every
  read in one `Promise.all` and **the evidence scored once at the alias level** (one entry per
  `(record, spelling)` pair) rather than once per record, so the node list is walked once.
  **Props is authoritative for a prop**, so Production's `scenes.prop` and `reel_shots.prop` are
  `prop_id` foreign keys (migration `0030`): `menuItems('prop')` reads the props table,
  `acceptsFreeText('prop')` is gone, the shot drawer has a `Prop` row and the Columns view a
  `Prop` column - none of which could be reached before, because that menu's vocabulary was the
  distinct values already stored and nothing could put a first one there. Trap: `result.ts` holds
  every constant, because a `'use server'` module may export nothing but async functions.
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
  `continuity.ts`, not rulings.
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
- **The Production route (v12, 2026-09-22 - `docs/production/production.md` is the spec, the
  mockup beside it clicked through, never imported; where they disagree the spec wins):**
  `_production/` is one component per file over `_chrome/production-layout.tsx` (the header
  gets `views={null}`; `Cards | Columns` is a `view_preferences` row, not a tab). The load is
  `lib/production/server.ts` (`loadProduction`, `cache()`d, over `readProductionEpisode` in
  `packages/db/src/repositories/production.ts`); authoring is `actions.ts`, the paid jobs
  `generate.ts`, the derived values `derive.ts` (pure, tested), and `pipeline/` the
  provider-neutral `spec.ts`, the Gemini client (`gemini.ts`, over `fetch`), the `after()`
  runner and `shotlist.ts` (the model's shotlist read strictly). The page polls every 3 s while a generation
  is live; there is no worker. Tables are `0026`'s on the spec's vocabulary - **`reel_shots`, not
  `shots`** (the Storyboard's), scenes keyed by `scene_node_id` with cast and lines derived at
  read time - plus `0027` (`reference_asset_ids`) and `0028` (`duration_s` 1–15); credits reuse
  `credit_ledger` (the generation id in `job_id`). Every cost, every enum and `MODEL_REGISTRY`
  are `packages/contracts/src/production.ts`; the tokens are `palette.css`'s
  `[data-production-root]` block and `.folio-prod-*` in `app/globals.css`. Traps: without
  `GEMINI_API_KEY` every generate button is drawn disabled and `✦ AI Shotlist` falls back to the
  rule-based proposal and says so; image and video outputs also need `R2_*`; Veo is not on the
  free tier, so a shoot the key cannot run lands in `failed` and refunds. The stale rules and the
  unpriced costs are provisional (open decision 14; the README's "Implementation" table).
  `pnpm --filter @folio/db seed:production -- --user <email>` writes a project in every state the
  walk (`e2e/production-route.spec.ts`, `E2E_PRODUCTION_URL`) expects.
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
  slice cell, the thread cards - and shares no block node with it.
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
