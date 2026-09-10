# Design handoff: Folio — project workspace (script writing routes)

## Precedence — read this first

[`AGENTS.md`](../../AGENTS.md) at the repo root is the contract. This file is a **design
handoff**: it describes what the mocks show and why. Where the two disagree, **AGENTS.md wins**,
and the disagreements that mattered have already been folded into this document.

Within the bundle itself:

1. **`Route - *.dc.html` beat the shell files.** The two `Screenwriting App*.dc.html` files are an
   older generation — their internal route ids are still `worldview`, `knowledge` and `advisors`,
   the names that became Bible, Research and Insights. Their palette, radii and column widths are
   stale. Read them only for the command palette and the all-projects list, which the route
   bundles do not contain.
2. **Where two bundles disagree on chrome, `Route - Script.dc.html` wins** (AGENTS.md, Feature
   workflow §1).
3. Every value in this README is transcribed from a route bundle unless it says otherwise.

`docs/ui design/original-spec/` is referenced below but **is not present in this repo.** Nothing
can be checked against the original route spec; the design bundles and AGENTS.md are the only
available sources.

## Overview

This bundle contains the design for the **inside-a-project** part of Folio: the workspace a
writer lands in after opening a project. It covers the writing surface (script, outline, beats,
storyboard, scenes), the project-level reference routes (characters, locations, timeline, bible,
research, insights, production), and the cross-cutting surfaces (revisions/diff, notes, command
palette).

The app is a screenwriting tool with an AI agent. The central design principle in these mocks:
**the script sheet is the product**. Every other route is either derived from the script (scenes,
locations, characters are parsed out of scene headings and character cues) or is context the AI
reads (bible, research). Chrome yields; the page never does.

## About the design files

The `.dc.html` files are **design references written in HTML**. They are prototypes that show
intended look, layout, copy, and interaction — **they are not production code to copy**. They use
a small custom template runtime (`support.js`, `<x-dc>`, `{{ holes }}`, `<sc-for>`, `<sc-if>`);
**do not port it.** The files also do not reliably render in a browser: `support.js` expects
`window.React`, which the route files never load. Read them as source text and use
`screenshots/*.png` for the visual read.

**Your task:** recreate these designs in the target codebase.

- **Target stack: Next.js App Router + React + Tailwind with CSS variables.** No `dark:` variant —
  theming is `data-theme` on an ancestor, because routes nest a light sheet inside a dark page.
- **Appendix A** at the end is the fixture/entity shape sketch. Name fixture types to match it.

### Which pass are you in? — ask before building a route

This README was written for a **frontend-only pass against local TypeScript fixtures** — no
database, no API calls, no auth. AGENTS.md's feature workflow starts at **schema and migration**
and runs schema → contract → pure logic → repository → server action → UI.

These are not reconcilable by inference and **neither has been retired.** Ask which pass you are
in before building a route. If the answer is the AGENTS.md workflow, Appendix A is still the
shape to aim at, but it is not the build order.

## Fidelity

**High fidelity.** Colors, type, spacing, and copy in these files are final and deliberate.
Recreate pixel-perfectly. Two specific things not to "improve":

1. **Density.** This is a professional tool. Font sizes of 11–13px in chrome are intentional; do
   not bump them to a 14/16px web default. The only place type gets large is the script sheet
   itself (12pt Courier at true page geometry) and the Newsreader route titles.
2. **The copy.** Every label, empty state, and explanatory line is written. Keep it verbatim.
   Specified copy is specified — Insights headers read *"computed from Draft 5 · nothing here is
   an opinion"* and *"N notes on Episode 1 · every note cites what it read."* Paraphrasing breaks
   the argument the route is making.

## File map

Route props below are the actual `data-props` enums in each file, not a paraphrase.

| File | What it is | Props |
|---|---|---|
| `Route - Script.dc.html` | The script editor sheet. **Wins any chrome disagreement.** | `content: draft\|empty`, `theme`, `sideTab: info\|collab`, `pagination: minimal\|paged\|live`, `format: hollywood\|asian`, `projectType: film\|series`, `doc: script\|cover` |
| `Route - Outline.dc.html` | Act/scene outline; shares the script chrome. | `theme`, `sideTab`, `format`, `projectType` |
| `Route - Beats.dc.html` | Beat board. | `view: beats\|arrangement` |
| `Route - Storyboard.dc.html` | Shot/board view. | `view: board\|canvas\|list` |
| `Route - Scenes.dc.html` | Scene list. | `view: cards\|index\|list` |
| `Route - Revisions.dc.html` | Revision diff. | `view: diff\|history` |
| `Route - Notes.dc.html` | Notes/comments inbox. | `filter: open\|mine\|resolved\|all` |
| `Route - Characters.dc.html` | Character records. | `view: profile\|map\|resolve`, `empty` |
| `Route - Locations.dc.html` | Location records. | `view: record\|breakdown\|resolve`, `empty` |
| `Route - Timeline.dc.html` | Cross-episode threads. | `view: story\|chrono\|continuity`, `empty` |
| `Route - Bible.dc.html` | Series bible. | `view: entry\|check\|glossary`, `empty` |
| `Route - Research.dc.html` | Source library. | `view: library\|source\|clips`, `empty` |
| `Route - Insights.dc.html` | Analysis + AI lenses. | `view: pacing\|presence` + one per lens (`showrunner`, `viewer`, `snp`, `producer`, `aunty`), `empty` |
| `Route - Production.dc.html` | Production/generation surface. | `mode: authoring\|empty\|generating\|finished\|blocked\|nocredits`, `view: scene\|episode` |
| `Screenwriting App v2.dc.html` | **Superseded shell.** Pre-rename route ids, stale palette and geometry. Keep for the command palette and all-projects list only. | |
| `Screenwriting App.dc.html` | v1 of the shell. Superseded twice over. | |
| `support.js` | The mock runtime. **Do not port.** | |
| `screenshots/` | One PNG per route, for visual reference. | |
| `original-spec/` | Referenced by the section below. **Missing from this repo.** | |

