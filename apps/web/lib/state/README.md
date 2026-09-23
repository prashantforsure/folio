# Client state — the six places, and why they are six

AGENTS.md, Tech stack: **"URL first, then React state. Zustand only for the agent window rect and
session flags."** AGENTS.md, Development philosophy 3: **"The URL is the state container. Route,
episode, sub-view and selected record all come from the URL. The exceptions are named in the
*Sub-views are query params — except* table below."**

That exception table has grown, route by route, and the things outside the URL no longer share one
home. Collapsing them into a single store would be convenient exactly once — the first time, before
the differences start costing something.

| Mechanism | File | Holds | Survives |
| --- | --- | --- | --- |
| React Context → **localStorage**, per user | [theme.tsx](theme.tsx) | `theme` | a closed browser? yes. a new device? no |
| **Zustand + `persist` → sessionStorage**, per tab | [session.ts](session.ts) | `zoom`, `navOpen`, `sideOpen`, `sideTab`, `assistantOpen`, `colourCues` | a route change; not a closed tab |
| React Context, **ephemeral** | [ephemeral.tsx](ephemeral.tsx) | `paletteOpen`, `aiScope`, `assistantPrompt`, `assistantFocus` | nothing |
| **A database row, per project** | [project-preferences.ts](project-preferences.ts) → `projects.page_mode` / `projects.live_repaginate` | `pageMode`, `liveRepaginate` | everything — it is shared with collaborators |
| **A database row, per user + episode** | `view_preferences` | Production's `Cards \| Columns` and its 17 field toggles | everything |
| Module-level cells (`useSyncExternalStore`) and per-route React Context | `lib/workspace/open-cell.ts`'s `createCell`; `_<route>/view-state.tsx` | each route's sub-view, its selection, its drawer | a route change, or not, per route — see below |

`viewport.ts` sits beside these as the one resize listener; it holds no state of its own.

## Why the boundaries are where they are

**`theme` is per person, not per tab.** Someone who sets light mode has said something about their
eyes, not about this window. localStorage, so a second tab agrees and a reopened browser remembers.
It is also the one item that must be applied *before first paint*, which is why it has an inline
script and the others do not.

**`pageMode` and `liveRepaginate` are per project, and a project has collaborators.** They are not a
personal preference: AGENTS.md's exception table calls them "Two rendering modes plus a cadence
flag, not three peer modes" and puts them "per project, not in the URL". Two writers looking at the
same script should see the same pagination, and a page count that depends on which laptop you
opened it on is the beginning of the drift the whole product exists to prevent. **They are two
columns on `projects`** — migration `0003`, ruled by the client on 2026-09-11, writable by any
member. `setProjectPagination` in `@folio/db` is the write and `setPagination` in
`lib/script/actions.ts` the server action over it; this file is the `minimal | paged | live`
control's mapping onto the pair, and nothing else.

**The session flags are window geometry.** They describe a window. A second tab is a second window
and should be free to differ, and none of it is worth persisting past the tab that produced it.
sessionStorage is exactly that lifetime, and it is the one AGENTS.md names Zustand for.
`assistantOpen` is here for the same reason — the panel is the same panel on every route, so which
route you are on must not decide whether it is open. `PanelState` is `boolean | null`, where `null`
means "the route decides".

**`paletteOpen` and `aiScope` are ephemeral.** A command palette that remembers it was open is a
command palette that opens by itself. Plain React state; nothing to persist and nothing to clean up.
`assistantPrompt` and `assistantFocus` are here too, and they are the one-directional channel from a
route to the assistant panel: a drawer publishes the record it has open, the panel reads it, and the
publisher clears it on unmount. **Nothing goes back the other way.**

> `aiScope` is placed here on the client's instruction for this phase. AGENTS.md's exception table
> groups it with the session flags. If a scope selection is meant to survive a route change, this is
> the line that moves it.

**Sub-views are the exception that grew.** AGENTS.md ruled them query params, and then ruled them
back out one route at a time — Characters (2026-09-16), Storyboard and Scenes (2026-09-17),
Locations and Timeline (2026-09-18), Props (the Props pass) — each on the same ask: switching must
be instant and the URL must not move. **Research is the only route still on `?view=`.** Two shapes
carry the rest, and which one a route uses is not a style choice: a **module-level cell** where the
header and the body are in different React trees with no shared layout (Storyboard, Scenes), and a
**React Context in the route's own layout** where there is one, so opening the drawer does not reset
the tab (Characters, Locations, Props, Timeline). Production is neither — its view is a
`view_preferences` row, because it is a per-user setting the writer expects to find again.

**There is no `?panel=`.** The client's brief specified one on the Script route and then withdrew
it; which document the Script shows and which panel tab is open are component state, and a stale
`?doc=cover` or `?panel=collab` link is an **unknown key** that opens the route rather than 404ing
(`lib/workspace/params.ts`, asserted in `tests/workspace-routes.test.ts`).

## What none of these may become

A place to keep something that belongs in the URL. If a value should survive a link being pasted
into Slack — the route, the episode, the selected record — it is a query param, and adding one is a
question for a human (AGENTS.md, When to ask first). A new `?view=` also needs a row in `ROUTE_VIEWS`
(`lib/workspace/views.ts`) or `tests/workspace-routes.test.ts` fails.
