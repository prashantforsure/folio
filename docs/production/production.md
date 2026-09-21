# Production route — implementation spec (v12)

Single source of truth for building the Production page: every region, element, state,
enum and interaction, plus the data model the frontend and backend need to support it.

Mockup: `Route - Production v12.dc.html` (sample data in `folio-data-v4.js`, runtime in `support.js`).
Open the HTML directly in a browser; all three files must sit in the same folder.

Route: `/projects/:projectId/episodes/:episodeId/production`
Selection state (scene + reel) is client-side, no reload.

---

## 1. Mental model

```
Project (film)  →  Episode  →  Scene  →  Reel  →  Shot
                                  │        │
                                  │        ├─ Storyboard sheet (ONE per reel, covers all shots)
                                  │        └─ Clip / render (the shot video for the reel)
                                  └─ Scene image (one still per scene)
Episode-level:  Production Settings (aspect ratio, type, camera, pacing, lighting, art style)
Project-level:  Characters (cast) with appearance references, Locations
```

Rules that the UI enforces and the backend must mirror:

1. A **reel** has a target clip length (5 / 8 / 10 / 15 s). The sum of its shot durations
   must equal that length before the reel can be shot.
2. A reel has exactly **one storyboard sheet** — not one image per shot. The sheet contains a
   top-down blocking plate plus one frame + camera note per shot.
3. **Start shooting** is gated on four conditions (see §6 Readiness).
4. Production settings are described in the UI as **locked once production starts** (aspect
   ratio, production type, camera style). Backend should enforce a `locked_at` timestamp.
5. Characters referenced in a shot description with `@Name` drive the shot's Character field
   automatically until a user overrides it.

---

## 2. Page anatomy

Top-level: `100vh`, `min-height 620px`, flex row, `overflow:hidden`, two ambient radial glows
behind everything (`pointer-events:none`).

```
┌──────┬──────────────────────────────────────────────────────────────┐
│ rail │ header (breadcrumb · settings chip · Share · assistant)      │
│ 56px ├──────────────────────────────────────────────────────────────┤
│      │ panel (rounded 18px 0 0 0, translucent, blurred)             │
│      │  ├ scene tabs row      + view-options / filter buttons       │
│      │  ├ reel strip          (per-reel chip + Start Shooting)      │
│      │  └ board (scroll)                                            │
│      │      Cards view: per reel → header · timing bar ·            │
│      │        shotlist + storyboard sheet · scene setup +           │
│      │        scene image · readiness steps + shoot button          │
│      │      Columns view: one table per scene                       │
└──────┴──────────────────────────────────────────────────────────────┘
Overlays: bulk bar (bottom centre) · detail drawer (right, 420px) ·
          context menu (cursor-positioned) · Production Settings modal
```

### 2.1 Left rail (56px)

Six route buttons (38×38, radius 11) + theme toggle pinned to the bottom.
Order: Script, Characters, Locations, Storyboard, Timeline, Production.
Active item = `background: var(--s2)`, `color: var(--ink)`; inactive `var(--ink3)`.
Theme toggle switches `data-theme` between `dark` and `light` on the root element.

### 2.2 Header (60px)

| Element | Behaviour |
|---|---|
| Breadcrumb | `Project / Episode / Production`, last crumb full ink, truncates with ellipsis |
| Settings chip | Gear icon + **current art style name**; opens Production Settings modal |
| Share | Solid pill, primary action |
| Assistant | 26px gradient orb, opens the AI assistant |

### 2.3 Scene tabs

One chip per scene in the episode: `"{n}. {heading}"`, `title` = scene facts
(`EXT · DUSK · rain just stopped`). Active chip gets `var(--s2)` background,
`var(--ink3)` border, weight 500, and shows two trailing glyphs (script + AI) as affordances.
Clicking a tab selects that scene **and** its first reel. Row scrolls horizontally.

Right of the tabs: **view options** button and **filter & sort** button (both 32×30).

### 2.4 View options popover (330px)

- **Layout** segmented control: Cards / Columns.
- **Metadata** list with a toggle switch per field + a `Hide all` / `Show all` link and a
  search box. Hiding a field removes it everywhere (cards, table columns, scene setup row,
  drawer). Field order is drag-reorderable (`⠿` handle).

Field list (17, ids are the persisted keys):

`title, status, desc, dialogue, refs, type, motion, duration, cast, prop, lens, date, loc, intext, notes, assignee, priority`

### 2.5 Filter & sort popover (270px)

