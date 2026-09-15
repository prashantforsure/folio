# Laper — v2 design handoff

Nine redesigned routes for the screenwriting workspace, as HTML mockups. Read this file
first, then read the route files. Everything a route needs — tokens, layout, sample data —
is inside that one file.

**What this package is for:** implementing this design in the real codebase. These files are
the visual and behavioural spec, not code to copy in. Port the layout, tokens, states and
interaction rules into whatever component system the app already uses.

---

## Files

| File | Route | Views inside it |
|---|---|---|
| `Route - Script v2.dc.html` | Script editor | Document |
| `Route - Outline v2.dc.html` | Outline | Outline |
| `Route - Scenes v2.dc.html` | Scenes | Cards · Index · List |
| `Route - Storyboard v2.dc.html` | Storyboard | Board · Canvas · List |
| `Route - Characters v2.dc.html` | Cast | Cast · Profile |
| `Route - Locations v2.dc.html` | Locations | Grid · Detail |
| `Route - Timeline v2.dc.html` | Timeline | Lanes |
| `Route - Research v2.dc.html` | Research | Library · Source |
| `Route - Production v2.dc.html` | Production | Shots · Frames · Reels |
| `support.js` | runtime for opening the mockups in a browser | — |

Open any `.dc.html` directly in a browser to see it live. `support.js` must sit beside them.

Each route exposes a small set of props at the bottom of its file (`theme`, `view`,
`drawer`, `assistant`, `empty` and route-specific ones) so you can render every state
without editing code. Use them to see the empty states and the light theme.

**Routes removed in this redesign:** Insights and Bible. Neither exists any more — they are
gone from the rail on every page, and there is no route file for either.

---

## The design language

The redesign moved the app away from a Notion-style document tool toward a dark,
chrome-light workspace. Four rules drive everything:

1. **Dark canvas, no paper.** Pages are text on the app background separated by hairlines,
   never white sheets floating on grey. There is one background colour; depth comes from
   translucent white surfaces stacked on it.
2. **Chrome floats and disappears.** Panels are rounded translucent cards with a 1px
   hairline border and a backdrop blur, sitting over two large ambient radial glows. No
   opaque bars, no hard dividers between regions.
3. **Nothing permanent that isn't used constantly.** Anything contextual is a panel that
   opens on demand. Toolbars were replaced by the `/` menu in the writing routes.
4. **Content over controls.** Reading columns cap at 740–820px. Numbers are tabular.
   Labels are sentence case and plain-spoken.

### Tokens

Every route declares the same `:root` block and the same `[data-theme="light"]` override.
Copy it verbatim — it is the design system.

```
--bg      #0a0a0c      page background (light: #f7f6f3)
--sunk    #08080a      recessed: inputs, side panels (light: #f2f0ec)
--s1/2/3  rgba(255,255,255,.035 / .055 / .085)   surface steps
--line    rgba(255,255,255,.085)  --line2  rgba(255,255,255,.05)
--ink     #f3f2ef      --ink2 62%   --ink3 36%
--read    80% ink      long-form body copy only
--accent  oklch(.72 .12 245)   +  --accent-bg at 16%
--ok      oklch(.76 .10 150)   green   — done, saved, settled
--warn    oklch(.80 .11 75)    amber   — conflicts, blocked, draft
--live    oklch(.72 .14 40)    orange  — destructive, live, over-budget
--solid   #f3f2ef  on --solid-ink #0d0d10    inverted primary button
--glow-cool / --glow-warm     the two ambient radial washes
```

Semantic colour is strict: green means settled, amber means needs a decision, orange means
destructive or live. Accent blue is for links, selection and AI actions only. No other hues.

### Type

Geist (200–600) and Geist Mono, from Google Fonts.

- Page title `27px/400`, letter-spacing `-.02em`
- Section heading `14–17px/500`, `-.01em`
- Body `13–15px`, line-height `1.55–1.65`, `text-wrap: pretty`
- Meta and captions `11–12.5px`
- Eyebrow labels `10.5–11px/500`, uppercase, letter-spacing `.1em`, `--ink3`
- Mono for scene refs, IDs, timecodes, counts, paths — always `tabular-nums`

### Shape and motion

Radii: 7–10px controls, 12–13px cards, 16px panels, 18px on the main surface's top-left
only, 999px pills. Transitions are `.14s` on background, colour, border and opacity —
nothing else animates. The one exception is the assistant orb's 9s drift.

---

## Shell

Every route is the same three-part shell. Implement it once.

```
┌────┬──────────┬─────────────────────────────┬────────┐
│rail│ sidebar  │ header                      │ panel  │
│56px│ 236px    ├─────────────────────────────┤ 400px  │
│    │          │ toolbar                     │        │
│    │          │ content                     │        │
│    │          │ status bar (28px)           │        │
└────┴──────────┴─────────────────────────────┴────────┘
```

