# 02 — Design specification: the Production route

This is the brief for the mockups (Claude Design) and, once the mockups are approved, the visual
and behavioural spec for the frontend phases. It is written so that someone who has never seen
Folio can draw every screen. Where it names a token, size or string, that is the value to use.

The old mockup `docs/ui design/Route - Production v2.dc.html` is **retired** by this spec (it is
deleted in the working tree and remains in git for its tokens). The design README
(`git show HEAD:"docs/ui design/README.md"`) still governs the language; its rules are restated in
§1 so this file stands alone.

---

## 1. The design language (restated from the README — do not deviate)

**Four rules.** Dark canvas, no paper (one background; depth is translucent white surfaces stacked
on it). Chrome floats and disappears (rounded translucent cards, 1 px hairline, backdrop blur, over
two ambient radial glows; no opaque bars). Nothing permanent that isn't used constantly. Content over
controls (tabular numbers, sentence case, plain-spoken labels).

**Tokens** (declare on `:root`; light theme overrides in `[data-theme="light"]`):

```
--bg      #0a0a0c   page background                    light #f7f6f3
--sunk    #08080a   recessed: inputs, side panels      light #f2f0ec
--s1 / --s2 / --s3  rgba(255,255,255,.035 / .055 / .085)   surface steps (light: black at the same alphas)
--line    rgba(255,255,255,.085)   --line2  rgba(255,255,255,.05)
--ink     #f3f2ef   --ink2 62% ink   --ink3 36% ink   --read 80% ink (long-form only)
--accent  oklch(.72 .12 245)  + --accent-bg (16%)      links, selection, AI actions (✦)
--ok      oklch(.76 .10 150)  green    done, saved, settled, rendered, kept
--warn    oklch(.80 .11 75)   amber    needs a decision, proposed, stale, recommended-missing
--live    oklch(.72 .14 40)   orange   destructive, live, over-budget, needs credits
--bad     oklch(.70 .16 25)   red      Production only (ruled 2026-09-16): a refusal, an overrun
--bad-bg  the same at 13%  (light: oklch(.52 .17 25) / 9%)
--seg-1..4  oklch(.70 .11 250) / (.74 .11 150) / (.78 .10 75) / (.70 .12 300)   timing-bar segments, cycling
--solid   #f3f2ef on --solid-ink #0d0d10   the inverted primary button
--frame-a / --frame-b   oklch(.34 .02 60) / (.16 .01 60)   the empty frame's gradient (light .80/.58)
--frame-ink  rgba(255,255,255,.78)   --frame-grid rgba(255,255,255,.08)   --grid-dot rgba(255,255,255,.10)
--shade   rgba(0,0,0,.5)   --frame-badge rgba(0,0,0,.4) / --frame-badge-ink rgba(255,255,255,.85)
--shot-scrim rgba(8,10,13,.62)   --shot-over-a/b/c  .92/.72/.45   --shot-chip rgba(255,255,255,.14)
--glow-cool / --glow-warm   the two ambient radial washes behind everything
```

Semantic colour is strict. No other hues. Accent is for links, selection and `✦` AI actions only.

**Type.** Geist 200–600 and Geist Mono (Google Fonts). Page title 27/400 `-.02em`; section heading
14–17/500 `-.01em`; body 13–15, line-height 1.55–1.65, `text-wrap: pretty`; meta 11–12.5; eyebrow
10.5–11/500 uppercase `.1em` `--ink3`; **mono with `tabular-nums` for scene refs, ids, timecodes,
durations, counts, costs, paths**; the stat tiles' figure is 26/300.

**Shape and motion.** Radii 7–10 px controls, 12–13 px cards, 16 px panels, 18 px on the main
surface's top-left only, 999 px pills. Transitions `.14s` on background, colour, border, opacity —
nothing else animates, except: the assistant orb's 9 s drift; the canvas thread between cards (a
dash-offset loop, the Storyboard's `folio-thread`); the generating shimmer (§8). All stop under
`prefers-reduced-motion`. Focus ring `box-shadow: 0 0 0 2px var(--accent)` on everything
interactive. Scrollbars 10 px rounded, `--s3` thumb.

**Copy tone.** Plain, specific, lower-case-leaning. Labels say what happens. No exclamation marks,
no emoji, no marketing. `✦` prefixes every action that calls a model and costs credits; the cost
follows the label: `✦ Start shooting · 375 cr`.

**Shell** (identical on every route; already built — draw it, do not redesign it):

```
┌────┬──────────┬──────────────────────────────────────┬────────┐
│rail│ sidebar  │ header 60px: crumbs · views · Share · orb    │ panel  │
│56px│ 236px    ├──────────────────────────────────────┤ 400px  │
│    │          │ toolbar                              │ (assistant / drawer, --sunk, in flow ≥1200) │
│    │          │ content (this spec)                  │        │
│    │          │ status bar 28px                      │        │
└────┴──────────┴──────────────────────────────────────┴────────┘
```

Rail: six route icons, Production last (active: `--s2` fill, `--ink` stroke). Sidebar: a floating
`--s1` card, 16 px radius, project name + `＋`, search, grouped rows, one widget pinned at the bottom.
Header: breadcrumb `Monsoon Line / Episode 1 / Production` left; the route's views in the centre;
`Share` and the assistant orb right (orb hides while the panel is open). Main surface: one `--s1`
card, `border-radius: 18px 0 0 0`, backdrop blur. Panels 400 px `--sunk` with a left hairline; in flow
≥ 1200 px, overlaid with a `-24px 0 70px` shadow below; below 1200 px an open panel forces the sidebar
closed.

---

## 2. Sample data (one fictional project so every frame reads as a real workspace)

**Project** Monsoon Line · **Episode 1** · balance **220 cr** · film settings: art style **New
Hollywood / Modern American Realism**, 16:9, Academy, 720p, Standard.