- **Status**: `All` · `To draw` (matches To draw + Queued) · `Drawn` · `Needs attention`
  (Refused, Out of date, Proposed).
- **Assignee**: `Unassigned only` toggle.
- **Sort**: `Scene order` (default) · `Longest first` · `By status`.

When any filter or non-default sort is active the filter button border and icon turn accent.

### 2.6 Reel strip

One chip per reel in the selected scene: reel name, **Start Shooting** button, a status dot,
and a `＋` (new reel). Selected chip: `var(--s2)` bg, accent border, `0 0 0 2px accent-bg` ring.
Trailing dashed `＋` tile adds a reel. Status dot colour: rendered → ok, generating → accent,
stale → warn, writing → ink3.

---

## 3. Cards view — per-reel anatomy

Rendered for the selected scene / reel only.

### 3.1 Reel header

Reel icon + name · status pill (`Rendered` / `Generating` / `Out of date` / `Writing`) ·
divider · `Clip length` segmented control (`5s 8s 10s 15s`) · spacer ·
`{used} / {target} s` in mono (green when equal, red when over, dim when under) · `⋯` menu.

### 3.2 Timing bar

One segment per shot, width proportional to `duration / max(clipLength, totalDuration)`,
filled with the 4-colour segment palette cycling by index, label `{n}s`.
Proposed shots render as a hatched outline in warn colour instead of a solid fill.
Each segment has a 9px right drag handle → **pointer-drag to retime** (`col-resize`);
clamped to `1 … min(clipLength,15) − sum(other shots)`, rounded to whole seconds.
Remaining time shows as a dashed `{n}s free` segment.

### 3.3 Shotlist column (`flex: 1 1 430px`)

Header: `SHOTLIST` · shot count · `✦ AI Shotlist` (accent) · `＋ Shot`.

Shot card (`var(--sunk)` bg, radius 12, draggable):

| Row | Contents |
|---|---|
| 1 | Numbered badge (segment colour) · duration pill (clock icon, opens duration menu) · spacer · status button (coloured dot + label, pulsing dot while Generating) · select checkbox · delete |
| 2 | Camera line, mono: `{body}, {lens} — {type}, {angle}, {motion}` |
| 3 | Description — rich runs: plain text, `@Character` mentions (accent chip), dialogue (italic, green chip) |
| 4 | Refusal banner (only when blocked): red-bordered box with `blockText` |
| 5 | Attribute chips: shot type · camera movement · character (each opens its menu) |

Footer: `＋ Add shot` full-width button.

Interactions: click card → detail drawer; drag card → reorder within / across reels;
checkbox → multi-select (bulk bar); each chip → context menu of allowed values.
Selected / open card: accent border + `0 0 0 3px accent-bg`. Dragged card drops to `.45` opacity.

### 3.4 Storyboard sheet column (`flex: 1 1 320px`, max 440px)

Header: `STORYBOARD SHEET` · state pill (`Generated` / `Generating` / `Not generated`) ·
mono meta `{n} frames · 1 image`.

The sheet itself is one image: a top-down blocking plate (`top-down blocking · camera paths`)
plus one row per shot — frame thumbnail (55%) + mono note (45%) with
`{i}. {TYPE} – {MOTION}`, `{body} · {lens}`, `{from}–{to}s`.

States: `none` → dark overlay "No storyboard yet" + hint; `gen` → 0.8 opacity + progress bar;
`done` → full opacity, all rows. Not-generated shows only the first two rows behind the overlay.

Action button: `✦ AI Storyboard · 40 cr` → `◌ Drawing sheet…` → `✦ Redraw sheet · 40 cr`.
Disabled (`not-allowed`, .55 opacity) when the reel has no shots.

### 3.5 Scene setup row

`SCENE SETUP — applies to every shot`. Auto-fill grid of dropdown buttons, one per visible
field: Camera (body · lens), Props, Location, INT/EXT, Shoot day, Priority, Notes
(`＋ Add note` when empty). Values default from the scene / first shot and are overridable
per scene. Hidden fields disappear from this row.

### 3.6 Scene image

`SCENE IMAGE` + placeholder plate (`scene still`) + `✦ Generate scene` / `↑ Upload scene`.
One image per scene, shared by all its reels.

### 3.7 Readiness bar + shoot

Four steps, each a numbered circle (turns into `✓` + green when satisfied), label and mono sub:

