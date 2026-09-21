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
