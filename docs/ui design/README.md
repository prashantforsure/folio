# Handoff: Laper — project workspace (script writing routes)

## Overview

This bundle contains the design for the **inside-a-project** part of Laper: the workspace a
writer lands in after opening a project. It covers the writing surface (script, outline,
scenes, beats, storyboard), the project-level reference routes (characters, locations,
timeline, bible, research, insights, production), and the cross-cutting surfaces
(revisions/diff, notes, command palette, settings).

The app is a screenwriting tool with an AI assistant. The central design principle in these
mocks: **the script sheet is the product**. Every other route is either derived from the
script (scenes, locations, characters are parsed out of scene headings and character cues) or
is context the AI reads (bible, research). Chrome yields; the page never does.

## About the design files

The `.dc.html` files in this bundle are **design references written in HTML**. They are
prototypes that show intended look, layout, copy, and interaction — **they are not production
code to copy**. They use a small custom template runtime (`support.js`, `<x-dc>`,
`{{ holes }}`, `<sc-for>`, `<sc-if>`); ignore that runtime entirely.

**Your task:** recreate these designs in the target codebase.

- **Target stack: Next.js (App Router) + React + Tailwind CSS.**
- **Scope for this pass: frontend only, mock data.** No database, no API calls, no auth.
  All data comes from local TypeScript fixture modules. Every screen must render and every
  navigation/toggle must work against those fixtures.
- A proposed data model and API sketch is in **Appendix A** at the end of this document. Do
  not implement it yet — it exists so the fixture shapes you write now line up with the
  backend later. Name your fixture types to match Appendix A.

Read the HTML files for exact values. The README describes intent, structure, behavior, and
tokens; the files are the source of truth for every pixel, hex, and string of copy.

## Fidelity

**High fidelity.** Colors, type, spacing, and copy in these files are final and deliberate.
Recreate pixel-perfectly. Two specific things not to "improve":

1. **Density.** This is a professional tool. Font sizes of 11–13px in chrome are intentional;
   do not bump them to a 14/16px web default. The only place type gets large is the script
   sheet itself (12pt Courier at true page geometry).
2. **The copy.** Every label, empty state, and explanatory line is written. Keep it verbatim.

## File map

| File | What it is |
|---|---|
| `Screenwriting App v2.dc.html` | **The shell — start here.** Icon rail, context panel, page header, right panel, command palette, settings, all-projects list. Contains inline versions of several routes. |
| `Screenwriting App.dc.html` | v1 of the shell. Superseded; keep only for reference. |
| `Route - Script.dc.html` | The script editor sheet. Props: `content: draft \| empty`. |
| `Route - Outline.dc.html` | Act/scene outline. |
| `Route - Scenes.dc.html` | Scene list. Views: `cards \| index \| list`. |
| `Route - Beats.dc.html` | Beat board. Views: `beats \| arrangement`. |
| `Route - Storyboard.dc.html` | Shot/board view. Views: `board \| canvas \| list`. |
| `Route - Characters.dc.html` | Character records. Views: `profile \| map \| resolve`. |
| `Route - Locations.dc.html` | Location records. Views: `record \| breakdown \| resolve`. |
| `Route - Timeline.dc.html` | Cross-episode threads. Views: `story \| chrono \| continuity`. |
| `Route - Bible.dc.html` | Series bible. Views: `entry \| check \| glossary`. |
| `Route - Research.dc.html` | Source library. Views: `library \| source \| clips`. |
| `Route - Insights.dc.html` | Analysis + AI lenses. Views: `pacing \| presence \| showrunner \| viewer`. |
| `Route - Production.dc.html` | Production/generation surface. Modes: `authoring \| empty \| generating \| finished`. |
| `Route - Revisions.dc.html` | Revision diff. Views: `diff \| history`. |
| `Route - Notes.dc.html` | Notes/comments inbox. Filters: `open \| mine \| resolved \| all`. |
| `support.js` | The mock runtime. **Do not port.** |
| `screenshots/` | One PNG per file, for visual reference. |
| `original-spec/` | The original route spec doc and its screenshots. |