That is fourteen routes, which is the number AGENTS.md's E2E smoke test walks in both themes and
both states.

Every `empty` prop is load-bearing: a route without its empty state is not done, and a new project
is entirely empty states.

## App shell

Icon rail, then a context panel, then the page. Left to right.

### 1. Icon rail — 66px, `--rail`, 1px right border `--line`

- Padding `12px 5px 10px`, `gap: 3px`, contents centred.
- Top: 28×28px project chip, `border-radius: 3px`, background `--ink`, text `--desk`,
  10.5px/600, `letter-spacing: .02em`, `margin-bottom: 12px` — project initials (`ML`).
- Nav buttons: **56×46px**, `border-radius: 3px`, a 14px glyph **above an 8px/600 uppercase
  label** with `.08em` tracking — the rail is labelled, not icon-only.
- **Active state is two things**, not a colour change alone: a 2px `--accent` bar absolutely
  positioned at `left: -5px; top: 13px; bottom: 13px; border-radius: 1px`, **plus** the `--sel`
  background with icon `--ink`. Inactive = transparent, `--ink2`. Hover = `--hover`, `--ink`.
- Badge: absolutely positioned `top: 4px; right: 6px`, min 13px wide, 13px tall,
  `border-radius: 3px`, background `--note`, text `--rail`, 8.5px/700. **Badges are live counts,
  never placeholders** — Characters = unresolved cues, Locations = unmatched sluglines, Bible =
  open canon conflicts. The empty state shows no badge.
- Order and glyphs, fixed: Writing `✎`, Characters `◍`, Locations `⌖`, Timeline `◷`, Bible `◈`,
  Research `▧`, Insights `◎`, Production `▶`. Writing stays lit across all seven episode routes.
- Bottom, in order: theme toggle (`☾`/`☀`, 56×34), project settings `⚙` (56×34), then a 24px
  round avatar. There is **no all-projects `⌂` button in the route bundles** — the superseded
  shell had one.
- Every button has a `title` (native tooltip) — keep as `aria-label` + tooltip.

### 2. Context panel — width varies by section

| Section | Width |
|---|---|
| Episode nav (Script, Outline, Beats, Storyboard, Scenes, Revisions, Notes) | **238px** — not "about 240" |
| Timeline, Insights, Research, Production | 250px |
| Bible | 252px |
| Characters, Locations | 256px |

Background `--panel`, 1px right border `--line`.

Header row: padding `11px 10px 8px`, project title in **Newsreader 15px/500**, `-.01em`,
truncating, then `＋` and `⋯` buttons (22×22px, `border-radius: 3px`, `--ink3`).

Below it, one of two things:

- **Episode-level routes:** the search trigger — full-width, 1px `--line2`, `border-radius: 3px`,
  `5px 8px` padding, 11.5px `--ink3`, label `Search or jump to…` with `⌘K` on the right. Opens the
  command palette.
- **Entity routes:** a find input on a `--sheet` ground with a `⌕` glyph — e.g. placeholder
  `Find a character`.

Then a scrolling `nav`, `padding: 0 6px 14px`, `gap: 12px` between groups (10px on entity routes):

- **Writing sections** show a collapsible `Episode board` row with a count pill (6); when open, an
  episode list (`E1 Standpipe 104`, `E2 The Tiffin 97`, `E3 Chawl Water 118`, `E4 Blue Bucket 12`)
  — number 10px `--ink3`, title 11.5px truncating, page count 9.5px, indented behind a 1px
  `--line2` rule. Then an uppercase 9.5px/600 `.09em` tracked group label (`Ep 1 · Standpipe`),
  then the seven episode routes with a 13px glyph column and right-aligned meta:

  | Route | Glyph | Meta (draft / empty) |
  |---|---|---|
  | Script | `▤` | `104pp` / `empty` |
  | Outline | `⋮` | `3 acts` |
  | Beats | `⧗` | `6` |
  | Storyboard | `▥` | `38 shots` / `—` |
  | Scenes | `▢` | `34` / `0` |
  | Revisions | `⇄` | `Draft 5` / `—` |
  | Notes | `❝` | `4 open` / `0` |

  **Storyboard sits above Scenes** — the episode nav order deliberately differs from the rail. The
  three meta forms are the empty-meta convention: things that legitimately count to zero show `0`,
  things that either exist or don't show `—`, and the script says `empty`.

  Then a second group, `Scenes`, with the episode's scene count on the right, listing scene
  headings in **Courier Prime 11px uppercase**, truncating, scene number left and eighths right.
  Its empty state reads: *"Scenes appear here as you write headings. Nothing to list yet."*

