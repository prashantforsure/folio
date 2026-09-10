# Client state — the four places, and why they are four

AGENTS.md, Tech stack: **"URL first, then React state. Zustand only for the agent window rect and
session flags."** AGENTS.md, Development philosophy 3: **"The URL is the state container. Route,
episode, sub-view and selected record all come from the URL. Only the items listed in *State not in
the URL* live anywhere else."**

Nine things are not in the URL. They do not all live in the same place, and collapsing them into one
store would be convenient exactly once — the first time, before the differences start costing
something.

| Item | Lives in | File | Survives |
| --- | --- | --- | --- |
| `theme` | localStorage, per user | [theme.tsx](theme.tsx) | a new device? no. a closed browser? yes |
| `pageMode` | **a database row, per project** | [project-preferences.ts](project-preferences.ts) | everything — it is shared with collaborators |
| `liveRepaginate` | **a database row, per project** | [project-preferences.ts](project-preferences.ts) | everything |
| `zoom` | sessionStorage, per tab | [session.ts](session.ts) | a route change; not a closed tab |
| `navOpen` | sessionStorage, per tab | [session.ts](session.ts) | a route change |
| `sideOpen` | sessionStorage, per tab | [session.ts](session.ts) | a route change |
| `sideTab` | sessionStorage, per tab | [session.ts](session.ts) | a route change |
| `paletteOpen` | React state | [ephemeral.tsx](ephemeral.tsx) | nothing |
| `aiScope` | React state | [ephemeral.tsx](ephemeral.tsx) | nothing |

## Why the boundaries are where they are

**`theme` is per person, not per tab.** Someone who sets light mode has said something about their
eyes, not about this window. localStorage, so a second tab agrees and a reopened browser remembers.
It is also the one item that must be applied *before first paint*, which is why it has an inline
script and the others do not.

**`pageMode` and `liveRepaginate` are per project, and a project has collaborators.** They are the
one pair here that is not a personal preference: AGENTS.md's exception table calls them "Two
rendering modes plus a cadence flag, not three peer modes" and puts them "per project, not in the
URL". Two writers looking at the same script should see the same pagination, and a page count that
depends on which laptop you opened it on is the beginning of the drift the whole product exists to
prevent. That makes them a database row. **The schema has no home for them yet** — see
`project-preferences.ts`, which is a flag, not an implementation.

**The four session flags are panel geometry.** They describe a window. A second tab is a second
window and should be free to differ, and none of it is worth persisting past the tab that produced
it. sessionStorage is exactly that lifetime, and it is the one AGENTS.md names Zustand for.

**`paletteOpen` and `aiScope` are ephemeral.** A command palette that remembers it was open is a
command palette that opens by itself. Plain React state; nothing to persist and nothing to clean up.

> `aiScope` is placed here on the client's instruction for this phase. The design README lists it as
> session state alongside the panel flags, and AGENTS.md's exception table groups it with them.
> If a scope selection is meant to survive a route change, this is the line that moves it.

## What none of these may become

A place to keep something that belongs in the URL. If a value should survive a link being pasted
into Slack — the route, the episode, the sub-view, the selected record — it is a query param, and
adding one is a question for a human (AGENTS.md, When to ask first).