Each `Route - *.dc.html` is a **full-bleed design of one route's main pane** (some include
their own chrome for context). The shell file defines the frame those panes live inside.

## App shell

Three fixed columns plus the page. Left to right:

### 1. Icon rail — 52px, `--rail`, 1px right border `--line`

- Top: 24×24px project chip, `border-radius: 6px`, background `--ink`, text `--desk`,
  10px/600 — project initials (`ML`).
- Nav buttons: 34×32px, `border-radius: 8px`, 14px glyph. Active = background `--sel`, icon
  `--ink`. Inactive = transparent, icon `--ink3`. Hover = `--hover`.
- Order and glyphs: Writing `✎`, Characters `◍`, Locations `⌖`, Timeline `◷`, Bible `◈`,
  Research `▧`, Insights `◎`, Production `▶`.
- Badge (optional): absolutely positioned top-right, min 13px tall, `border-radius: 7px`,
  background `--note`, text `--rail`, 8.5px/700.
- Bottom, in order: settings `⚙`, all-projects `⌂`, theme toggle (`☾`/`☀`), then a 24px
  round avatar.
- Every button has a `title` (native tooltip) — keep as `aria-label` + tooltip.

### 2. Context panel — 236px, `--panel`, 1px right border

Contents change by section. Header row: panel title (12.5px/600, truncating) + `＋` and `⋯`
buttons (22×22px, `border-radius: 5px`).

Below it, the search trigger: full-width button, 1px `--line2`, `border-radius: 6px`,
5px/8px padding, 11.5px `--ink3`, label `Search or jump to…` with `⌘K` on the right. Opens
the command palette.

Then a scrolling `nav` with `gap: 12px` between groups:

- **Writing sections** show: a collapsible `Episode board` row with a count pill (6);
  when open, an episode list (`E1 Standpipe 104`, `E2 The Tiffin 97`, `E3 Chawl Water 118`
  (selected), `E4 Blue Bucket 12`) — number 10px `--ink3`, title 11.5px truncating, page
  count 9.5px. Then an uppercase 9.5px/600 `.09em` tracked group label (`Episode 3`), then
  the episode routes (Script 118pp, Outline 3 acts, Scenes 41) with a 13px glyph column and
  right-aligned meta. Then a second group `SCENES IN E3` listing scene headings in
  **Courier Prime 11px uppercase**, truncating, with eighths on the right.
- **Entity sections** (characters, locations) show filter rows with counts, plus a
  derivation note in `--ink3`.
- **Project sections** show sub-route lists (e.g. Timeline: Story order / Chronology /
  Threads; Settings: Account, Format & language, Collaborators, Plan & credits, Import &
  export, Keyboard with their paths as meta).

### 3. Page header

Title (`pageTitle`) plus a single meta line (`pageMeta`) — e.g.
`Script` / `Episode 3 · Chawl Water · 118 pages · Rev. Blue`. Right side holds
context-dependent controls: view toggle segments, paged/continuous toggle, zoom control
(`Fit 84%`), panel show/hide buttons.

### 4. Right panel — 284px, only in Script

Two mutually exclusive modes selected by tabs: **Info** (stats list: Pages 118, Scenes 41,
Speaking characters 17, Locations 17, Comments (not exported) 12, Words 24,180) and
**Composer** (the AI surface: scope selector + lens selection).

### Responsive rules (important, and unusual)

The panels collapse before the page does. The script sheet is fixed in inches and never
scales to fit chrome; chrome gets out of its way.

```
context panel auto-shows at viewport >= 1000px
right panel   auto-shows at viewport >= 1280px
available     = viewportWidth - 52 - (ctx ? 236 : 0) - (right && script ? 284 : 0) - 48
fitZoom       = clamp(available / 816, 0.5, 1)     // 816px = 8.5in at 96dpi
```

Manual show/hide overrides the automatic behavior until reset. Zoom cycles
`fit → 100% → 75% → fit`.

## The script sheet

Non-negotiable geometry — this is what makes the app credible to screenwriters.

- **US Letter**, 816px wide at 96dpi (8.5in), text block 6.0in.
- **Courier Prime 12pt**, 12 lines per inch. Line height is a fixed multiple; do not use
  relative line-height.