**Rail (56px, fixed).** Sidebar toggle at top, then the six route icons — Writing,
Characters, Locations, Timeline, Research, Production — then theme toggle and Help at the
bottom. All custom 18px/1.35-weight stroke SVGs matching the product's glyph set; no icon
fonts. Active icon: `--s2` background, `--ink` stroke. Inactive: `--ink3`.

**Sidebar (236px, collapsible).** A floating `--s1` card, 16px radius: project name and a
`+`, a recessed search field, the grouped item list, and one summary widget pinned to the
bottom (coverage, budget — whatever that route counts). Groups get an eyebrow label and a
count. Selected item: `--s2` fill, full-strength ink.

**Header (60px).** Breadcrumb on the left, `Share` and the assistant orb on the right.
The Write / Storyboard mode pill lives here **only in the writing routes** (Script,
Outline, Scenes, Storyboard). It was removed from Characters, Locations, Timeline, Research
and Production — those are outside the writing surface.

**Main surface.** One `--s1` card with `border-radius: 18px 0 0 0` and a backdrop blur,
holding the toolbar, the scrolling content, and the status bar.

**Toolbar.** Route name, a count chip, then the view-switcher pill (rounded segmented
control, `--s2` on the active tab), then `flex:1`, then secondary buttons and one solid
primary action. It wraps rather than overflows.

**Status bar (28px).** Counts on the left; Hide/Show nav, a green Saved dot, and the mono
route path on the right.

### Panels (assistant and drawer)

Both are 400px, `--sunk`, one left hairline.

- Above 1200px they are **in flow** — the layout shrinks to make room.
- Below 1200px they are **absolutely positioned** over the content with a
  `-24px 0 70px` shadow, and `main` gets a matching `margin-right` so nothing is trapped
  under them.
- Below 1200px an open panel also **forces the sidebar closed.** This matters: 236px of
  sidebar plus 400px of panel out of a ~950px viewport leaves the content column at
  ~230px, which breaks every child layout. Solve it at the shell, not in the children.

**Assistant.** Opened by the orb in the header. A radial-gradient sphere (`#e8f6ff →
#8fd4ff → #2a7fd4 → #123a72`) with a blue glow. Panel contents: `New chat` dropdown and a
close ✕; a 124px orb with a slow drift animation; "How can I help?" and a route-specific
subhead; three suggestion chips, each with a small semantic square; then the composer —
"Ask, or @ to add context…", an attach `+`, dictate, and a solid send button. **The header
orb hides while the panel is open** and returns when it closes.

**Drawer.** The edit surface for the selected item — fields, a status segmented control, a
list of the item's sub-records, linked chips, and a footer with a destructive action on the
left and Cancel / Save on the right.

### Breakpoints

- `≥1200px` — panels in flow
- `≥1040px` — sidebar open by default
- `<1200px` with a panel open — sidebar forced closed
- Below that, panels overlay at `min(400px, 92vw)`

A manual sidebar toggle overrides the default but not the forced-closed rule.

---

## Patterns to reuse

**`/` menu, not a toolbar.** In the writing routes all content operations — Text, Heading,
Quote, Divider and so on — come from the `/` menu. Formatting toolbars and the old
Scene/Action tabs were removed.

**Citation chips.** Any claim that comes from the script carries the scene refs that prove
it as small mono chips. No refs renders as "Not on the page yet" in `--ink3`.

**Conflict blocks.** When the app detects a disagreement between a record and the script,
the card border turns `--warn`, and an amber block appears inline with the explanation and
two buttons: accept the change, or mark it deliberate. The app never edits the script.

**Episode bars.** Per-episode distribution as a row of 14×4px bars, strongest at `--ink2`,
absent at `--line2`, with the numbers in the `title` attribute.

**Empty states.** A single 440px card: heading, one paragraph of plain explanation, an
accent AI action plus a manual alternative, and a one-line caveat. Never an illustration.

**Status as a dot plus a pill.** Six-pixel dot in lists, coloured pill on detail pages,
segmented control in the drawer. Same colour throughout.

---

## Copy tone

Plain, specific, lower-case-leaning. Labels say what happens: "Draft from the script",
"It's deliberate", "Not on the page yet". No exclamation marks, no emoji, no feature
marketing. Sample content across the routes belongs to one fictional project
("Monsoon Line") so the mockups read as a real workspace.

---

## Implementation notes

- All styling in these files is inline. That is an artefact of the mockup format — port it
  into the app's normal styling system. The `:root` token block is the part to keep.
- The sample data in each file's `data()` method is illustrative. Replace it with real
  queries; keep the derived fields (counts, "n of m on the page", conflict flags) since the
  UI depends on them.
- Light theme is complete and tested on every route. Do not ship dark-only.
- Focus rings are `box-shadow: 0 0 0 2px var(--accent)` on every interactive element.
  Keep them.
- Scrollbars are themed: 10px, rounded, `--s3` thumb, transparent track.
- Long text uses `min-width: 0` on flex children plus ellipsis or `text-wrap: pretty`.
  Both are needed; layouts break at narrow widths without them.