- **Entity sections** (characters, locations) show grouped records — 20px round initial chip,
  12px name over a 10px role line, per-episode presence dots, right-aligned scene count — and a
  standing `Unmatched names in script` row with an amber dot and a count that jumps to the resolve
  view. The panel footer carries the derivation note in 10px `--ink3`: an `in episode` / `absent`
  dot legend, and `from cues` on the right.

- **Project sections** show sub-route lists (e.g. Timeline: story / chronology / continuity).

> **Do not build the sidebar credits card** that appears at the bottom of the Script and Outline
> panels in the bundles. AGENTS.md cuts it: credits appear in the Production header, where they
> are spent.

### 3. Page header — 46px

`height: 46px`, `padding: 0 14px`, 1px bottom border `--line`. Route title in **Newsreader
21px/500**, `-.01em`. There is no second meta line in the route bundles — the pageTitle/pageMeta
pair belongs to the superseded shell.

The right side holds context-dependent controls: view-toggle segments (2px padding, 1px `--line2`,
`border-radius: 3px`, 11.5px buttons — active view segments use `--accent-bg`/`--accent`, other
segments use `--sel`/`--ink`), a save indicator (6px `--add` dot plus `saved 12s ago` / `New
script`), and 26×26 icon buttons for undo `↩` and the right-panel toggle `◫`.

Script additionally centres a document segment: `▤ Script` / `▣ Cover`. The title page is a
separate document on the same sheet geometry, exported with the script.

### 4. Right panel — 296px in Script

`--panel`, 1px left border. 46px header with a **Newsreader 15px** title (`Writing`) plus `⤒`
import/export and `▤` report buttons.

Two tabs: **Info** and **Collaboration** — not "Composer". Info holds Pagination, Format, Project
type and the derived stat rows; Collaboration holds comment threads (`Reply` / `Resolve`) and the
Revision list. The panel's footer is a full-width `--ink`-on-`--desk` button: `◎ Open composer ⌘J`.

Other routes carry their own right-hand detail column — 264px (Characters, Locations, Bible),
272px (Timeline, Research, Insights). These are route content, not the shell's panel.

### 5. Status bar — 27px

Script and Outline close with a 27px footer on `--panel`, 10.5px `--ink2`:
`Pg 1 / 104 · Paged · Action ⌘2 · Scene 1 · 2/8 pg`, then, right-aligned, `Hide nav` / `Show nav`,
the zoom button (`Fit 84%`, titled *"View zoom — the page stays fixed in inches"*), `Rev. Blue ·
saved 12s ago`, and the route id in 9.5px monospace (`ep_001/script`).

### Responsive rules (important, and unusual)

The panels collapse before the page does. The script sheet is fixed in inches and never scales to
fit chrome; chrome gets out of its way.

```
context panel auto-shows at viewport >= 1000px
right panel   auto-shows at viewport >= 1280px
available     = viewportWidth - 66 - (nav ? 238 : 0) - (side ? 296 : 0) - 48
fitZoom       = clamp(available / 816, 0.5, 1)     // 816px = 8.5in at 96dpi
```

Manual show/hide overrides the automatic behavior until reset. Zoom cycles
`fit → 100% → 75% → fit`.

## The script sheet

Non-negotiable geometry — this is what makes the app credible to screenwriters.

- **US Letter**, 816px wide × 1056px min-height at 96dpi (8.5in × 11in), 1in top padding, text
  block 6.0in. `border-radius: 2px`, 1px `--sheet-edge` border.
- **Courier Prime 12pt**, 12 lines per inch (AGENTS.md, *Pagination and the sheet*). Line height
  is a fixed multiple; do not use a relative line-height. **The bundles set `font-size: 16px;
  line-height: 16px` on the 96dpi sheet, which is 6 lines per inch — the standard single-spaced
  12pt Courier metric. The contract's number and the bundle's geometry do not agree; get one
  ruling before the pagination engine is written.**
- Element indents at full 816px scale, straight from the bundle (96px = 1in):

  | Element | Left | Right |
  |---|---|---|
  | Scene heading, Action, Comment | 144px (1.5in) | 96px (1in) |
  | Character cue | 355px (≈3.7in) | 96px |
  | Parenthetical | 298px (≈3.1in) | 278px |
  | Dialogue | 240px (2.5in) | 240px |
  | Transition | 576px (6.0in) | 96px |

  The page number sits at `top: 48px; right: 96px`, `--ink3`, non-selectable.
- Scene headings and character cues are `text-transform: uppercase`. Subtitles render italic in
  `--ink2` at the dialogue indent.
- **Comment nodes** render as an amber block — 2px `--note` left border, `--note-bg` ground, inset
  to the action measure — labelled `COMMENT` with `not exported · not paginated`. They occupy zero
  page space, can never change a page count, and never reach an export.
- **`format` is an engine input, not a print preference**: `hollywood` (US Letter · Courier 12pt)
  or `asian` (A4 · Courier 12pt). It changes line width, page count, page numbers and eighths.
  *A4 is ~794px, not 816px, and the sheet width for `asian` is unresolved — AGENTS.md open
  decision #8.*