| Step | Satisfied when | Sub-label |
|---|---|---|
| 1 Shotlist | shots exist **and** `sum(durations) == clipLength` | `{n} shots · {used}/{target}s` |
| 2 Storyboard sheet | sheet state `done` | `1 sheet · all shots` / `drawing…` / `not generated` |
| 3 Scene image | scene has a plate and its still is `drawn` | `{location} · locked` / `· needed` |
| 4 Characters | every cast member in the scene has an appearance reference | `from Characters` / `{names} missing` |

Step 4 also renders avatar circles per cast member; missing appearance = dashed warn border.

Right: `▶ Start shooting · 375 cr` (or `▶ Reshoot reel · 375 cr` if a clip already exists).
Enabled only when all four steps pass; otherwise `not-allowed`, .55 opacity, and the tooltip
`Finish the shotlist, storyboard sheet, scene image and character references first`.

---

## 4. Columns view

One card per scene, min-width 1080px, horizontally scrollable.

Scene header: collapse caret · scene location · `Seq. {n}` · facts pill ·
mono summary `{reels} reels · {shots} shots · {secs} s`; logline underneath.

Table columns (fixed widths; hidden when the field is toggled off):
`# 56px | Preview 200px | Title 130 | Status 140 | Description minmax(220px,1.3fr) | Shot type 130 | Duration 100 | Character 150 | Assignee 140`.

Row types: **reel header row** (name + status pill + `{used}/{target} s`),
**shot row**, **empty row** (`No reels in this scene yet.` / `No shots match the current filter.`
with `✦ Propose shots`). Footer: `＋ New shot`.

Shot row: checkbox + index; 104×58 preview tile (image or `frame` / `refused` label);
title; status (dot + label, click → menu); description is **inline-editable**
(`contentEditable`, saves on blur) with the refusal note and a `Read full` link;
shot type / character / assignee cells open menus. Rows are drag-reorderable.
Row background: selected → accent-bg, open in drawer → `var(--s2)`.

---

## 5. Overlays

### 5.1 Bulk bar
Appears when ≥1 shot is selected. `{n} selected` · `Status` · `Assign` · `Priority` ·
`✦ Generate {n} frames` · clear. Menu actions apply to all selected shots.

### 5.2 Detail drawer (right, `min(420px,88vw)`, slide-in 280ms)
Title `Shot {n}` + mono crumb `Scene {n} · {reel}`. Rows: Status, Shot type, Duration,
Character, Assignee, Priority, Location (last two read-only). Then Description (editable),
Dialogue (mono italic, `Add dialogue...` when empty), References (44px thumbs + `＋`),
Camera (full camera string). Closes on `✕` or `Escape`.

### 5.3 Context menu
Cursor-positioned, clamped to the viewport, min 200px, max 320px, closes on outside click or
`Escape`. Shows a search field when the list has >6 items. Three modes:

- **Single-select** (status, type, motion, duration, prop, lens, loc, intext, assignee,
  priority): radio behaviour, `✓` on current; status items show a coloured dot.
- **Multi-select** (character): checkboxes, `No character` clears; values kept in menu order.
- **Special**: `date` renders a month calendar (prev/next, today highlighted, `Clear date`);
  `notes` renders a textarea with `Save note` / `Remove`.

### 5.4 Production Settings modal
`min(1180px)`, two panes (single column under 1160px). Left: Aspect Ratio (3 shape cards) and
four option groups — Production Type, Camera Style, Pacing, Lighting (label + sub each).
Right: Art Style grid (2 columns, 1 under 980px) — 158px reference plate with era pill,
`✓` when selected, name over a gradient scrim, `#tag` list of reference films, description.
Footer: mono summary of all six choices + `— locked to this episode once production starts`,
and a solid `Confirm`.
Opens by default for a fresh episode (`setupOpen: true`), and any time from the header chip.

---

## 6. Enumerations (authoritative)

```
shot_status        to_draw | proposed | queued | generating | drawn | out_of_date | refused
reel_status        writing | generating | rendered | stale
frame_state        empty | ready | queued | gen | waiting | drawn | uploaded | stale |
                   blocked | failed | cancelled
sheet_state        none | gen | done
shot_type          Wide angle | Medium | Close-up | Over | Point | Two shot | Tracking | Dutch
camera_motion      Still | Pan | Zoom | Rotate | Tilt | Follow | Track | Dolly | Handheld | Crane
duration_preset    none | 2 | 3 | 4 | 5 | 8 | 10 | 15   (seconds)
clip_length        5 | 8 | 10 | 15                       (seconds)
priority           none | low | medium | high
int_ext            INT | EXT
aspect_ratio       16:9 landscape | 9:16 portrait | 2.39:1 scope
production_type    Narrative | Commercial | Documentary
camera_style       Academy | Handheld | Steadicam
pacing             Measured | Balanced | Kinetic
lighting           Naturalistic | Motivated | Stylised
sort               order | longest | status
status_filter      all | todraw | drawn | attention
view               grid (Cards) | list (Columns)
theme              dark | light
```