**Scenes** (script order): `1. EXT. COMMUNITY PITCH – DUSK` · `2. INT. ADE'S KITCHEN – NIGHT` ·
`3. EXT. COMMUNITY PITCH – NIGHT` · `4. INT. BUS SHELTER – DAWN` · `5. EXT. COMMUNITY PITCH – DAY`.

**Cast**: **Ade** (17 · lead; Look kept; appearance "seventeen, wiry, close-cropped hair, a faded
green training top two sizes too big, taped-up boots") · **Old man** (unnamed · bench; **no Look**)
· **Nia** (16 · Ade's friend; Look kept, no Turnaround).

**Locations**: **Community pitch** (plate kept — a floodlit five-a-side cage between two housing
blocks, chain fence, puddles) · **Ade's kitchen** (no plate) · **Bus shelter** (no plate).

**Scene 1, Reel 1** (`15 s`, natural cut, finalized, rendered — version 2 of 2 kept), range lines
1–18. Shots:

| # | size · angle · movement · lens | s | description |
|---|---|---|---|
| 1 | Wide · Eye level · Static · 24mm | 4 | The cage under the floodlights, rain just stopped. `@Old man` on the bench at the touchline, a flat ball at his feet. |
| 2 | Medium · Eye level · Handheld · 35mm | 3 | `@Ade` at the gate, bag on one shoulder, looking at the ball and not the man. |
| 3 | Close-up · Low · Static · 50mm | 5 | The old man taps the flat ball toward `@Ade`; it barely rolls. |
| 4 | Medium close-up · Eye level · Handheld · 35mm | 3 | `@Ade` stops it with the taped boot. Doesn't look up. "It's flat." |

**Scene 1, Reel 2** (`10 s`, match cut on last frame, writing shots — 2 of 3 shots described, 7 / 10 s).

**Scene 3, Reel 1** (`15 s`, frames generating: shot 1 drawn, shot 2 generating 62 %, shot 3
queued, shot 4 **blocked** — "The model refused this shot: violence. Rewrite the shot or remove the
blood.").

**Scene 2** has no reel. **Scene 4** has one reel, no shots. **Scene 5**: reel rendered, **stale**
(line 9 changed after the render).

**Tasks running**: 2 (Scene 3 frames). **Costs** (Standard tier): frame `15 cr`, still `15 cr`,
Look `15 cr`, Turnaround `25 cr`, plate `15 cr`, 15 s clip `375 cr` ("likely 2–3 versions ≈
750–1,125 cr").

---

## 3. The Scene view — screen anatomy

Content area = the main surface minus the toolbar and the status bar. Four stacked regions; only
the canvas scrolls (pans).

```
toolbar   44px   Production · 5 scenes   [flex]   Film settings · New Hollywood ▾   Tasks · 2 running   ● 220 cr   ⋯
scene tabs 44px  | 1. EXT. COMMUNITY PITCH – DUSK ● | 2. INT. ADE'S KITCHEN – NIGHT ○ | 3. … ● | 4. … ○ | 5. … ● |   ⟨ ⟩
reel strip 92px  [ Reel 1  ● Rendered · view  ⋯ ] ＋ [ Reel 2  ● Writing shots  ✦ Start shooting ] ＋ [ ＋ Reel ]
reel canvas      dot grid, cards, threads; bottom-left zoom pill; bottom-centre add pill; bottom-right "Ask about this reel…"
status bar 28px  5 scenes · 7 reels · 2 rendered · 220 cr                 Hide nav · ● Saved · /production
```

### 3.1 Toolbar (44 px, `flex`, `gap: 8px`, padding `0 16px`)

- Route name `Production` 15/500; count chip `5 scenes` (mono 11.5, `--s2` pill, 999 radius).
- `flex: 1`.
- **`Film settings`** button: `--s1` fill, hairline, 8 px radius, 28 px tall; label
  `Film settings · New Hollywood` (art style name, or `Film settings · none` in `--ink3`), a `▾`.
  Opens the dialog (§7.1).
- **`Tasks · 2 running`** chip: same button style; a 6 px `--accent` dot pulsing (opacity .5→1,
  1.2 s) while anything runs; `Tasks` alone when idle. Opens the Tasks drawer (§7.3).
- **Credits chip**: mono `220 cr` with a 6 px dot — `--ok` normally, `--live` when the selected
  reel's next action exceeds the balance (then the chip fill is `--live` at 16 %).
- `⋯` menu: `Export board (PDF) · Play episode · Auto-assign all scenes · Tidy canvas`.
- No primary solid button in the toolbar; the primary action lives on the reel.

### 3.2 Scene tabs (44 px, horizontal scroll, `gap: 6px`, padding `0 16px`)

A tab: 32 px tall, padding `0 12px`, 8 px radius, `--s1` fill, hairline; selected `--s2` fill,
`--ink`, hairline `--line` → `--s3`. Contents left→right: a 6 px **status dot** (§8.2); the number in
mono `--ink3` (`1.`); the heading 12.5/500 uppercase as the script writes it, `letter-spacing: .02em`,
ellipsis at 260 px max width. On hover/focus two 22 px icon buttons appear at the tab's right edge
(inside the tab, `--s2`): `Read` (a page glyph — opens the Scenes reading modal) and `Auto-assign`
(the wand glyph). Scroll arrows `⟨ ⟩` at the strip's right edge when overflowing; `←/→` keys move
selection; the selected tab scrolls into view.

### 3.3 Reel strip (92 px, horizontal scroll, `gap: 10px`, padding `12px 16px`)

A **reel card**: 232 × 68 px, 12 px radius, `--s1`, hairline; selected: 2 px `--accent` border;
`--s2` on hover. Grid inside (`padding: 10px 12px`):

```
Reel 1                 15 s · 4 shots        ⋯
● Rendered                       [ Rendered · view ]
```

- Row 1: name 13/500 (double-click or `⋯ → Rename`), duration and shot count mono 11 `--ink3`, `⋯`.
- Row 2: the **status pill** (§8.1) left; the **reel action** right — a 26 px button:
  `✦ Start shooting · 375 cr` (`--accent-bg` fill, `--accent` text) when ready; `Rendering…` with a
  12 px spinner (disabled); `Rendered · view` (`--ok` text, `--ok` at 12 % fill) when a version is
  kept (click scrolls the canvas to the Clip card); disabled with the reason in `title` otherwise.
- Between consecutive cards a 24 px **continuity glyph**: a thin `--line` link for `natural`, a
  filled `--accent` chain link for `match_last_frame`; hovering shows "Match cut on Reel 1's last
  frame". Clicking it toggles the mode (with the refusal copy when the previous reel has no kept
  clip).
- After each card a 20 px `＋` (`--ink3`, `--ink` on hover) inserts a reel after it.
- The strip ends with a dashed **`＋ Reel`** card (232 × 68, dashed hairline, `--ink3` label).
- **Scene with no reel**: the strip shows one dashed 440 × 68 card: `✦ Propose shots from the
  scene` · `＋ Empty reel` · `Auto-assign`, and the canvas below shows the empty canvas (§3.5).

### 3.4 The reel canvas

Fills the remaining height. Background: the dot grid (`--grid-dot`, 22 px pitch) over `--sunk` at
40 % so it reads recessed. Pan by drag on empty space (space + drag also), zoom `⌘/Ctrl + wheel`
`.5–2×`, `0` fits. World coordinates persist per reel (`reels.layout`). Cards are the Storyboard
canvas's nodes: `--s1`, hairline, 13 px radius, `backdrop-filter: blur(14px)`, `box-shadow: 0 8px
30px rgba(0,0,0,.35)`; selected card: 1 px `--accent` border + `0 0 0 3px var(--accent-bg)`. Every
card has a 36 px **header**: a 14 px glyph, an eyebrow label (`PERFORMANCE`, `SHOTS`, `SCENE`, `CAST`,
`CLIP`, `EXTRA PROMPT`, `IMAGE`) in `--ink3`, a `flex: 1`, then the header's actions and a 6 px
drag handle region (the whole header drags). Body padding 14 px.

**Default layout** (world px, top-left origins; `Tidy` restores it):

```
Performance (360w)  x 40   y 40
Scene       (300w)  x 40   y 420
Cast ×n     (232w)  x 40   y 720 + n·(H+16)   (stacked; a scene with 3 cast = 3 cards)
Shots       (720w)  x 440  y 40
Clip        (420w)  x 1200 y 40
Extra prompt(280w)  x 440  y (below Shots + 24)
Image       (232w)  x 740  y (beside Extra prompt)
```

**Threads** (the Storyboard's animated dashed connector, `--line` → `--accent` when either end is
selected): Performance → Shots (left edge, mid-height), Scene → Shots, each Cast → Shots, Extra
prompt → Shots, Image → Shots, Shots → Clip. A thread from a Cast card with no Look is drawn dashed
in `--warn`.

**Bottom-left zoom pill** (the Storyboard's): `−  100 %  ＋   ⤢ Fit`. **Bottom-centre add pill**:
`＋ Cast` · `＋ Image` · `＋ Extra prompt` · `Tidy` (`--s2` pill, 36 px, 999 radius, backdrop blur).
**Bottom-right composer**: a 320 × 36 recessed field "Ask about this reel…" with a `↑` solid button —
it opens the assistant panel with the reel as Focus and the typed text as the first message (the
one-shot prompt that exists). All three float over the canvas, 16 px from the edges.

### 3.5 Empty canvas (a scene with no reel, or a reel with nothing yet)

The Performance card still draws (the scene is real). The Shots card draws with its empty body
(§4.2). No Clip card until the reel has one accepted shot. Cast cards draw for the scene's cast.
The dot grid and the pills are present.

---

## 4. The cards

Every measurement is at 100 % zoom. Heights are content-driven unless stated.

### 4.1 Performance card (360 w)

```
▤ PERFORMANCE · Scene 1 · lines 1–18                    Set range…   Edit in Script →
────────────────────────────────────────────────────────────────────────────────
EXT. COMMUNITY PITCH – DUSK                                  (eyebrow, mono, --ink3)
The cage under the floodlights. Rain just stopped. An       (action, 13.5/1.6, --read)
OLD MAN sits on the bench at the touchline, a flat ball
at his feet.
        [◉ Ade]                                              (cue chip: 22px Look thumb + name)
        It's flat.                                           (dialogue, indented 32px)
        [○ Old man]                                          (no Look: dashed --ink3 outline avatar)
        (not looking up)                                     (parenthetical, italic, --ink2)
        Everything's flat round here.
────────────────────────────────────────────────────────────────────────────────
⚠ The page changed since these were drawn.   (only when stale — amber line, 12px)
```

- Read-only. Text is not selectable for editing; a click on a line opens nothing. `Edit in Script →`
  opens the Script at the range's first node.
- `Set range…` toggles a range mode: the card lists the scene's nodes with a checkbox rail; drag
  selects a contiguous run; `Done`. The header prints `lines a–b`; `whole scene` when null.
- Max body height 420 px, then an inner scroll.
- Cue chip: 22 px round Look thumbnail (or initials on `--s2`; dashed outline when no Look), name
  12.5/500, `--s2` pill. Hover: "Open Ade →".

### 4.2 Shots card (720 w) — the centre of the route

```
▦ SHOTS · Reel 1                       Clip length [ 5 s | 8 s | 10 s | ●15 s ]     ✦ Propose   ＋ Shot
────────────────────────────────────────────────────────────────────────────────────────────────
[████ 4 s ][███ 3 s ][█████ 5 s ][███ 3 s ]                                         15 / 15 s ●   (timing bar)
────────────────────────────────────────────────────────────────────────────────────────────────
 ①  Wide · Eye level · Static · 24mm         ⏱ 4 s   ↑ ↓ ✕     ┌──────────────┐
    The cage under the floodlights, rain just               │  frame 168×94 │  take 2 of 3 ◂ ▸
    stopped. @Old man on the bench at the                   │  ● kept       │  Keep · Compare · ⋯
    touchline, a flat ball at his feet.                     └──────────────┘
 ②  Medium · Eye level · Handheld · 35mm     ⏱ 3 s   ↑ ↓ ✕     ┌──────────────┐
    @Ade at the gate, bag on one shoulder…                  │ ◐ Generating  │  62 %
                                                            │ ░░░░░░░░░░░░ │  Stop
 ③  Close-up · Low · Static · 50mm            ⏱ 5 s   ↑ ↓ ✕     ┌──────────────┐
    The old man taps the flat ball toward @Ade…             │ ◌ Queued      │
 ④  …                                                        │ ⛔ Refused    │  Suggest rewrite
────────────────────────────────────────────────────────────────────────────────────────────────
 Anchor: shot ①'s kept frame  [thumb 64×36]        ✦ Generate frames · 2 left · 30 cr      Finalize
```

- **Header**: eyebrow + reel name; the **clip length** segmented control (allowed lengths from
  the registry; `--s2` on the active; a length below the shots' sum is disabled with the title
  "Shots already run 12 s — shorten them first"); `✦ Propose` (`--accent` text; on a reel with shots:
  "Replace the current 4 shots?" confirm) and `＋ Shot`.
- **Timing bar**: 10 px tall, 999 radius, on `--s2`; one segment per accepted shot in
  `--seg-(i mod 4)+1`, 2 px gaps, width ∝ duration; a label `4 s` mono 10 inside when ≥ 28 px wide;
  the count `15 / 15 s` mono 12 right: `--ok` on exact fill, `--ink2` under, `--bad` over with a
  `--bad` tail segment for the overrun. Proposed shots draw as hatched `--warn` segments and are
  not counted.
- **Shot row**: `grid: 28px 1fr 168px`, `gap: 12px`, padding `12px 0`, hairline `--line2` between
  rows. Column 1: the **ordinal badge** — 22 px circle in the segment's colour, mono 11 `--solid-ink`
  (light theme keeps white-on-colour). Column 2: line 1 = the camera chips as one mono 11 line
  `Wide · Eye level · Static · 24mm` in `--ink2` (`--ink3` and italic for a field that is still the
  proposer's default — provenance); `⏱ 4 s` chip; `↑ ↓ ✕` icon buttons (`--ink3`, `--ink` on hover;
  disabled on a proposal); line 2+ = the description 13/1.55 `--read` with mention chips (`--s2` pill,
  12.5, the Look thumb 16 px) and quoted speech italic full ink. Clicking the row opens the
  Storyboard's in-place editor for that shot (built) inside the row; `Esc`/`Done` closes.
  **Proposed row**: `--warn` dashed left border 2 px, eyebrow `Proposed from the scene`, `Accept ·
  Discard` in place of the icons. **Blocked row**: `--bad` left border, a `--bad-bg` block under the
  description: "The model refused this shot: violence. Rewrite the shot or remove the blood." and
  `Suggest rewrite` (opens the assistant with the refusal as the question).
- Column 3: the **frame tile** (§5) with its take row under it: `take 2 of 3 ◂ ▸` mono 11, then
  `Keep · Compare · ⋯` (⋯ = `Select for… · Redraw · Upload · Details · Download`).
- **Footer** (44 px, `--s2` at 50 %, hairline above): the **Anchor** — a 64 × 36 thumb of shot 1's
  kept frame with the label `Anchor` (or `No anchor yet — keep shot 1's frame` in `--ink3`); `flex:
  1`; **`✦ Generate frames · 2 left · 30 cr`** (`--accent-bg` fill; disabled with reason: `Describe
  shot 4 first` / `Needs 30 cr — 10 short` / `Waiting for shot 2's frame`); **`Finalize`** (solid
  button; disabled until every shot has a frame and the bar is exact; becomes `Unlock` when
  finalized, disabled while rendering). Finalized: every row's editor and `↑ ↓ ✕` are disabled with
  the title "Unlock the reel to edit its shots"; a small lock glyph sits in the header.
- **Empty body** (no shots): a 120 px centred block — "No shots yet" 13/500, one line "Propose from
  the scene's action, or add a shot by hand.", `✦ Propose shots` · `＋ Shot`.

### 4.3 Scene card (300 w)

```
◎ SCENE · Community pitch                                          Open location →
────────────────────────────────────────────────────────────
EXT · DUSK · rain just stopped            (facts line, mono 11, --ink3; the third item from sets.ts if any)
┌──────────────────────────────────────────────────────────┐
│  scene still 16:9 (272×153)                              │   states: empty / queued / generating / drawn / stale / blocked
│  "No still yet"  or the image                            │
└──────────────────────────────────────────────────────────┘
take 1 of 2 ◂ ▸    Keep · Compare · ⋯
Plate  [thumb 56×32] Community pitch     (or "No plate yet — Generate on the location →" in --warn)
✦ Scene still · 15 cr                                   Upload
```

- The still's prompt inputs are visible on hover of the `✦` button's `ⓘ`: "Uses: the plate, Ade's
  look, Nia's look, the art style" — the same chip list the File view shows.

### 4.4 Cast card (232 w; one per character in the scene's derived cast)

```
◉ CAST                                             Open record →
┌───────────────────────────┐
│  Look 3:4 (204×272)       │   the kept Look, or the uploaded portrait, or:
│                           │   dashed frame, initials 26px, "No look yet"
└───────────────────────────┘
Ade                                   (15/500)
17 · lead · in 3 shots                (mono 11, --ink3; "in this scene" when no age/role)
seventeen, wiry, close-cropped hair…  (appearance line, 12.5, --ink2, 2 lines max)
● Look kept · Turnaround kept         (12, --ok)   /   ○ No look — the model will invent a face  (--warn)
✦ Generate look · 15 cr               (only when there is no Look; goes to the record's job)
```

- A cast card is never removed (the cast is derived); `＋ Cast` adds an **extra** card for a
  character not in the scene (a silent extra), removable with `✕` in its header. Extra cast cards
  are stored in `reels.layout` as `{kind: 'cast', characterId, extra: true}`.
- The `--warn` dashed thread from a no-Look card to the Shots card is the visual gate.

### 4.5 Clip card (420 w)

```
▶ CLIP · Reel 1                        Continuity [ Natural cut | ● Match cut on last frame ]
────────────────────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────────┐
│  player 16:9 (392×220), poster = anchor; native controls                 │
│  states: gate box / ready / queued / rendering / rendered / failed / blocked / stale │
└──────────────────────────────────────────────────────────────────────────┘
Version 2 of 2 ◂ ▸   ● kept        Keep · Reshoot · Delete version · Download MP4 · Details
────────────────────────────────────────────────────────────────────────────
✦ Start shooting · 375 cr                                    15 s · 720p · Standard
likely 2–3 versions ≈ 750–1,125 cr                            (12, --ink3)
```

- **Gate box** (replaces the player until ready): `--s2` panel, eyebrow `3 LEFT`, then lines:
  `○ Describe shot 4 →` · `○ Fill the clip: 12 / 15 s →` · `○ Draw 2 frames →` · `○ Finalize →`
  (required, `--ink`); then `◌ Scene still (recommended) →` · `◌ Old man has no look (recommended) →`
  (`--warn`). Each `→` scrolls to the thing. When everything required is met the box reads `READY
  TO SHOOT` in `--ok` and the player area shows the anchor dimmed with a centred `✦ Start shooting`.
- **Rendering**: the anchor dimmed, a centred 12 px spinner, `Rendering… 1:20 elapsed`, `Stop`
  (cancel; the title says whether it refunds per D-9).
- **Versions row**: `Version i of n ◂ ▸` mono; `● kept` `--ok`; the actions. `Delete version` asks
  "Delete version 1? Its 375 cr are spent." Kept version cannot be deleted while kept.
- **Continuity** segmented control in the header; the second option disabled with "Reel 1 has no
  kept clip yet" when there is no previous kept clip (for Reel 1 of Scene 1: "Nothing before this").
- **Stale**: an amber tag `Stale — line 9 changed` on the player's corner; `Reshoot` live.

### 4.6 Extra prompt card (280 w)

```
✎ EXTRA PROMPT                                      ✕
────────────────────────────────────────────────────
[ textarea, 4 rows, --sunk, 12.5px ]  "Anything the page doesn't say — weather, era, a colour."
Applies to: ● still  ● frames  ● clip   (three toggles, all on by default)
```

Stored on `reels.extra_prompt` + `reels.extra_prompt_targets`. Appended at the end of the prompt.

### 4.7 Image card (232 w) — a reference the writer drags in

```
▣ IMAGE                                             ✕
┌───────────────────────────┐
│  the image, contain, 204×* │    empty: dashed drop zone "Drop an image or click to upload"
└───────────────────────────┘
Use as [ Style | Location | Prop ]     (segmented; sets the reference role)
```

Stored as an R2 key in `reels.layout` (`{kind: 'image', key, role}`); fed as `reference_style` /
`reference_location` / `reference_prop`.

---

## 5. The frame tile (168 × 94, 16:9, 8 px radius) — every state

| State | Visual | Text |
|---|---|---|
| empty | `--frame-a → --frame-b` gradient, `--frame-grid` hairline grid | `Describe the shot` (12, `--frame-ink`) / `Ready to draw` |
| queued | same gradient, a `◌` glyph | `Queued` |
| generating | gradient + a shimmer sweep (a 40 % wide `--s3` band sliding left→right, 1.6 s loop) + a 3 px `--accent` bar at the bottom | `Generating` · `62 %` when known (mono), `Stop` on hover |
| waiting | gradient, `--ink3` | `Waiting for shot 2's frame` |
| drawn | the image, `object-fit: cover`; a 6 px `--ok` dot top-right when it is the kept take | — |
| uploaded | the image + a small `↑` badge (`--frame-badge`) | tooltip "Uploaded" |
| stale | the image dimmed to 70 % + an amber corner tag | `Stale` (tooltip lists what changed) |
| blocked | `--bad-bg` fill, `--bad` 1 px border, `⛔` | `Can't draw — rewrite shot 4` |
| failed | gradient, `--live` text | `Failed · refunded` / `Failed · not yet refunded` |
| cancelled | gradient, `--ink3` | `Cancelled` |

Hover on drawn/uploaded: the Storyboard's CSS overlay (`--shot-over-a..c` gradient from the bottom)
with `Keep` and `⤢` (opens the File view). Compare: the tile expands in place to 336 × 189 with the
mode control `Split · Fade · Side by side` and a second take picked from the strip.

---

## 6. The Episode view

Toolbar identical; the header's `Episode` tab active. Content scrolls vertically.

```
┌ Scenes ┐ ┌ Reels ┐ ┌ Frames ┐ ┌ Clips rendered ┐        (four stat tiles, 26/300 figure + eyebrow + note)
│   5    │ │  7    │ │ 18/24  │ │ 2 · 30 s total │
                                                    [ ▶ Play episode ]  [ Export board (PDF) ]
SCENE 1 · EXT. COMMUNITY PITCH – DUSK
[ thumb 16:9 240×135  Reel 1 · 15 s · ● Rendered ]  ⛓  [ thumb  Reel 2 · 10 s · ● Writing shots ]
SCENE 2 · INT. ADE'S KITCHEN – NIGHT
[ dashed 240×135  No reel · ✦ Propose ]
SCENE 3 · …
[ thumb  Reel 1 · 15 s · ● Generating 2 of 4 ]
…
────────────────────────────────────────────────── (then the existing table: Scene · Reels · Shots · Frames · Clip · Credits)
```

- Stat tiles: `--s1` cards, 13 px radius, 120 px tall, four across (wrap at < 900 px). The fourth
  tile's note reads `720p · 30 s total`; a fifth tile `Stale · 1` appears in `--warn` only when > 0.
- A reel thumb: the kept version's poster (a `▶` glyph centred, `--shade` scrim) or the anchor
  (no glyph) or the dashed empty; below it name · duration · status pill. Click → the Scene view
  with that reel selected. The continuity glyph between thumbs as in the strip.
- `▶ Play episode`: a modal player 960 wide, the kept versions in order, a strip of reel chips
  under it lighting as each plays; reels without a kept version are listed after: "Skipped: Scene 2
  (no reel), Scene 3 Reel 1 (not rendered)".

---

## 7. Dialogs and drawers

### 7.1 Film settings dialog (720 × auto, centred, `--s1`, 16 px radius, blur; scrim `--shade`)

```
Film settings                                                              ✕
The shared look of every still, frame and clip. Changing it marks drawn work stale; nothing is deleted.

ART STYLE
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐      (4 across, 156×132, 12 radius)
│ swatch     │ │ swatch     │ │ swatch     │ │ swatch     │      swatch = a 156×56 gradient/stripes from the preset's palette
│ New Holly… │ │ Film Noir  │ │ Wes Ander… │ │ Anime Cin… │      name 13/500, era mono 11 --ink3
│ 1970s      │ │ 1940s      │ │ 2000s–10s  │ │ 1980s–now  │      selected: --accent border + ✓
└────────────┘ └────────────┘ └────────────┘ └────────────┘      ( … 12 cards, 3 rows, + a "None" card first )
Selected: New Hollywood / Modern American Realism — The Graduate · Taxi Driver · Kramer vs. Kramer
Gritty, world-weary American realism, faded warm-yellow film grain, adult social pressure and loneliness.

ASPECT   [ ● 16:9 Landscape | 9:16 Portrait ]      CAMERA STYLE [ ● Academy | Handheld ]
RESOLUTION [ ● 720p | 1080p ]                      QUALITY [ Draft | ● Standard | Cinema ]
Standard: balanced cost and detail · a 15 s clip ≈ 375 cr                      (tier note, 12 --ink3)

⚠ Changing the art style marks 3 stills, 14 frames and 2 clips stale.        (only when changed)
                                                             Cancel   [ Save ]
```

The twelve art-style names, eras, notable works and traits are in [03-data-model.md](03-data-model.md)
§7 — use them verbatim in the mockup. "None" is a card with a plain `--s2` swatch and "No style
prefix; the page alone".

### 7.2 File view drawer (the shell's 400 px drawer, `--sunk`)

```
✕                                                   Shot 01-03 · take 2 of 3
┌──────────────────────────────────────────────────┐
│  image 368×207 (or the video with controls)      │
└──────────────────────────────────────────────────┘
● kept   Keep · Select for… · Regenerate · Download · Delete take

INFO        Created 18 Sep, 14:02 · by Prashant · Standard · 1280×720 · 16:9
PROMPT      [ the assembled prompt, mono 11.5, --sunk box, 6 lines then "Show all" ]   Copy
REFERENCES  [◉ Ade — look] [◉ Ade — turnaround] [◎ Community pitch — plate] [▦ still] [① previous frame]
            (chips; click opens the record / the take)
PROVENANCE  Parent: take 1 (redraw) · seed 8123 · held 15 cr · charged 15 cr · refund —
COMMENTS    (the existing thread UI, anchored to this take)
```

### 7.3 Tasks drawer (400 px)

```
Tasks · 2 running                                       ✕
[ All | Running | Done | Failed ]   [ Frames ▾ ]
◐ Frame · Scene 3 · shot 2      Generating 62 %    15 cr    2 min ago · you        Stop   →
◌ Frame · Scene 3 · shot 3      Queued             15 cr    2 min ago · you        Cancel →
● Clip · Scene 1 · Reel 1       Rendered           375 cr   yesterday · you                →
⛔ Frame · Scene 3 · shot 4      Refused            0 cr     3 min ago · you                →
✕ Frame · Scene 5 · shot 1      Failed · refunded  15 cr    Tue · Nia                      →
Nothing running.   (empty)
```

Rows 44 px; the glyph in the state's colour; `→` selects the target on the canvas.

### 7.4 Confirmations (small centred dialogs, 420 w)

- **Propose over existing shots**: "Replace the current 4 shots? The proposals arrive as suggestions
  you accept or discard; the existing shots and their frames are removed." `Cancel · Replace`.
- **Auto-assign**: "Arrange 9 shots into reels of 15 s? This replaces the scene's 2 reels." (or
  "Nothing to arrange — the scene has no accepted shots.") `Cancel · Arrange`.
- **Delete reel**: "Delete Reel 2 and its 3 versions? The shots stay on the Storyboard." (refused
  while a job runs: "Reel 2 is rendering — stop it first.")
- **Delete version / take**: "Delete version 1? Its 375 cr are spent."
- **Unlock a rendered reel**: "Unlock Reel 1? Its versions stay; new frames will mark them stale."

### 7.5 Characters drawer — the Look section (on `/characters`)

Above the existing sheet, a section `LOOK`:

```
LOOK                                                       
┌──────────────┐  ┌──────────────┐  ┌──────────────┐        (take strip: 3:4 tiles 96×128, kept ● --ok)
│  kept  ●     │  │              │  │  + Upload    │
└──────────────┘  └──────────────┘  └──────────────┘
Appearance   [ seventeen, wiry, close-cropped hair, a faded green training top… ]   (one-line field, saved with the sheet)
✦ Generate look · 15 cr        ✦ Turnaround · 25 cr (needs a kept look)        Upload
TURNAROUND   [ sheet 16:9 thumb 240×135 ● kept ]   take 1 of 1
Used in 6 frames and 2 clips · Regenerating marks them stale     (12, --ink3)
```

### 7.6 Locations drawer — the Plate section (on `/locations`)

```
PLATE
┌──────────────────────────────┐
│  kept plate 16:9 240×135 ●   │   or the uploaded photo, or dashed "No plate yet"
└──────────────────────────────┘
Set, from the script:  EXT · dusk, night, day · "chain fence", "puddles"   (the sets.ts reading, mono chips)
✦ Generate plate · 15 cr        Upload
```

---

## 8. Status vocabulary, colours and copy

### 8.1 Status pills (6 px dot in lists, pill on cards; mono-free, 11.5/500, 999 radius, 22 px)

| Status | Colour | Pill text | When |
|---|---|---|---|
| writing shots | `--ink2` on `--s2` | `Writing shots` | a shot lacks a description, or no shots |
| proposed | `--warn` | `Proposed` | proposals waiting |
| ready | `--accent` | `Ready to draw` | every shot described, none drawn |
| needs credits | `--live` | `Needs credits` | next action > balance |
| generating | `--accent` (pulsing dot) | `Generating 2 of 4` | a frame/still job in flight |
| blocked | `--bad` | `Refused` | a blocked job on a shot not edited since |
| frames done | `--ok` | `Frames done` | every frame drawn/uploaded, bar exact |
| finalized | `--ok` | `Finalized` | `finalized_at` set, no clip |
| rendering | `--accent` (pulsing) | `Rendering…` | a render in flight |
| rendered | `--ok` | `Rendered` | a version kept |
| stale | `--warn` | `Stale` | any kept output's hash differs |

### 8.2 The scene tab dot

Worst-of its reels: `--bad` refused › `--live` needs credits › `--warn` stale/proposed › `--accent`
generating/rendering › `--ink3` writing › `--ok` when every reel is rendered and none stale.
Hollow ring (`--line`) for a scene with no reel.

### 8.3 Strings (verbatim; sentence case; costs are placeholders until D-4)

| Key | Text |
|---|---|
| toolbar.filmSettings | `Film settings · {style}` / `Film settings · none` |
| toolbar.tasks | `Tasks · {n} running` / `Tasks` |
| toolbar.menu | `Export board (PDF)` · `Play episode` · `Auto-assign all scenes` · `Tidy canvas` |
| tab.read | `Read the scene` |
| tab.autoAssign | `Auto-assign reels` |
| strip.addReel | `＋ Reel` |
| strip.start | `✦ Start shooting · {cost} cr` |
| strip.rendering | `Rendering…` |
| strip.rendered | `Rendered · view` |
| strip.continuity.natural | `Natural cut` |
| strip.continuity.match | `Match cut on last frame` |
| strip.continuity.blocked | `{prev} has no kept clip yet` / `Nothing before this` |
| empty.noScript | `Nothing to produce yet` · `Write a scene heading in the script and it appears here.` · `Open the script` |
| empty.noScenes | `No scene headings yet` · same |
| empty.noSettings | `Set the film's look` · `One art style, aspect and quality for every still, frame and clip. You can change it later; changing it marks drawn work stale.` · `✦ Choose an art style` · `Skip for now` |
| empty.noReel | `✦ Propose shots from the scene` · `＋ Empty reel` · `Auto-assign` |
| shots.empty | `No shots yet` · `Propose from the scene's action, or add a shot by hand.` |
| shots.clipTooShort | `Shots already run {sum} s — shorten them first` |
| shots.generate | `✦ Generate frames · {n} left · {cost} cr` |
| shots.generate.describe | `Describe shot {n} first` |
| shots.generate.credits | `Needs {cost} cr — {short} short` |
| shots.generate.waiting | `Waiting for shot {n}'s frame` |
| shots.finalize | `Finalize` / `Unlock` / `Unlock the reel to edit its shots` |
| shots.anchor | `Anchor` / `No anchor yet — keep shot 1's frame` |
| shots.propose.replace | `Replace the current {n} shots?` |
| tile.* | see §5 |
| tile.blocked | `Can't draw — rewrite shot {n}` |
| row.blocked | `The model refused this shot: {reason}. Rewrite the shot or remove the {detail}.` · `Suggest rewrite` |
| scene.noStill | `No still yet` |
| scene.noPlate | `No plate yet — generate it on the location →` |
| scene.still | `✦ Scene still · {cost} cr` |
| cast.noLook | `No look yet` / `No look — the model will invent a face, and it will differ between frames` |
| cast.kept | `Look kept` · `Turnaround kept` |
| clip.gate.title | `{n} left` / `Ready to shoot` |
| clip.gate.* | `Describe shot {n}` · `Fill the clip: {sum} / {len} s` · `Draw {n} frames` · `Finalize` · `Scene still (recommended)` · `{name} has no look (recommended)` · `Plate for {location} (recommended)` |
| clip.start | `✦ Start shooting · {cost} cr` · `likely 2–3 versions ≈ {lo}–{hi} cr` |
| clip.rendering | `Rendering… {elapsed}` · `Stop` |
| clip.version | `Version {i} of {n}` · `kept` · `Keep` · `Reshoot` · `Delete version` · `Download MP4` · `Details` |
| clip.deleteVersion | `Delete version {i}? Its {cost} cr are spent.` |
| stale.tag | `Stale` · `Stale — {what} changed` (what ∈ `line {n}` · `{name}'s look` · `the art style` · `the plate` · `the still`) |
| perf.changed | `The page changed since these were drawn.` |
| perf.edit | `Edit in Script →` · `Set range…` · `whole scene` · `lines {a}–{b}` |
| job.noWorker | `No worker connected — set REDIS_URL and FAL_KEY` |
| job.failed | `Failed · refunded` / `Failed · not yet refunded` |
| tasks.empty | `Nothing running.` |
| episode.play | `▶ Play episode` · `Skipped: {list}` |
| credits.short | `Top up to continue` |

---

## 9. Interaction rules

- **Selection**: one scene, one reel, at most one card selected; `Esc` clears the card.
- **Drag**: cards by their header; shots by their badge (row reorder); an image file onto the
  canvas creates an Image card at the drop point; onto a frame tile uploads that shot's frame.
- **Keys**: `←/→` scene tabs (when focused), `[`/`]` previous/next reel, `0` fit, `⌘/Ctrl+Enter` on
  a focused reel = its primary action, `K` on a focused take = Keep.
- **Optimistic writes**: shot edits, keeps, renames, continuity toggles apply instantly and roll
  back with a toast on failure (the Timeline's pattern). Job state is read every 3 s while any job
  is queued/running for the selected episode; no realtime.
- **Threads** animate only when a card at either end is selected or a job on it runs.
- **Hover overlays** on tiles are CSS-only (the Storyboard's ruling).
- **Toasts** (the shared `use-toast`): `Reel 1 rendered` · `Shot 3 drawn` · `Refunded 15 cr — the
  model failed` · `Couldn't save — try again`.

---

## 10. Light theme

Every frame in both themes. In light: the same alphas of black for `--s1..3`; `--bad` at
`oklch(.52 .17 25)`; the frame gradient `.80/.58`; segment colours unchanged (they are mid-lightness
by design); the shimmer band uses `--s3`; the ordinal badge keeps white text on the segment colour;
the dot grid `rgba(20,18,14,.14)`.

---

## 11. Responsive

- ≥ 1200 px: as drawn; the assistant/drawer in flow.
- 1040–1200 px with a panel open: the sidebar is forced closed (shell rule); the canvas keeps its
  world; the reel strip scrolls.
- < 1040 px: the canvas region shows a 440 px card "Open on a wider screen — the reel canvas needs
  1040 px." with the reel strip and the Episode view still usable (the strip and the table are
  responsive).

---

## 12. The mockup frames to produce (Claude Design)

Produce each as a full-shell screen at 1440 × 900 unless stated, dark theme unless stated, with the
sample data of §2. Name them exactly.

| # | Frame | Contents |
|---|---|---|
| F01 | `Production · Scene · authoring` | Scene 1 selected, Reel 2 selected (writing shots, 7 / 10 s, one proposed row, one empty tile, one drawn tile), all cards, the `--warn` thread from the Old man's Cast card, gate box `3 left` |
| F02 | `Production · Scene · rendered` | Scene 1, Reel 1: finalized, lock glyph, all four tiles drawn (one kept dot each), Clip card with the player, `Version 2 of 2 · kept`, match-cut glyph between Reel 1 and Reel 2, credits chip `--ok` |
| F03 | `Production · Scene · generating + refused` | Scene 3, Reel 1: tiles drawn / generating 62 % / queued / blocked; the blocked row's `--bad` block and `Suggest rewrite`; toolbar `Tasks · 2 running` pulsing; status pill `Generating 2 of 4` |
| F04 | `Production · Scene · stale` | Scene 5: rendered reel with the amber `Stale — line 9 changed` tags on two tiles and the clip; the Performance card's amber line; status pill `Stale` |
| F05 | `Production · Scene · needs credits` | Reel with `✦ Start shooting · 375 cr` disabled, credits chip `--live` at 220 cr, the gate box reading `Ready to shoot` but the button's reason "Needs 375 cr — 155 short · Top up to continue" |
| F06 | `Production · Scene · no film settings` | First visit: the `Set the film's look` 440 px card over the canvas, cards behind dimmed |
| F07 | `Production · Scene · empty scene` | Scene 2: the dashed `✦ Propose shots from the scene · ＋ Empty reel · Auto-assign` card in the strip, Performance + Cast cards drawn, the Shots card's empty body |
| F08 | `Production · Scene · no script` | The 440 px `Nothing to produce yet` card, no tabs, no strip |
| F09 | `Production · Episode` | The four tiles + `Stale · 1`, the reel strip across five scenes, `▶ Play episode`, the table |
| F10 | `Film settings dialog` | Open over F01; New Hollywood selected; the stale warning line visible |
| F11 | `File view drawer` | F02 with the drawer open on shot 3's take 2: image, info, prompt, reference chips, provenance, a comment |
| F12 | `Tasks drawer` | F03 with the Tasks drawer open (five rows as in §7.3) |
| F13 | `Compare` | The Shots card with shot 1's tile expanded in Split mode between take 1 and take 2 |
| F14 | `Characters drawer · Look` | `/characters` with Ade's drawer open: the Look section of §7.5 above the sheet |
| F15 | `Locations drawer · Plate` | `/locations` with the community pitch's drawer: §7.6 |
| F16 | `Play episode modal` | The 960 px player over F09, second reel playing, the skipped list |
| F17 | `Light theme` | F01 in light |
| F18 | `Narrow + assistant` | F02 at 1100 × 800 with the assistant panel open (sidebar forced closed), the panel's subhead "Ask about Reel 1" and three live chips |
| F19 | `Auto-assign confirm` | The §7.4 dialog over Scene 1 |
| F20 | `Canvas states sheet` | One artboard: the frame tile in all ten states (§5), the status pills (§8.1), the reel card in five states, the Cast card with/without a Look, the timing bar under / exact / over / with a proposed segment |

**Brief for Claude Design** (paste with §1, §2 and the frame row): "Draw `F01` for a dark,
chrome-light screenwriting workspace. Use the token block verbatim; Geist; sentence case; no
illustrations, no emoji, no extra hues. The shell (rail 56, sidebar 236, header 60, status bar 28)
is fixed — draw it plainly and spend the effort on the content region described in §3–§5. Every
string is given; do not invent copy. Every state named for the frame must be visible."

---

## 13. What the frontend phases take from the approved frames

Phase 2 builds §3–§4 (the canvas, cards, strip, tabs) and §7.1/7.4; phase 3 builds §4.5 and the
clip states; phase 4 builds §6, §7.2, §7.3 and the exports; phase 1 builds §7.5/7.6 on the record
routes. Where an approved frame and this text disagree, the frame wins and the difference is
logged in [06-decisions.md](06-decisions.md).
