# Production v12 — design handoff

The Production route for the film workspace, as a runnable HTML mockup plus a written spec.
This is the visual and behavioural specification for implementation, not code to paste into
the app.

## Files

| File | What it is |
|---|---|
| `production.md` | **Read this.** Full spec: page anatomy, every element and state, enums, database schema, endpoints |
| `Route - Production v12.dc.html` | The mockup — open directly in a browser |
| `folio-data-v4.js` | Sample data (5 scenes, 5 reels, cast, frame states) the mockup renders from |
| `support.js` | Runtime needed to open the mockup in a browser |

All four files must stay in the same folder. `Route - Production v12.dc.html` exposes one
prop at the bottom of the file — `theme` (`dark` | `light`) — and the rail's last button
toggles it live.

## Seeing the states

The mockup opens with the **Production Settings** modal (that is the first-run state);
press `Confirm` to reach the board. From there:

- Scene tabs 1–5 cover the interesting cases: scene 1 = rendered + authoring reels,
  scene 2 = empty scene, scene 3 = generating + a refused shot, scene 4 = reel with no shots,
  scene 5 = out-of-date reel.
- View options (sliders icon) → switch Cards / Columns, toggle any of the 17 metadata fields.
- Filter icon → status filters, `Unassigned only`, sort.
- Drag a timing-bar segment edge to retime a shot; drag a shot card to reorder.
- Click a shot → detail drawer. Check shots → bulk bar.
- Header chip (art-style name) reopens Production Settings.

## What changed in v12

One storyboard **sheet** per reel replaces per-shot frames; the shotlist and the sheet sit
side by side; scene setup and scene image moved below them; a four-step readiness bar gates
`Start shooting`. Production Settings is a full modal with aspect ratio, four craft groups and
a 14-option art-style picker.

## Implementation (built 2026-09-22)

The route is built from this handoff end to end; the mockup was clicked through, never imported.
Where the spec and the mockup disagree the spec wins (the sheet button's three labels, the flex
sheet / image columns). What the spec leaves open was decided as below and is flagged for review.

| Concern | Where it lives |
|---|---|
| Schema | `packages/db/migrations/0025` (drops the v1 route), `0026` (the v12 tables and 26 enums, the 14 presets), `0027` (`reel_shots.reference_asset_ids`), `0028` (`duration_s` 1–15); `packages/db/src/schema/{production-enums,production,assets}.ts` |
| Contracts | `packages/contracts/src/production.ts` - enums, field ids, costs, `MODEL_REGISTRY`, row and edit schemas |
| Repository | `packages/db/src/repositories/production.ts` - one read per episode, the writes, the ledger's reserve / spend / release |
| Server | `apps/web/lib/production/` - `server.ts` (the load), `compose.ts` (the read model's composition), `actions.ts` (authoring), `generate.ts` / `generate-core.ts` (the paid jobs), `derive.ts` (the derived values), `pipeline/` (spec, Gemini client, runner, `connection.ts`) |
| Runner | the worker (`apps/worker`, roadmap task 4.3): `createGeneration` queues a `production_generation` job with the reservation; `apps/web/lib/worker/production-generation.ts` runs it; the reaper (`lib/worker/reaper.ts`) fails a generation left with no live job as "interrupted"; the sweeper (`lib/worker/sweeper.ts`) logs unreferenced media |
| Body | `apps/web/app/(app)/app/project/[projectId]/_production/` - one component per file; `_chrome/production-layout.tsx` |
| Tokens | the mockup's `:root` / light blocks verbatim in `packages/ui/src/tokens/palette.css`, scoped to `[data-production-root]`; the numbers in `.folio-prod-*` in `apps/web/app/globals.css` |
| Seed | `pnpm --filter @folio/db seed:production -- --user <email>` - a project with every state this README lists |
| Walk | `apps/web/e2e/production-route.spec.ts`; `E2E_PRODUCTION_URL` points it at the seeded project for the five states |

Deviations from the spec, each with its reason:

- **URL** is `/app/project/:projectId/:episodeId/production` (film projects collapse the segment) -
  the repo's routing rules; the spec's path maps one to one.
- **The shot table is `reel_shots`** - `shots` is the Storyboard's, untouched. Scenes are keyed by
  `scene_node_id` (the heading node's id, open decision 10); scene facts, cast and lines are
  derived from the script at read time, never stored (`scene_cast`, `scene_script_lines` not built).
- **Scene setup overrides live on `scenes`** (`camera_body, lens, prop_id, location_id, int_ext,
  shoot_date, priority`, plus `still_asset_id` / `still_state`) - the spec leaves them unstored.
  `prop` was free text here and on `reel_shots` until the Props route existed; both are
  `prop_id` foreign keys since migration `0030`, and **Props is authoritative for a prop**
  (`apps/web/CLAUDE.md`). Both columns held zero rows, so nothing was migrated.
- **Credits** reuse the append-only `credit_ledger` (the generation id in `job_id`); the balance is
  computed, so no `balance_after`. Costs the spec does not price: shot frame 4, scene image 40,
  AI shotlist 0, propose 0 (sheet 40 and shoot 375 as specified), and - added 2026-09-24 with the
  copilot's production pipeline (roadmap task 5.1) - a **location plate at 40, provisional**: the
  client asked for a plate drawn from a location's description when there is no photo, and left its
  price to decide (open decision 14). It is stored as the location's photo, which is the plate.
- **`generations` carries `route` and `source_hash`** (AGENTS.md's pipeline rule) and an `error`
  column; the writer never sees a model id. `MODEL_REGISTRY` names Gemini models (client ruling).
- **Generations run on the worker**, not in the request (roadmap task 4.3; the first build used
  `after()`). Until the worker is deployed, a generation waits `queued` with its credits held and
  Cancel live. The old page-load sweep that failed anything `running` for ten minutes is gone.
- **No realtime**: the page polls every 3 s while a generation is live. No `theme` in
  `view_preferences` - the theme is the shell's.
- **`assets`** holds Production media only; character portraits and location photos stay keys on
  their records and are read as the appearance / plate references.
- **Stale rules** (spec silent): a rendered reel goes stale when a shot's description, duration,
  order, type or motion changes or the sheet is redrawn; a drawn frame goes stale when its shot's
  description or camera changes; a done sheet is not invalidated by shot edits (the spec's reel 5).
- **Readiness step 3 counts an uploaded still** as well as a drawn one - `Upload scene` sits under
  that step.
- **Reel `⋯`** = Rename · Delete; the drawer's References `＋` uploads an image
  (`assets.kind = 'reference'`, `reel_shots.reference_asset_ids`).
- **Veo** durations are 4 / 6 / 8 s (a 5 s clip asks for 6, the longer three for 8); a shoot that the key
  cannot run fails and refunds. Free-text **lens** values come through the menu's search; a prop is
  picked from the props table (`0030`), and a new one is made on `/props`.
- **`✦ AI Shotlist` without `GEMINI_API_KEY`** falls back to the rule-based proposal and says so.