- **Pagination.** The bundle offers three peer segments with this copy:
  - *Minimal* — "No page breaks drawn. Page count still live in the status bar."
  - *Paged* — "Breaks drawn where the printed page breaks. Widow and (MORE)/(CONT'D) rules applied."
  - *Live* — "Repaginates on every keystroke, including collaborators'. Heavier on long drafts."

  AGENTS.md models this as **two rendering modes plus a cadence flag** — `pageMode: paged |
  continuous` and `liveRepaginate: boolean` — explicitly *not* three peer modes, stored per
  project and **not in the URL**. Build the two-plus-one model; the three segments above are how
  it presents. (Reading *Minimal* as `continuous` is the obvious mapping but has not been ruled
  on.) Pagination itself is computed **server-side**, so client, print and export agree, and the
  result lands on a measurement record, never on a node.
- Sheet colors are tokenized separately from app chrome (`--sheet`, `--sheet-ink`, `--sheet-line`,
  `--sheet-edge`) because **in dark mode the sheet is tinted (`#262220`), never white and never
  pure black**. Same geometry in both themes.
- **Element type bar**: a sticky segment above the sheet listing all eight types with their
  shortcuts — `⌘1` Scene, `⌘2` Action, `⌘3` Character, `⌘4` Paren, `⌘5` Dialogue, `⌘6` Transition,
  `⌘7` Comment, `⌘8` Subtitle. The eight types are a closed set. The caret's current element and
  key also read out in the status bar.
- Below the sheet, a hint row: `Tab` Action → Character → Dialogue → Parenthetical · `@` mention a
  character or location · `INT.` on an empty Action line becomes a Scene Heading.
- The empty state renders the hints on the sheet itself plus a ghost slugline
  `INT/EXT. LOCATION - DAY/NIGHT` with a live caret.

## Interactions & behavior