- Element indents follow standard US screenplay format. In the mock, at the reduced preview
  scale, character cue is `padding-left: 78px` and dialogue `padding-left: 46px`; derive real
  indents from standard format (character 3.7in, dialogue 2.5in, parenthetical 3.1in from
  page left) rather than copying the mock's preview pixels.
- Scene headings and character cues are `text-transform: uppercase`.
- **Paged vs Continuous** mode toggle. Paged shows real page breaks and page numbers.
- Sheet colors are tokenized separately from app chrome (`--sheet`, `--sheet-ink`,
  `--sheet-line`, `--sheet-edge`) because **in dark mode the sheet is tinted (`#252420`),
  never white and never pure black**. Same geometry in both themes.
- Element type is chosen by a numbered menu: 1 Scene, 2 Action, 3 Character, 4 Paren,
  5 Dialogue, 6 Transition, 7 Comment, 8 Subtitle. Keys `1`–`8` should set the current
  element type.

## Interactions & behavior

| Trigger | Result |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘J` / `Ctrl+J` | Jump to Script with the AI composer open in the right panel |
| `Esc` | Close palette |
| Rail button | Switch section |
| Context-panel row | Switch route / select entity |
| Header segment | Switch sub-view within a route |
| Zoom button | Cycle fit → 100% → 75% |
| Panel toggle | Show/hide context or right panel, overriding auto |
| Theme button | Toggle light/dark |
| Scope button (composer) | Cycle Selection → Scene → Act → Full draft |

**Command palette:** 520px wide, `max-width: 92vw`, `border-radius: 12px`, opens at `13vh`
from top over a `rgba(15,12,8,.28)` scrim. Results are grouped with uppercase 9.5px group
labels — Scenes, Locations, Actions — each row `icon · label · right-aligned hint`. Actions
carry a cost/latency hint (`queued job`, `instant · free`). Clicking the scrim closes;
clicking the sheet must not.

No route transitions or page animations. Hover feedback only, instant.

## State (frontend pass)

Shell-level state, all URL-derivable where possible:

```
route            which section/route is showing        -> from the URL
episodeId        active episode                        -> from the URL
subView          per-route view segment                -> ?view= query param
selectedId       selected scene/character/location     -> ?selected= query param
theme            'light' | 'dark'                      -> persisted (localStorage)
pageMode         'paged' | 'continuous'                -> persisted per project
zoom             'fit' | number                        -> session
ctxPanelOpen     boolean | null (null = automatic)     -> session
rightPanelOpen   boolean | null (null = automatic)     -> session
rightPanelMode   'info' | 'composer'                   -> session
paletteOpen      boolean                               -> ephemeral
aiScope          'selection' | 'scene' | 'act' | 'draft'
```

Follow the URL shapes from the original spec doc:

```
/app/project/:projectId/:episodeId/script
/app/project/:projectId/:episodeId/outline
/app/project/:projectId/:episodeId/storyboard?selected=SCENE_xxx
/app/project/:projectId/:episodeId/scenes
/app/project/:projectId/:episodeId/production
/app/project/:projectId/characters
/app/project/:projectId/locations
...
/app/project/:projectId/settings/format
```

Project-level routes have **no** `:episodeId`; episode-level routes do. Settings is a **page
with linkable sub-routes, not a modal**.

## Design tokens

Ported verbatim from the mock's `:root`. Put these in `tailwind.config` as semantic color
names (`desk`, `panel`, `rail`, `line`, `ink`, `sheet`, …) driven by CSS variables, with dark
mode via a `data-theme="dark"` attribute — not Tailwind's `dark:` class variant, because the
mocks nest a light sheet preview inside a dark page and vice versa.

### Light

```
--desk        #f3f1ed      page/desk background
--panel       #fbfaf8      context & right panels
--rail        #f7f5f1      icon rail
--line        rgba(30,26,20,.10)     primary border
--line2       rgba(30,26,20,.055)    subtle divider
--ink         #221f1a      primary text
--ink2        rgba(34,31,26,.64)     secondary text
--ink3        rgba(34,31,26,.40)     tertiary / meta
--hover       rgba(30,26,20,.055)
--sel         rgba(30,26,20,.085)
--sheet       #ffffff
--sheet-ink   #191713
--sheet-line  rgba(0,0,0,.10)
--sheet-edge  rgba(0,0,0,.14)
--accent      oklch(0.52 0.13 285)   violet — selection, links, AI
--accent-bg   oklch(0.52 0.13 285 / .09)
--accent-line oklch(0.52 0.13 285 / .28)
--add         oklch(0.50 0.11 150)   green — additions, accepted
--add-bg      oklch(0.50 0.11 150 / .10)
--del         oklch(0.52 0.14 25)    red — deletions, rejected
--del-bg      oklch(0.52 0.14 25 / .09)
--note        oklch(0.58 0.10 75)    amber — proposals, notes, badges
--note-bg     oklch(0.58 0.10 75 / .11)
--focus       oklch(0.58 0.14 250)   focus ring only
--shadow      0 1px 2px rgba(20,16,10,.05), 0 8px 28px rgba(20,16,10,.07)
```

### Dark

```
--desk #121211  --panel #1a1a18  --rail #171715
--line rgba(240,235,225,.11)   --line2 rgba(240,235,225,.06)
--ink #e7e2d8   --ink2 rgba(231,226,216,.62)   --ink3 rgba(231,226,216,.36)
--sheet #252420 --sheet-ink #ded8cd
--sheet-line rgba(255,255,255,.10)  --sheet-edge rgba(255,255,255,.07)
--hover rgba(240,235,225,.06)  --sel rgba(240,235,225,.10)
--accent oklch(0.76 0.11 285)  --accent-bg oklch(0.76 0.11 285 / .13)
--accent-line oklch(0.76 0.11 285 / .34)
--add oklch(0.76 0.10 150) / .13   --del oklch(0.74 0.12 25) / .13
--note oklch(0.78 0.09 75) / .13   --focus oklch(0.74 0.12 250)
--shadow 0 1px 2px rgba(0,0,0,.35), 0 10px 34px rgba(0,0,0,.42)
```

The palette is warm-neutral. **Do not substitute Tailwind's default gray/slate scale** — it
is cool and will kill the whole look.

### Type

- **UI: Instrument Sans** (Google Fonts), weights 400/500/600.
- **Script sheet, scene headings, code-ish chips: Courier Prime**, 400/700 + italic.
- Scale in use: 9.5px (uppercase group labels, `.08–.09em` tracking), 10px / 10.5px (meta),
  11.5px (secondary), 12px, 12.5px (body/rows), 13px (card titles), 14px (palette input).
  Headings use `letter-spacing: -.01em`.
- Numerals in counts and page numbers: `font-variant-numeric: tabular-nums`.

### Geometry

- Radii: 5px (small buttons) · 6px (rows, chips) · 7px (inputs, segments) · 8px (rail
  buttons) · 9–10px (cards, tables) · 12px (palette).
- Rail 52px · context panel 236px · right panel 284px · sheet 816px.
- Content max-widths by route: 640px (settings), 760px (bible), 820px (research),
  900px (insights), 1040px (projects).
- Focus state everywhere: `box-shadow: 0 0 0 2px var(--focus)` with `outline: none`.
  Keep it — keyboard navigation matters in this app.

## Assets

None. No images, no icon library — every glyph is a Unicode character rendered as text
(`✎ ◍ ⌖ ◷ ◈ ▧ ◎ ▶ ⚙ ⌂ ☾ ☀ ⌕ ＋ ⋯ ▤ ▢ ⋮ ▾ ▸ ⌘ ⎋`). If you swap in an icon library
(Lucide is fine), keep the same optical weight — these are light, 1px-ish glyphs, not filled
icons. Image placeholders in the storyboard route are meant to be real thumbnails later.

## Changes from the original spec doc

`original-spec/` holds the route spec you started from. The design **renames and
restructures** several routes. Update the doc to match the design — the design is newer.

### Renamed

| Spec route | Now | Why |
|---|---|---|
| `/worldview` | **Bible** | It is the series bible; "worldview" read as a philosophy setting. |
| `/knowledge` | **Research** | Says what it holds: sources the writer and the AI read. |
| `/skills` | **Insights** | See the model change below — this is the biggest one. |

### Restructured

- **Skills → Insights, and "hiring" is gone.** The spec described prebuilt skills you
  "sort of can hire," with a hire count. The design replaces this with **lenses**: a lens is
  a stored prompt plus a tool allowlist. There is no hiring, no hire count, and no limit on
  how many you use — you are picking a perspective, not staffing a production. Selection
  happens **in the composer**, next to the writing; the Insights route is where you read and
  author lenses. Built-ins: Script Doctor, Structure, Character Arc, Dialogue Pass. Users can
  author their own (shown: "Continuity (yours)"). Each lens card lists its tools as monospace
  chips (`read_nodes`, `rewrite_dialogue`, `annotate`, `read_entities`) — the allowlist is
  visible, so **Structure literally cannot rewrite dialogue**. Preserve that constraint in
  the eventual backend.
- **The AI is a panel, not a separate mode.** The spec had a side button opening an AI mode.
  In the design the AI lives in the right panel of the Script route as the **composer**, with
  an explicit **scope** control (Selection / Scene / Act / Full draft) so the writer always
  knows what the model is reading. `⌘J` opens it.
- **Characters, Locations, Scenes are derived, not authored.** Characters come from character
  cues and `@mentions`; locations and scenes from scene headings. Consequences designed for:
  renaming a location **rewrites every scene heading**; character records **survive deletion
  from the script** (so "0 appearances · record kept" is a valid state); duplicate cues
  surface a **merge** affordance ("Ade / Adebayo — 2 records, same cue text"). The entity
  routes therefore carry derivation-state filters: Zero appearances, Unresolved cues,
  Possible duplicates, Single-scene.
- **Props is now a proposal queue.** Nothing in screenplay syntax marks a prop, so nothing
  can be derived. The design shows AI-proposed props with the evidence that triggered the
  proposal (which scenes), and each is **Proposed / Accepted / Rejected** by the writer.
  Amber = pending; accepted goes green; rejected renders dashed and faded. Confirm where this
  lives — in the design its data sits with the production/breakdown side, not as a top-level
  rail item.
- **Settings is a page with linkable sub-routes** (`/settings/format`, `/account`, `/people`,
  `/billing`, `/transfer`, `/keys`), not a modal.
- **Episodes are first-class.** An `Episode board` in the context panel, an episode-scoped
  route group under it, and a project-level **Timeline** route showing threads across
  episodes (story order / chronology / continuity).

### New routes not in the spec

**Beats**, **Revisions** (colored revision diff + history; `Rev. Blue` in the script header
implies industry revision colors), **Notes** (an inbox of open/mine/resolved comments —
comments are explicitly *not exported*), **Timeline**, and **Insights** analysis views
(pacing, presence, showrunner, viewer). **Storyboard** and **Production** exist in both but
were designed considerably further (board/canvas/list; authoring/empty/generating/finished
generation states).

### Routes in the spec with no design yet

`/assets`. Decide whether it survives as its own route or folds into Production and
Storyboard.

## Build order suggestion

1. Shell: rail, context panel, header, panel show/hide, theme, tokens, fonts. Static.
2. Script route in Paged mode with correct page geometry — the hardest and most important
   piece. Get Courier metrics right before anything else.
3. Fixtures for one project (Monsoon Line, 6 episodes) matching Appendix A.
4. Derived routes: Scenes, Locations, Characters — computed from the script fixture, not
   hand-written, so the derivation story is real from day one.
5. Reference routes: Outline, Beats, Timeline, Bible, Research.
6. Composer UI + Insights (no model calls — stub responses).
7. Revisions, Notes, Storyboard, Production.

---

# Appendix A — proposed data model & API (do not build yet)

Written so the frontend fixtures have the right shape. Everything here is a proposal for a
later pass.

## Core insight

**The script is a node list, not a text blob.** Every downstream feature — scenes,
locations, characters, eighths, diffs, AI scope, comment anchors — depends on this. If the
script is stored as rich text or Markdown, none of it works cleanly. Store an ordered list of
typed nodes.

```ts
type ElementType =
  | 'scene' | 'action' | 'character' | 'paren'
  | 'dialogue' | 'transition' | 'comment' | 'subtitle';