Status derivation (when no explicit override exists):
`blocked → refused`, `proposed → proposed`, else from frame state:
`gen → generating`, `queued → queued`, `stale → out_of_date`,
`drawn|uploaded → drawn`, otherwise `to_draw`.

Art styles (14 presets, seed data — name · era · reference films):
Netflix Prestige Drama · Wes Anderson Symmetrical Fairytale · Hong Kong Neon Modernism ·
Cyberpunk / Neon Futurism · New Hollywood / Modern American Realism · Spaghetti Western ·
French New Wave · Italian Neorealism · Film Noir · Hollywood Golden Age / Art Deco Studio
Glamour · German Expressionism · A24 Contemporary Unease · Anime Cinematic Style ·
Graphic Novel Style. Each carries era, 3 reference titles, a description, and a plate gradient.

Credit costs shown in the UI: storyboard sheet **40 cr**, shoot a reel **375 cr**.

---

## 7. Database schema

Postgres flavour. `id` = uuid pk, `created_at`/`updated_at` on every table, soft delete
(`deleted_at`) on user content. Ordering uses fractional/`numeric` `position` so drag-reorder
is a single-row update.

### Core hierarchy

**projects** — `id, owner_id → users, title, created_at, deleted_at`

**episodes** — `id, project_id → projects, number int, title, created_at, deleted_at`
unique `(project_id, number)`

**episode_settings** (1:1 with episode — the Production Settings modal)
`episode_id pk → episodes, aspect_ratio enum, production_type enum, camera_style enum,
pacing enum, lighting enum, art_style_id → art_styles, locked_at timestamptz null,
updated_by → users`

**art_styles** — `id, key unique, name, era, reference_films text[], description,
plate_gradient text, is_preset bool, project_id null → projects` (null = global preset)

**locations** — `id, project_id, name, int_ext enum null, plate_ready bool,
still_asset_id → assets null`

**scenes**
`id, episode_id → episodes, number int, heading text, location_id → locations,
int_ext enum, time_of_day text, weather_note text, logline text,
script_range text, still_asset_id → assets null, still_state frame_state default 'empty',
position numeric, deleted_at`
unique `(episode_id, number)`
> `facts` in the mockup (`EXT · DUSK · rain just stopped`) is composed from
> `int_ext · time_of_day · weather_note`.

**scene_script_lines** (optional; drives logline + dialogue previews)
`id, scene_id, kind enum(head|action|cue|paren|dlg), character_id null, text, position`

**scene_cast** — `scene_id, character_id` composite pk

**characters**
`id, project_id, name, initials, meta text, hue int, appearance_text text,
appearance_ready bool default false, turnaround_ready bool default false,
reference_asset_id → assets null`
> Readiness step 4 = every `scene_cast` row whose character has `appearance_ready = false`
> is a blocker.

**reels**
`id, scene_id → scenes, name text, clip_length_s smallint default 15,
continuity enum(natural|match) default 'natural', status reel_status default 'writing',
finalized bool default false, position numeric, deleted_at`

**shots**
`id, reel_id → reels, number int, position numeric,
title text null, duration_s smallint, status shot_status null (null = derive),
shot_type enum, camera_angle text, camera_motion enum, camera_body text, lens text,
description text, dialogue text null,
proposed bool default false, blocked bool default false, block_reason text null,
prop text null, location_id null, int_ext null, shoot_date date null, notes text null,
assignee_id → users null, priority enum default 'none',
frame_state frame_state default 'empty', frame_asset_id → assets null,
frame_progress smallint null, frame_kept bool default false, take_index int[] null,
created_by, deleted_at`
unique `(reel_id, number)`
> The mockup's `cam` string is denormalised as five columns:
> `camera_body · lens` and `shot_type · camera_angle · camera_motion`.

**shot_description_parts** (rich description runs; keeps `@mentions` structured)
`id, shot_id, position int, kind enum(text|mention|dialogue), text,
character_id null → characters`
> The Character field auto-derives from `kind='mention'` parts unless
> `shot_characters` has explicit rows.

**shot_characters** — `shot_id, character_id, source enum(auto|manual)` composite pk

### Storyboard / media