| Trigger | Result |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘J` / `Ctrl+J` | Open the AI composer |
| `Esc` | Close palette |
| Rail button | Switch section |
| Context-panel row | Switch route / select entity |
| Header segment | Switch sub-view within a route |
| `⌘1`–`⌘8` | Set the current element type |
| Zoom button | Cycle fit → 100% → 75% |
| Panel toggle | Show/hide context or right panel, overriding auto |
| Theme button | Toggle light/dark |
| Scope button (composer) | Cycle Selection → Scene → Act → Full draft |

**The composer is a floating window, not a panel and not a route.** AGENTS.md: one agent,
reachable everywhere — draggable, resizable, persists across route changes, minimises to a chip,
opened with `⌘J`. The bundles only show its entry point (the `◎ Open composer ⌘J` button in the
Script right panel); the superseded shell's "AI lives in the right panel" model is **not** what
gets built. Its window rect and session flags are the one thing Zustand is for.

Its lifecycle is **Brief → Plan → Run → Review → Commit**, one run produces one revision entry,
and **every write returns a proposal anchored to node ids, never a mutation**.

**Command palette** (superseded shell — the only place it is drawn): 520px wide, `max-width: 92vw`,
opens at `13vh` from top over a `rgba(15,12,8,.28)` scrim. Results are grouped with uppercase
9.5px group labels — Scenes, Locations, Actions — each row `icon · label · right-aligned hint`.
Actions carry a cost/latency hint (`queued job`, `instant · free`). Clicking the scrim closes;
clicking the sheet must not. **Re-derive its radius and colours from the route-bundle tokens
below** rather than copying the shell's 12px radius and violet accent.

No route transitions or page animations. Hover feedback only, instant.

## State

**The URL is the state container.** Route, episode, sub-view and selected record all come from the
URL; sub-views are query params, never separate routes, and each defaults to its first value.

```
route            which section/route is showing        -> from the URL
episodeId        active episode (ep_NNN)               -> from the URL
subView          per-route view segment                -> ?view= query param
selectedId       selected scene/character/location     -> ?selected= query param
theme            'light' | 'dark' (dark by default)    -> persisted (localStorage)
zoom             'fit' | number                        -> session
ctxPanelOpen     boolean | null (null = automatic)     -> session
rightPanelOpen   boolean | null (null = automatic)     -> session
rightPanelTab    'info' | 'collab'                     -> session
paletteOpen      boolean                               -> ephemeral
aiScope          'selection' | 'scene' | 'act' | 'draft'  -> session
```

Four things that look like sub-views but are **not** query params:

| Case | Where it lives |
|---|---|
| `pageMode` + `liveRepaginate` | Per project. Two modes plus a cadence flag, not three peer modes |
| `script.content=empty` | A data state — derive it from whether a script exists |
| `production.mode` | The generation job's status. Drive it from the job row; all six states get built |
| theme, zoom, panels, palette, aiScope | Per user or per session — localStorage or session state |

URL shapes:

```
/app/project/:projectId/:episodeId/script
/app/project/:projectId/:episodeId/outline
/app/project/:projectId/:episodeId/beats
/app/project/:projectId/:episodeId/storyboard?selected=SCENE_xxx
/app/project/:projectId/:episodeId/scenes
/app/project/:projectId/:episodeId/revisions
/app/project/:projectId/:episodeId/notes
/app/project/:projectId/characters
/app/project/:projectId/locations
/app/project/:projectId/timeline | /bible | /research | /insights
```

Project-level routes have **no** `:episodeId`; episode-level routes do. `:episodeId` shares a path
position with the project-scoped names, so every episode id must be validated against
`characters`, `locations`, `timeline`, `bible`, `research`, `insights`, `production`, `settings`
and `assets`, and kept to the `ep_NNN` shape. Static-first precedence saves this tree by accident;
do not rely on it.

`projectType: 'film'` **hides** the episode segment — the router special-cases the shape, the
schema never does; the database still stores one episode row. The bundle states it as:
*"One document. The episode board is hidden and routes collapse to /project/{uuid}/script."*
For `series`: *"Episodes are first-class: this route is scoped to ep_001. Entities stay
project-wide."*

Open in AGENTS.md and not to be settled here: whether `/production` is project- or episode-scoped
(#5), whether `/build` and `/search` are cut or merely undesigned (#6), the `?lens=` value shape
(#4), and the `SCENE_xxx` vs `ep_NNN` casing inconsistency above.

## Design tokens

Transcribed verbatim from `Route - Script.dc.html`, which is identical across all fourteen route
bundles. Put these in `tailwind.config` as semantic color names (`desk`, `panel`, `rail`, `line`,
`ink`, `sheet`, …) driven by CSS variables, with dark mode via `data-theme="dark"` — **not**
Tailwind's `dark:` class variant, because the mocks nest a light sheet preview inside a dark page
and vice versa. Never a hardcoded hex outside the token definitions.

**The accent is terracotta.** Earlier drafts of this table, and both shell bundles, use a violet
`oklch(0.52 0.13 285)`. That is stale.

### Light

```
--desk        #efe9df                page/desk background
--panel       #f8f4ec                context & right panels
--rail        #f3eee4                icon rail
--line        rgba(40,30,18,.16)     primary border
--line2       rgba(40,30,18,.08)     subtle divider
--ink         #1d1915                primary text
--ink2        rgba(29,25,21,.66)     secondary text
--ink3        rgba(29,25,21,.44)     tertiary / meta
--hover       rgba(40,30,18,.05)
--sel         rgba(40,30,18,.08)
--sheet       #fffdf8
--sheet-ink   #171310
--sheet-line  rgba(0,0,0,.12)
--sheet-edge  rgba(0,0,0,.16)
--accent      oklch(0.50 0.17 27)    terracotta — selection, links, AI
--accent-bg   oklch(0.50 0.17 27 / .09)
--accent-line oklch(0.50 0.17 27 / .36)
--accent-ink  #fff
--frame-a     oklch(0.32 0.02 50)    storyboard frame gradient
--frame-b     oklch(0.16 0.01 50)
--add         oklch(0.48 0.10 150)   green — additions, accepted
--add-bg      oklch(0.48 0.10 150 / .10)
--del         oklch(0.50 0.14 25)    red — deletions, rejected
--del-bg      oklch(0.50 0.14 25 / .09)
--note        oklch(0.55 0.10 75)    amber — proposals, notes, badges
--note-bg     oklch(0.55 0.10 75 / .11)
--focus       oklch(0.50 0.17 27)    focus ring — the accent, not a separate blue
--shadow      none
--grid        rgba(40,30,18,.16)
--slate       #1d1915
--slate-ink   #efe9df
--serif       "Newsreader", Georgia, serif
```

### Dark

```
--desk #151311  --panel #1c1917  --rail #181513
--line rgba(240,232,220,.13)   --line2 rgba(240,232,220,.07)
--ink #ebe4d8   --ink2 rgba(235,228,216,.64)   --ink3 rgba(235,228,216,.40)
--sheet #262220 --sheet-ink #e2dbcf
--sheet-line rgba(255,255,255,.11)  --sheet-edge rgba(255,255,255,.08)
--hover rgba(240,232,220,.06)  --sel rgba(240,232,220,.10)
--accent oklch(0.72 0.14 30)   --accent-bg oklch(0.72 0.14 30 / .14)
--accent-line oklch(0.72 0.14 30 / .40)  --accent-ink #1a1210
--frame-a oklch(0.30 0.02 50)  --frame-b oklch(0.14 0.01 50)
--add oklch(0.76 0.10 150)  --add-bg oklch(0.76 0.10 150 / .13)
--del oklch(0.74 0.12 25)   --del-bg oklch(0.74 0.12 25 / .13)
--note oklch(0.78 0.09 75)  --note-bg oklch(0.78 0.09 75 / .13)
--focus oklch(0.72 0.14 30)  --shadow none
--grid rgba(240,232,220,.18)  --slate #ebe4d8  --slate-ink #151311
```

Theme is **`dark` by default**. The palette is warm-neutral: **do not substitute Tailwind's
default gray/slate scale** — it is cool and will kill the whole look.

**Revision colours (White → Blue → Pink → Yellow → Green) are industry artefacts, not palette
tokens.** They must survive a theme switch intact.

### Type

Fonts are **self-hosted**, not pulled from Google Fonts at runtime, and Courier Prime is
version-pinned — its metrics are load-bearing for pagination.

- **UI: Instrument Sans**, weights 400/500/600.
- **Route and panel titles: Newsreader** (`--serif`), 400/500 + italic — 21px in the page header,
  15px in panel headers.
- **Script sheet, scene headings, code-ish chips: Courier Prime**, 400/700 + italic.
- Scale in use: 8px (rail labels, `.08em`), 9–9.5px (uppercase group labels, `.08–.09em`
  tracking), 10px / 10.5px (meta, status bar), 11px / 11.5px (rows, secondary), 12px / 12.5px
  (nav rows, body), 13–15px (panel titles), 21px (route title). Headings use
  `letter-spacing: -.01em`.
- Numerals in counts and page numbers: `font-variant-numeric: tabular-nums`.

### Geometry

- **Radii are flat and small.** The route bundles use `3px` almost everywhere — buttons, rows,
  chips, cards, segments, panels — with `2px` for the sheet and progress bars and `1px` for the
  rail's active bar. The 5/6/7/8/9–10/12px scale in earlier drafts is the superseded shell's; the
  one 7px survivor is the 26×14 toggle pill in Research.
- Rail 66px · episode nav 238px · entity/project panels 250–256px · Script right panel 296px ·
  route detail columns 264–272px · sheet 816px.
- Header 46px · status bar 27px.
- Content max-widths seen in the bundles: 820px (Bible, Characters, Locations, Research, Timeline
  body columns), 900px (Insights, Characters map), 880px (Revisions), 760px (Notes, Insights
  sidebars), 1040px (Locations breakdown), 980–1180px (Production), 460px (empty-state columns).
  Read the specific route file rather than trusting one number per route.
- Focus state everywhere: `box-shadow: 0 0 0 2px var(--focus)` with `outline: none`. Keep it —
  keyboard navigation matters in this app.

## Assets

None. No images, **no icon library** — every glyph is a Unicode character rendered as text.
AGENTS.md's do-not-add list forbids adding one; earlier drafts of this file said "Lucide is fine"
and that is retracted. The known set:

```
✎ ◍ ⌖ ◷ ◈ ▧ ◎ ▶ ☾ ☀ ⚙ ▤ ⋮ ⧗ ▥ ▢ ⇄ ❝
```

plus the incidental chrome glyphs `＋ ⋯ ⌕ ▾ ▸ ↩ ◫ ⤒ ⚠ ≡ ⌘ ⎋`. Keep them light and 1px-ish, not
filled. Image placeholders in the storyboard route are meant to be real thumbnails later.

## Where AGENTS.md overrides these mocks

Build the right-hand column. Do not resolve these by reading the bundle.

| The bundles show | Build instead | Why |
|---|---|---|
| Violet accent in the shell files | Terracotta, from any route bundle | All fourteen route bundles are terracotta; the shell is stale |
| A credits card in the Script/Outline panel footer | No card. Credits in the Production header | Cut list in AGENTS.md Constraints |
| Three pagination segments (Minimal/Paged/Live) | `pageMode: paged \| continuous` + `liveRepaginate` | Not three peer modes |
| An AI composer in the Script right panel | A floating, draggable agent window, everywhere, `⌘J` | The agent is not a route and not a panel |
| `kind: 'series' \| 'feature' \| 'short'` (old Appendix A) | `film \| series` only | No `short` project type |
| A settings page with sub-routes (shell only) | A stub | No design exists; where `transfer`, `keys` and `episodes` went is open decision #7 |
| 12 lines per inch (AGENTS.md) vs 16px/16px on a 96dpi sheet (bundles) | **Unresolved — ask** | 6 lpi is the standard single-spaced 12pt Courier metric |

## Changes from the original spec doc

`original-spec/` held the route spec this design started from. **It is not in this repo**, so the
comparison below cannot be re-checked — it is kept as the record of what changed and why. The
design is newer than the spec; AGENTS.md is newer than both.

### Renamed

| Spec route | Now | Why |
|---|---|---|
| `/worldview` | **Bible** | It is the series bible; "worldview" read as a philosophy setting. |
| `/knowledge` | **Research** | Says what it holds: sources the writer and the AI read. |
| `/skills` | **Insights** | See the model change below — this is the biggest one. |

### Restructured

- **Skills → Insights, and "hiring" is gone.** The spec described prebuilt skills you "sort of can
  hire," with a hire count. The design replaces this with **lenses**. There is no hiring, no hire
  count, and no limit on how many you use — you are picking a perspective, not staffing a
  production. Selection happens **in the composer**, next to the writing; the Insights route is
  where you read and author lenses. Built-ins in the bundle: Showrunner, Viewer, Standards (S&P),
  Producer; users author their own (shown: "Aunty on the second floor"). Each lens card lists its
  tools as monospace chips (`read_nodes`, `rewrite_dialogue`, `annotate`, `read_entities`) — the
  allowlist is visible, so a read-only lens is visibly read-only regardless of what its prompt
  says, and **a structure lens literally cannot rewrite dialogue**.

  A lens is **four** things, not two: a system prompt, a tool allowlist, a readable-source list,
  and an output shape. **Every lens note cites its sources; a note that cannot cite one is not
  rendered.** Insights' analysis views (pacing, presence) are **reports, and a report never calls
  a model** — they are arithmetic over the node list and derived entities.
- **The AI is reachable everywhere.** The spec had a side button opening an AI mode. The design
  gives it an explicit **scope** control (Selection / Scene / Act / Full draft) so the writer
  always knows what the model is reading, and `⌘J` opens it. Per AGENTS.md it is a floating
  window, not the right panel.
- **Characters, Locations, Scenes are derived, not authored.** Characters come from character cues
  and `@mentions`; locations and scenes from scene headings. Consequences designed for: renaming a
  location **rewrites every scene heading**; character records **survive deletion from the script**
  (so "0 appearances · record kept" is a valid state); duplicate cues surface a **merge**
  affordance ("Ade / Adebayo — 2 records, same cue text"). The entity routes therefore carry
  derivation-state filters: Zero appearances, Unresolved cues, Possible duplicates, Single-scene.

  Two rules the design implies and AGENTS.md makes binding: a **location is a tree, not a list**
  (sub-sets hang off a primary set, because scheduling counts shooting days by set), and the
  **resolve queue is rows, not a computed view** — a rejected proposal must not reappear
  identically on the next derivation pass.
- **Props is now a proposal queue.** Nothing in screenplay syntax marks a prop, so nothing can be
  derived. The design shows AI-proposed props with the evidence that triggered the proposal (which
  scenes), and each is **Proposed / Accepted / Rejected** by the writer. Amber = pending; accepted
  goes green; rejected renders dashed and faded. In the design its data sits with the
  production/breakdown side, not as a top-level rail item — the rail is a fixed eight.
- **Settings is a page with linkable sub-routes, not a modal** — but the only design for it is in
  the superseded shell, and AGENTS.md treats project `/settings` as a **stub**. Where `transfer`,
  `keys` and `episodes` went is open decision #7.
- **Episodes are first-class.** An `Episode board` in the context panel, an episode-scoped route
  group under it, and a project-level **Timeline** route showing threads across episodes (story
  order / chronology / continuity).

### New routes not in the spec

**Beats**, **Revisions** (colored revision diff + history; `Rev. Blue` in the status bar implies
industry revision colors, and **locked pages must not renumber**), **Notes** (an inbox of
open/mine/resolved comments — comments are explicitly *not exported*), **Timeline**, and
**Insights** analysis views. **Storyboard** and **Production** exist in both but were designed
considerably further (board/canvas/list; six generation states, including `blocked`, which must
show the moderation refusal reason in the writer's terms, and `nocredits`).

### Routes in the spec with no design yet

`/assets`. Decide whether it survives as its own route or folds into Production and Storyboard —
it is still in the reserved-name list every episode id is validated against.

## Build order

Which build order applies depends on the answer to *"which pass are you in?"* above.

**If this is the frontend-only pass**, the design sequence is:

1. Shell: rail, context panel, header, status bar, panel show/hide, theme, tokens, fonts. Static.
2. Script route in Paged mode with correct page geometry — the hardest and most important piece.
   Get Courier metrics right before anything else.
3. Fixtures for one project (Monsoon Line, 6 episodes) matching Appendix A.
4. Derived routes: Scenes, Locations, Characters — computed from the script fixture, not
   hand-written, so the derivation story is real from day one.
5. Reference routes: Outline, Beats, Timeline, Bible, Research.
6. Composer UI + Insights (no model calls — stub responses).
7. Revisions, Notes, Storyboard, Production.

**If this is the AGENTS.md workflow**, the unit is a thin vertical slice per route — schema →
contract → pure logic in `packages/script` with its tests → repository → server action → UI, both
states in the same change, both themes checked before it is called done. Never build four routes
to 80%.

Either way: **both states always.** Populated and empty ship together, and a new project opens
into the empty state, so it is the first screen most users see.

---

# Appendix A — entity shapes

Written so fixtures and, later, contracts line up. Reconciled against AGENTS.md; where this
sketch was looser than the contract, the contract's rule is stated with it.

## Core insight

**The script is a node list, not a text blob.** Every downstream feature — scenes, locations,
characters, eighths, diffs, AI scope, comment anchors — depends on this. If the script is stored
as rich text or Markdown, none of it works cleanly. Store an ordered list of typed nodes.

```ts
type ElementType =
  | 'scene' | 'action' | 'character' | 'paren'
  | 'dialogue' | 'transition' | 'comment' | 'subtitle';   // closed set of eight