interface ScriptNode {
  id: string;              // stable, survives edits — comments and AI edits anchor to it
  episodeId: string;
  order: number;           // fractional index, so insert never renumbers
  type: ElementType;
  text: string;
  dual?: boolean;          // dual dialogue
  revisionColor?: string;  // 'white' | 'blue' | 'pink' | ...
  locked?: boolean;        // locked pages / production draft
}
```

## Entities

```ts
Project    { id, title, kind: 'series'|'feature'|'short', tags[], pageCount, updatedAt, trashedAt? }
Episode    { id, projectId, number, title, pageCount, revisionColor }

Scene      { id, episodeId, nodeId,        // the 'scene' node it derives from
             number, heading, intExt: 'INT'|'EXT', locationId, timeOfDay,
             synopsis, eighths, startPage, characterIds[] }

Character  { id, projectId, name, cueAliases[],   // cue text variants -> merge candidates
             age?, notes, sceneIds[], mergedIntoId? }

Location   { id, projectId, name, intExt, notes, sceneIds[] }

BibleEntry { id, projectId, kind: 'logline'|'coreIssue'|'rule'|'pitch',
             title, body, facts[], readableByLensIds[] | 'all' }

Source     { id, projectId, kind, title, filename, bytes, origin: 'upload'|'chat'|'recording',
             trust: 'primary'|'secondary', readableByLensIds[] | 'all', clips[] }