**storyboard_sheets** (one per reel)
`id, reel_id unique → reels, state sheet_state default 'none', asset_id → assets null,
progress smallint null, generated_at, credits_spent int, art_style_id, generation_id`

**storyboard_frames** (rows inside a sheet, one per shot)
`id, sheet_id → storyboard_sheets, shot_id → shots, position int,
heading text, camera_note text, time_from_s int, time_to_s int, asset_id null`

**clips** (the shot video produced by "Start shooting")
`id, reel_id → reels, state enum(gate|queued|generating|rendered|stale|failed|cancelled),
version int, poster_asset_id null, video_asset_id null, credits_spent int,
generation_id, created_at`

**assets** — `id, project_id, kind enum(frame|sheet|still|reference|clip|poster|upload),
storage_key, mime, width, height, source enum(generated|uploaded), uploaded_by, created_at`

**generations** (every AI job — shotlist, sheet, scene image, frame, clip)
`id, project_id, episode_id, target_type enum(shot|reel|scene|sheet|character),
target_id uuid, job enum(ai_shotlist|storyboard_sheet|scene_image|shot_frame|shoot_reel|
propose_shots|character_look), state enum(queued|running|succeeded|failed|refused|cancelled),
progress smallint, prompt jsonb, settings_snapshot jsonb, refusal_reason text null,
credits_reserved int, credits_charged int, started_at, finished_at, created_by`
> A `refused` generation writes `blocked = true` + `block_reason` back to the shot.

**credit_ledger** — `id, project_id, delta int, reason enum(purchase|spend|refund),
generation_id null, balance_after int, created_at`

### Collaboration / preferences

**notes** — `id, target_type enum(shot|scene|reel), target_id, body, author_id, created_at`
(the notes popover writes here; the UI shows the latest note as the field value)

**view_preferences** (per user per episode — what View options / Filter & sort persist)
`user_id, episode_id, view enum(grid|list), field_visibility jsonb,
field_order text[], status_filter enum, unassigned_only bool, sort enum,
theme enum(dark|light)` composite pk `(user_id, episode_id)`

**activity_log** — `id, project_id, actor_id, verb, target_type, target_id, diff jsonb, created_at`

### Derived values (compute, don't store)

- reel `used_seconds = Σ shots.duration_s` where `proposed = false`
- reel over/under state: compare `used_seconds` to `clip_length_s`
- scene summary: reel count, shot count, total seconds
- readiness flags 1–4 and `can_shoot` (all four true)
- scene status dot: refused > proposed/stale > generating > all rendered > idle
- timing-bar segment widths

### Suggested endpoints

```
GET    /episodes/:id/production           scenes + reels + shots + sheets + readiness
PATCH  /shots/:id                         any field (status, type, motion, duration, cast…)
PATCH  /shots/bulk                        { ids[], patch }            ← bulk bar
POST   /reels/:id/shots                   create; POST /shots/:id/move { reel_id, before_id }
DELETE /shots/:id
PATCH  /reels/:id                         clip_length_s, name
POST   /reels/:id/storyboard-sheet        generate / redraw (40 cr)
POST   /reels/:id/shoot                   422 with failed readiness flags if not ready (375 cr)
POST   /reels/:id/ai-shotlist             also /scenes/:id/propose-shots
POST   /scenes/:id/scene-image            generate | upload
PUT    /episodes/:id/settings             blocked once locked_at is set
PUT    /users/me/view-preferences/:epId
```

Realtime: subscribe per episode; push `generation.progress`, `shot.updated`,
`sheet.updated`, `clip.updated` so Generating dots, progress bars and status pills live-update.

---

## 8. Design tokens

Copy the `:root` and `[data-theme="light"]` blocks from the top of the mockup verbatim —
that is the design system. Type: **Geist** (200–600) for UI, **Geist Mono** (400–500) for
numbers, camera lines and metadata. Numbers use `font-variant-numeric: tabular-nums`.

Key semantics: `--accent` = AI / active, `--ok` = done, `--warn` = stale or proposed,
`--bad` = refused or over-length, `--seg-1…4` = timing-bar and shot-badge cycle,
`--solid` / `--solid-ink` = primary button, `--frame-a/b` = empty image plate gradient.

Motion: 140ms colour transitions on controls; drawer 280ms
`cubic-bezier(.22,.9,.3,1)`; `pulsedot` 1.4s on Generating dots; all animation disabled under
`prefers-reduced-motion`.

Keyboard: `Escape` closes menu, drawer, options and filter popovers.
Responsive: settings modal collapses at 1160px, art-style grid at 980px; Columns view keeps a
1080px minimum and scrolls.