interface ScriptNode {
  id: string;              // stable — survives splits, merges, type changes, reorders
  episodeId: string;
  order: number;           // fractional index, so insert never renumbers
  type: ElementType;
  text: string;
  dual?: boolean;          // dual dialogue
  delivery?: ('V.O.' | 'O.S.' | 'O.C.')[];   // authored, stored. NOT (MORE)/(CONT'D)
  revisionColor?: string;  // 'white' | 'blue' | 'pink' | ...
  locked?: boolean;        // locked pages / production draft
  provenance: { source: 'typed' | 'agent'; runId?: string };
}
```

- **There is no `page` attribute on a node. Ever.** Pagination is computed at render, server-side,
  and lands on a separate measurement record.
- **Generated text never enters the node stream.** `(MORE)`, `CHARACTER (CONT'D)` at a page split
  and speaker `(CONT'D)` are computed at render and stripped on import. Authored `(V.O.)`,
  `(O.S.)` and `(O.C.)` *are* stored, as node attributes. Conflate the two and every `.fdx`
  round-trip doubles the continueds.
- Which node id survives a split, and what happens on merge and paste, is **open decision #1** and
  blocks proposal anchoring, comments, diffs and provenance.
- The **Outline** is a different document kind in the same table with its own tiny closed block
  set (Body, H1, H2, H3, Quote, Rule, numbered beats). Do not widen the screenplay schema to hold
  an `H2`.

## Entities

```ts
Project    { id, title, kind: 'film' | 'series', tags[], pageCount, updatedAt, trashedAt? }
Episode    { id, projectId, number, title, pageCount, revisionColor }   // id shape: ep_NNN

Scene      { id, episodeId, nodeId,        // the 'scene' node it derives from
             number, heading, intExt: 'INT'|'EXT', locationId, timeOfDay,
             synopsis, characterIds[] }
           // eighths and startPage live on the measurement record, not here

Measurement { id, episodeId, format: 'hollywood'|'asian', computedAt,
              pages, perScene: { sceneId, startPage, eighths }[] }

Character  { id, projectId, name, age?, notes, sceneIds[], mergedIntoId? }
Alias      { id, characterId, cueText, count }   // 'MEERA' 79, 'MEERA (V.O.)' 3 — never a hash

Location   { id, projectId, name, intExt, notes, sceneIds[],
             parentId?: string }               // a tree: sub-sets hang off a primary set

BibleEntry { id, projectId, kind: 'logline'|'coreIssue'|'rule'|'pitch',
             status: 'canon' | 'draft' | 'retired',      // the first context gate
             title, body, facts[], readableByLensIds[] | 'all' }

Source     { id, projectId, kind, title, filename, bytes, origin: 'upload'|'chat'|'recording',
             trust: 'primary'|'secondary',
             readable: boolean,                          // the second context gate
             readableByLensIds[] | 'all', clips[] }

PropItem   { id, projectId, name, status: 'proposed'|'accepted'|'rejected',
             evidenceSceneIds[], rationale, decidedAt? }

Thread     { id, projectId, name, color, episodeIds[] }   // Timeline

Note       { id, projectId, nodeId, authorId, body,
             status: 'open'|'resolved', createdAt }       // never exported

Lens       { id, projectId?, name, origin: 'builtin'|'authored',
             description, prompt, tools: Tool[],
             readableSourceIds[] | 'all', outputShape }   // a lens is four things
type Tool = 'read_nodes' | 'read_entities' | 'annotate'
          | 'rewrite_dialogue' | 'rewrite_any';

Revision   { id, episodeId, color, createdAt, label, nodeDiffs[] }

ResolveDecision { id, projectId, kind: 'character'|'location', cueText,
                  decision: 'merge'|'create'|'alias'|'rejected', decidedAt }
                // real rows, not a computed view — must survive re-derivation
```

Every table carries `project_id` and every query is tenant-scoped.

**Derivation is one-way, with exactly two exceptions.** Scenes, characters and locations are
projections of the node list. The exceptions are **character record rename** and **location record
rename**, each of which writes back into every affected node's text. Model each as an explicit
rewrite operation returning a diff, undoable in one step — not a field update. There is no third
case. A **cue-level** rename is a different thing and must ask first: rename everywhere, or create
a new character?

Derivation **reconciles; it never rebuilds.** Authored data hanging off derived rows — resolve
decisions, synopses, beat links, story time, threads — must survive a full re-derive intact. And a
malformed heading does not silently become a scene: `INTERCUT - PHONE CALL` is not an interior
scene at location `ERCUT`.

## Key server-side rules

1. **Eighths and page numbers are computed**, from Courier metrics and the node list — never
   stored as user input, never on a node. Compute server-side so the client, print and any PDF
   export agree. This is why the layout engine is ours and Headless Chrome is off the table.
2. **Tool allowlists are enforced server-side.** A lens with `['read_nodes','annotate']` must be
   rejected at the API if it emits a rewrite. Client-side enforcement is decoration. The same goes
   for the approved plan: **the plan is the allowlist**, and a run may only write the surfaces it
   declared.
3. **Both context gates are enforced in the context builder, never in the UI**: bible entry status
   (`canon` readable, `draft` not until promoted, `retired` ignored) and the per-source research
   `readable` toggle. Research is **read-only to the agent**; Bible is written **only** on an
   explicit instruction in the current message; settings, people, billing, keys and export never.
4. **AI edits are proposals with node-level anchors**, so the writer accepts or rejects per node
   and the diff view is free. Agent output is parsed exactly like typed text, and ambiguous cues
   surface in the diff as merge / create / alias.
5. **Comments never enter export.** Both the `comment` element type and `Note` records. Neither do
   notes.
6. **Revision colors** follow production convention (White → Blue → Pink → Yellow → Green), and
   **locked pages must not renumber** — that is the entire point of the colour system.
7. **Reserve then execute.** The balance check happens before a job is enqueued, never inside it.
   The credits ledger is append-only and the balance is computed, never stored; every generation
   row links to its job and, on failure, to its refund ledger entry.

## Transport

The earlier sketch listed a REST API. **AGENTS.md's stack is Next.js Server Components for reads
and Server Actions for mutations**, with Zod schemas in `packages/contracts` at every boundary,
shared by web and worker — TanStack Query only where Server Components don't fit. Treat the list
below as *capabilities that must exist*, not as routes to scaffold:

```
list projects · read one project
read an episode's nodes                    -> ScriptNode[]
patch a node (text/type) · insert a node   (fractional order)
read derived scenes / characters / locations
rename a location or character             -> rewrites headings or cues, returns a diff
read bible / sources / props / threads / notes / lenses
run the agent { scope, lensIds[], episodeId, nodeIds[] }  -> proposal set, streamed over SSE
accept or reject a proposal
snapshot a revision + colour bump
export .pdf / .fdx                         -> queued job
```

The palette's `queued job` vs `instant · free` hints imply a **job queue with visible cost** for
exports and long AI runs: long-running work is a BullMQ job on the worker — status, cost,
cancellable, resumable, survives a closed tab — and **cost is named before it is spent**, on the
button, per frame and per reel.