PropItem   { id, projectId, name, status: 'proposed'|'accepted'|'rejected',
             evidenceSceneIds[], rationale, decidedAt? }

Thread     { id, projectId, name, color, episodeIds[] }   // Timeline

Note       { id, projectId, nodeId, authorId, body,
             status: 'open'|'resolved', createdAt }         // never exported

Lens       { id, projectId?, name, origin: 'builtin'|'authored',
             description, prompt, tools: Tool[] }
type Tool = 'read_nodes' | 'read_entities' | 'annotate'
          | 'rewrite_dialogue' | 'rewrite_any';

Revision   { id, episodeId, color, createdAt, label, nodeDiffs[] }
```

**Derivation direction is one-way with one exception.** Scenes, characters, and locations are
projections of the node list. The exception is renaming: renaming a location or character
**writes back** into every affected node's text. Model that as an explicit rewrite operation
with an undo entry, not as a field update.

## Key server-side rules

1. **Eighths and page numbers are computed**, from Courier metrics and the node list — never
   stored as user input. Compute server-side so the client and any PDF export agree.
2. **Tool allowlists are enforced server-side.** A lens with `['read_nodes','annotate']` must
   be rejected at the API if it emits a rewrite. Client-side enforcement is decoration.
3. **AI edits are proposals with node-level anchors**, so the writer accepts or rejects per
   node and the diff view is free.
4. **Comments never enter export.** Both the `comment` element type and `Note` records.
5. **Revision colors** follow production convention (White → Blue → Pink → Yellow → Green).
   Locked pages must not renumber.

## API sketch

```
GET  /projects
GET  /projects/:id
GET  /projects/:id/episodes/:episodeId/nodes         -> ScriptNode[]
PATCH /nodes/:id                                      -> text/type edits
POST /episodes/:id/nodes                              -> insert (fractional order)
GET  /projects/:id/scenes?episode=                    -> derived
GET  /projects/:id/characters | /locations            -> derived
POST /projects/:id/locations/:lid/rename              -> rewrites headings, returns diff
GET  /projects/:id/bible | /sources | /props | /threads | /notes | /lenses
POST /ai/run   { scope, lensIds[], episodeId, nodeIds[] }  -> proposal set (streamed)
POST /ai/proposals/:id/accept | /reject
POST /episodes/:id/revisions                          -> snapshot + color bump
GET  /export/:episodeId.(pdf|fdx)                     -> queued job
```

The palette's `queued job` vs `instant · free` hints imply a **job queue with visible cost**
for exports and long AI runs. Design for that: jobs with status, not blocking requests.
