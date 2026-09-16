# Build decisions

One section per phase, newest first. Restarted 2026-09-16 with the v2 redesign: the phases
before it - every route's first build, the cuts, the editor rebuild - are in git history
(`git show 7a541bd:docs/build-decisions.md`). They describe chrome that no longer exists and are
not the reference for a rebuilt route; `docs/ui design/README.md` and the `Route - * v2.dc.html`
mockups are.

## Open, and blocking

The live list. AGENTS.md's open-decisions table is the contract; this is what each one refuses
at in the code today.

- **Assistant cost (open decision 13).** `assistant_messages` has no cost column, the send button
  names no price, and nothing writes the ledger. "Cost is named before it is spent" is unmet
  because there is no number to name.
- **Open decision 8, A4.** `resolveSheet('asian')` refuses; the Script route's banner says so.
- **Open decision 10, `SCENE_xxx`.** Unchanged. The sidebar's scene rows are `#n-<node id>`
  fragments, which name a node, never a scene record; `?selected=` stays unwired.
- **Open decision 11, past green; 12, locked pages.** Unchanged, both refused at the engine.
- **Membership roles are stored and enforced nowhere.** A share link issues `writer | reader`
  and `addMembership` writes it; nothing reads it back. Deciding that a `reader` cannot share,
  comment or write is a capability model nobody has specified.
- **`ASSISTANT_MODEL` is `claude-opus-5`**, the API reference's default, written once in
  `lib/assistant/model.ts`. A cheaper model is a product call about the answers, not a setting.
- **Reordering episodes** is ADR 0002's open product claim and is not built; `ordinal` moves
  are the machinery, the ruling is missing.

---

## Redesign phase 2 - the Outline route (2026-09-16)

The second route rebuilt to the v2 package: `docs/ui design/Route - Outline v2.dc.html` on the
shell phase 1 built. The Outline mockup is the Script mockup's shell with a different body,
sidebar group, toolbar and menu rows; where the two mockups disagree on chrome the Script's wins
(AGENTS.md, Feature workflow), and that decided two things below.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The toolbar's title reads `Outline · Draft 2`; the outline has no draft number, only `versions` rows | **`Draft N`, N = manual snapshots + 1.** A `⌘S` snapshot ends a draft; the title menu lists the snapshots under a `Drafts` eyebrow. Empty: `Untitled outline` |
| The `⋯` button is titled `Export outline`; nothing exported an outline | **Snapshot now, Export as Markdown, Undo**, then the statistics. Markdown is built client-side from the block list (`lib/outline/markdown.ts`, pure, tested); no server work |
| The assistant subhead and chips are outline-specific; the ruling is a chat over the script | **Script only for now.** The panel shows the outline copy on `/outline`; what the model reads is unchanged. Widening the context to the outline is AGENTS.md's "ask first" and is not taken |
| The sidebar's `In this outline` list must be live ("Headings appear here as you write them") but the sidebar is the layout's | **A published cell** (`lib/outline/toc.ts`): the workspace publishes headings + the lit row on every change, the sidebar group reads it, the server seeds the first paint through a `cache()`d document read the page shares |
| Comment threads: the Outline mockup draws no card, the data has `outline_block` anchors and the old panel that read them is gone | **Inline, as the Script.** The same cards and composer, opened from the `+` handle with the `outline_block` anchor; the outline's existing threads stay readable |

### Where the mockups disagree

- The Outline mockup's sidebar row for Outline reads `prose` / `empty`; the Script mockup's
  reads `3 acts`. **`N acts` / `—` stays** - the Script wins on chrome, and it is the format
  convention (`lib/workspace/format.ts`).
- The Outline mockup's sidebar header and breadcrumb name the project (`Not Magic, Just This`);
  the Script's name the episode. **The shell's, unchanged.**
- The mockup's footnote reads "Beats written here sync to the Beats route; the script is never
  rewritten from this page." The Beats route was cut 2026-09-12. **"Beats written here stay in
  the outline; the script is never rewritten from this page."** - the half that is still true.
- The mockup's slash menu shows five rows (Text, Heading, Quote, Numbered list, Divider). The
  block set is closed at seven and every one must stay reachable: **`Heading 2` and `Heading 3`
  sit beside `Heading`**, under the mockup's one `Add` eyebrow. The older story names (act,
  sequence, scene, research note) stay as keywords, so `/act` still finds the heading.
- The mockup's `@` hint ("Mention a character or location to keep it linked") was the Script's;
  the outline had no `@` combobox. **It has one now** - the Script's `mention-suggestion.ts` and
  combobox, reused, with `createMention` behind the two `New …` rows.

### What was built

**Shell changes** - `_chrome/sidebar-group.tsx` (client) picks the second group by segment:
`In this outline` on `/outline`, `Scenes` elsewhere; `sidebar.tsx` reads both lists and hands
them down (`loadOutlineToc`, whose document read is `cache()`d with the page's `loadOutline` in
`lib/outline/server.ts` - no second query on the Outline route, one extra read on the other
three). `assistant-panel.tsx` takes the route from the shell (`workspaceRouteFromSegments`) for
the Outline's subhead and chips. The `+` / `⠿` handle widget moved out of the Script's
`sheet-decorations.ts` into `_script/editor/extensions/handles.ts`, built by both editors.
`ThreadCards` / `ThreadComposer` take the `hosts` slice and an anchor kind rather than the Script
store; `openThreadOnNode` takes the kind (`ThreadNodeKind` in `lib/script/panel.ts`).

**Body** - `_outline/outline-workspace.tsx` rewritten without the paper: no 816px sheet, no
ruler, no zoom, no right panel, no status bar. The toolbar row is `outline-toolbar.tsx` (title
menu with the drafts; `⋯` with snapshot, Markdown export, undo, statistics). The column is the
Script's (`.folio-script-column`, 818px, 58px gutter); the prose is Geist 17px at 1.85 in
`--script`, blocks 26px apart, the title block at 32px over the mono date, headings 20px, a
quote's accent hairline, a rule's `--line2` line, beats numbered in mono with a 600 lead, 10px
apart. The empty state is the same column with `data-empty-state`: `Untitled outline` in
`--ink3`, the caret line "Start typing, or type '/' to add a block" (the editor's own ghost), two
key hints. The first keystroke turns the title into the episode's; the first save creates the
document, as before.

**Editor** - `decorations.ts` keeps five sets now: beats, handles, caret (`data-caret` + the
ghost), labels, thread hosts; it also reads the heading list after every change and publishes it
through the store (`headings` slice) only when one moved. The slash menu and the new
`outline-handle-menu.tsx` draw the v2 rows (mono glyph, name, `↵` on the lit row). A drag-move
keeps its id (`clipboard.ts` reads `view.dragging.move`, as the Script's). `static-outline.tsx`
draws the ghost on a trailing empty block so the first paint matches the editor's.

**Removed** - `outline-panel.tsx`, `outline-status-bar.tsx`, `_script/comments/legacy-thread-card.tsx`
(its only reader was the panel), `_script/view-tab.tsx` (no reader left). `BLOCK_LABEL` in
`lib/outline/keyboard.ts` stays: the tests hold the table.

**Tokens** - `--text-32` (the title block), in `packages/ui/src/tokens/theme.css`.

### Judgement calls, flagged

- **H2 at 18px and H3 at 17px.** The mockup draws only the H1 (20px); the two under it are a
  step each, the smallest still above the 17px body, weight 500 in `--ink`. An inference.
- **The title block has no handles.** The mockup draws `+` / `⠿` beside `Not Magic, Just This`;
  the title is the episode's title, not an outline block, and a handle on it would insert below
  nothing. Every real block has them.
- **`In this outline` counts the title row.** The mockup's `tocCount` is 4 for a title and three
  headings. The list draws the copy ("Headings appear here as you write them") whenever there is
  no heading, so a lone title row is never listed.
- **Clicking a TOC row puts the caret at the heading's start and scrolls to it**; the title row
  scrolls to the top. The mockup gives the rows no behaviour.
- **The statistics in `⋯` are Words, Blocks, Acts, Beats (the outline's) and Scenes, Characters,
  Locations (the script's)**, the old panel's list minus shots and relations, which were zeros.
- **The Markdown export writes the title as `#`, H1 as `##`** and so on, so the file has one
  document title; beats are a numbered list with the lead in bold.
- **The sidebar reads the outline on every writing route** (document + blocks, in parallel with
  its other reads) because a layout cannot see the route. Two statements on Script / Scenes /
  Storyboard renders; none extra on Outline. Deciding by URL server-side would need middleware.

### Not built, by ruling or by absence

- The assistant reading the outline (needs a ruling). Presence avatars, the Read button.
- Bold / Italic marks: still no inline run for them (a node-schema change).
- A drop cursor for the drag (a dependency; flagged with the Script's).

### Verification

- `pnpm exec turbo run typecheck lint --force` - 12 of 12 (6 packages, both tasks).
- `pnpm --filter web build` - clean, secret scan clean (275 files).
- `vitest run --environment node tests/` in `apps/web` - 326 pass; the 7 that fail are the same
  three jsdom files as phase 1 (`project-card`, `workspace.test.tsx`, the `sessionStorage`
  assertion) on local Node 22.5.1. New: `tests/outline-toc-markdown.test.ts` (6);
  `outline-pm-model.test.ts`'s slash expectations moved to the v2 rows.
- `e2e/outline-route.spec.ts` rewritten to the v2 contract (`data-toc-*`, `data-word-count`,
  `data-document-menu`, `data-caret`, the `⋯` statistics) and **unrun** - no `E2E_EMAIL` /
  `E2E_PASSWORD` here. A browser check of both states in both themes, the handles' drag, the
  TOC's lit row and the Markdown download is the next thing a human should do.

---

## Redesign phase 1, second pass - episodes: switch, name, rename (2026-09-16)

The client, on the first pass: "there is no option to switch between the episode in the script
route, and while creating a new episode no one asks for the name of it". Both true.

### What was wrong

- **The switcher was built and invisible.** The header's `Episode 1 ▾` breadcrumb was the
  episode menu since the redesign - but its container copied the mockup's `overflow:hidden`
  (there to ellipsise a long project title), and the menu, absolutely positioned inside it,
  was clipped to nothing on open. Found by clicking it in a browser, not by reading the code.
  The container no longer hides overflow; the project title truncates on its own.
- **`+` created `Episode N` on the click** and redirected. Nothing asked for a name and nothing
  could change one afterwards - renaming was filed under project settings, a stub (open
  decision 7). The sidebar then read `Ep 1 · Episode 1`.

### Rulings taken

| Question | Ruling |
| --- | --- |
| Where an episode is named and renamed, with `/settings` a stub | **In the writing chrome, both doors.** The sidebar's title row: the name is a button titled `Rename episode` - the Production mockup's own idiom (`title="Rename reel"` on the reel's name) - and `+` is `New episode`; either opens one form in flow under the row. The header's episode menu gains `Rename Episode N…` and `New episode…` at its foot, opening the same form in the menu's box. Open decision 7 is untouched: nothing here is settings |
| A popover under `+` | **In flow, not a popover.** The sidebar card clips its overflow (the 16px radius needs it) - the same clipping that hid the header menu. The title row is `flex-wrap`; the form wraps onto its second line |
| An empty name on create | **The default, not a refusal.** The placeholder says `Episode N`; Enter on an empty field is "just add one". Rename refuses an empty name |
| The sidebar's title | **`Episode 1 · Standpipe`**, as the mockup reads, and plain `Episode 1` while the title is the default - `episodeLabel` in `lib/workspace/format.ts`. The header's button stays `Episode N` (the mockup) |
| Deleting an episode - AGENTS.md's "delete or purge user data" question | **Asked; ruled: hard delete, confirmed.** `Delete Episode N…` at the menu's foot, drawn only while there is more than one; a confirm naming what goes and that it cannot be undone; the action refuses the last episode and a film; the walk lands on the neighbour (before, else after). `deleteEpisode` in `@folio/db` sweeps the four node-keyed tables with no foreign key onto the episode - `shots`, `reels`, `comment_threads`, `scenes` - by the episode's node ids in the same transaction, then lets `ON DELETE CASCADE` take the rest. `jobs` and the ledger stay: paid is paid |
| Reorder | **Not built** - "Open, and blocking" above |

### What was built

`packages/db`: `renameEpisode(scope, id, title)`, `deleteEpisode(scope, id)`.
`apps/web/lib/workspace/actions.ts`: `createEpisode(projectId, title | null)`,
`renameEpisode(projectId, slug, title)` and `deleteEpisode(projectId, slug)` on the
shared gate (`lib/script/gate.ts`), `TitleSchema` for the name, no `redirect()` - they return
the episode and its script URL (`lib/workspace/result.ts`) so a refusal draws under the field
and the form navigates. `_chrome/episode-form.tsx` is the one form; `_chrome/episode-title-row.tsx`
the sidebar's row (replacing `new-episode-button.tsx`); `_chrome/episode-delete-confirm.tsx`
the confirm; `writing-header.tsx`'s menu holds the list, a check on the current episode, and
the three foot items. `e2e/workspace.spec.ts`'s `+` step now names the episode, switches
through the menu, renames from it, and deletes the second episode back out.

### Verification

Walked in a browser against the running dev server with a throwaway account
(`e2e-redesign@example.com`, created through the Supabase admin API like the earlier `e2e-*`
accounts): the menu opens and lists every episode, `+` → name → Enter lands on `ep_00N/script`,
the sidebar title renames in place, the menu's rename form does the same, and the toolbar's
title follows; `Delete Episode 4…` → confirm removed the row and landed on `ep_003`. `tests/workspace-routes.test.ts` covers the label. `pnpm typecheck` is red only
in `_outline/`, another session's in-progress pass, not this change.

---

## Redesign phase 1 - the shell and the Script route (2026-09-16)

The client ruled the old UI bad and delivered a full design package: `docs/ui design/README.md`
plus nine `Route - * v2.dc.html` mockups. Routes are rebuilt to it one at a time; Script first,
new features built end to end.

### Rulings taken this phase

| Question | Ruling |
| --- | --- |
| The mockup sets the script in Geist 17px, proportional; the engine paginates in Courier at 6 lpi and the screen matched it line for line | **Geist, as designed.** Page breaks become `Page N` dividers placed from the measurement record; the engine's counts, eighths and export stand; the screen no longer wraps where the engine wraps |
| The orb opens a 400px assistant panel; no agent backend existed | **Real, read-only, persisted.** `@anthropic-ai/sdk` approved and pinned; `ANTHROPIC_API_KEY` optional; chats per episode; no writes to the script; no credits charged |
| Block handles `+` / `⠿` (ruled "No" 2026-09-13) | **Follow the design.** `+` inserts below or opens a thread; `⠿` reorders through ProseMirror's own drag |
| The sidebar credits card (AGENTS.md: "cut, do not build") | **Follow the design.** Built from the ledger balance |
| Storyboard in the sidebar (AGENTS.md: "Storyboard sits above Scenes") | **Follow the design.** Sidebar is Script · Outline · Scenes; Storyboard is the header pill's other half |
| The `Share` button | **Share links end to end** - `share_links`, the popover, `/share/:token` |
| The `Read` (read-through) button | **Left out** |
| Presence avatars | **Not built** - needs the realtime that is cut |
| `docs/build-decisions.md`, deleted in the working tree | **Kept deleted; restarted** with this phase. Links in `CLAUDE.md` / `AGENTS.md` fixed |
| The rail's Characters icon opens an overlay in every writing mockup | **Overlay on the writing routes**, with the full route linked inside; the rail navigates elsewhere |
| Comment threads: inline (the mockup) or a panel | **Both kinds inline.** Comment nodes are cards; threads are cards under their block with reply and resolve; creation from the `+` handle; the Collaboration panel goes |

### Where the mockups disagree with the README

- The Script mockup's rail order is Writing · Characters · Locations · Research · Timeline ·
  Production; the README and the other eight mockups say Timeline before Research. **The README
  and the eight win.**
- The README says every route has a 28px status bar; none of the five writing mockups draws one.
  **Writing routes have none.** Their `104 pp · saved` moved into the toolbar row.
- The README lists `Help` at the foot of the rail. Help has nowhere to go and the account menu
  (settings, sign out) needs a home, so **the avatar takes the slot.** A button that cannot do
  what it says is a placeholder.
- The mockup's slash menu shows five blocks (Text, Scene, Dialogue, Parenthetical, Transition).
  The type set is closed at eight and `script-slash.test.ts` holds the menu to it; **all eight
  are listed** in the mockup's chrome, `Action` keeping its name.

### What was built

**Tokens and type** - `packages/ui/src/tokens/palette.css` is the README's `:root` block
verbatim, three-block shape kept; the older token names (`--desk`, `--panel`, `--sel`, `--add`,
`--note`, `--sheet`...) alias onto the new ones so the six unrebuilt routes render on the new
palette without a line changed. `theme.css` republishes the new names (`bg-s1`, `text-ink2`,
`rounded-panel`...) and moves the old radius scale to the new geometry. Geist and Geist Mono are
self-hosted subsets fetched from Google's `css2` endpoint the way the earlier files were
(`apps/web/app/fonts.css`); Inter is gone; Courier Prime stays, pinned, as the measured face.

**Icons** - `packages/ui/src/icons.tsx`: inline stroke SVGs transcribed from the mockups. The
Unicode glyph set (`glyphs.ts`) stays for the unrebuilt routes, minus `◎`.

**Routes** - Insights removed: page, schema, rail item, tests. Nine routes.
`lib/workspace/routes.ts` gains `SIDEBAR`, `WRITING_MODES`, the README widths and breakpoints.

**Shell** - `_chrome/project-shell.tsx` (client) draws the ambient glows, the rail, the assistant
panel and the Characters overlay, and owns `html[data-nav-open]` and the breakpoints ("solve it
at the shell"). `_chrome/writing-layout.tsx` draws the sidebar (a server card: rows, clickable
scene list, credits), the header (breadcrumb with an episode menu, the Write / Storyboard pill,
Share, the orb) and the main-surface card. `⌘J` toggles the assistant anywhere. (The episode
menu shipped clipped and `+` shipped nameless - the second pass above.)

**Script body** - `_script/script-workspace.tsx` rewritten without the paper: no 816px column,
no page frames, no per-line margins, no zoom, no status bar, no right panel. The toolbar's title
menu switches script / title page and lists revisions; the `⋯` menu holds import, export, undo,
pagination, format and the statistics. `lib/script/pages.ts` replaces `layout.ts`:
`pageBreaksOf(record)` is the whole arithmetic. The decorations plugin now keeps six sets: page
dividers, block handles, caret (`data-caret` + ghost), pills, labels, thread hosts. Threads are
widget hosts React portals cards into (`_script/comments/thread-cards.tsx`), with
`stopEvent` / `ignoreSelection` keeping the editor out of a textarea in its own DOM. A drag-move
keeps its id (`clipboard.ts` reads `view.dragging.move`). Every block renders `id="n-<uuid>"` so
the sidebar's `#n-…` rows land on it.

**Assistant** - `packages/db/src/schema/assistant.ts`, repositories, `lib/assistant/`:
`context.ts` renders the script as prose with `[Scene N]` markers and mention labels (not
Fountain - a model cannot say "Meera" from `@{character:<uuid>}`), `server.ts` gates through
`openEpisodeWith`, appends the turn, streams from `claude-opus-5` with the system block cached,
and appends the answer when the stream ends - partial answers included, so a closed tab never
leaves a question without one. `app/api/assistant/route.ts` is the streaming door: `text/plain`
chunks, nothing to parse.

**Share links** - `share_links` (`0016`), `lib/share/`, the popover (copy, role, revoke; one live
link per project, issuing revokes), `app/share/[token]/page.tsx` outside `(app)` so the token
survives a sign-in round trip; revoked and unknown tokens get a page, not a 404.

**Migration `0016`** - `share_links`, `assistant_chats`, `assistant_messages`, two enums, RLS on
the `0014` pattern. Additive only.

### Judgement calls, flagged

- **Drag-and-drop has no drop cursor.** `prosemirror-dropcursor` is a dependency; the handle is
  usable without it and the writer sees the caret. Ask before adding.
- **The static first paint places a mid-block page divider at the block's start**; the editor
  moves it to the engine's offset on mount. One divider can shift a few lines on hydration.
- **Dialogue, cues and parentheticals are centred**, as the mockup draws them
  (`text-align: center` inside `padding: 0 90px`). Unusual for a screenplay; it is the design.
- **The assistant's context is capped at 400k characters**, cut at a scene boundary, and the
  system prompt says so. A longer script is a rare feature-and-a-half.
- **The assistant panel's `+` attach and dictate buttons are drawn disabled** with their titles
  saying so; the composer's "@ to add context" placeholder is the mockup's and is not parsed.
- **The Characters overlay's `New character` links to the route**; the modal there is component
  state with no param to open it (adding one needs a human).
- **`replyThread` and `resolveThread` no longer `revalidatePath`**; they return the thread and
  the Script replaces the card. The Outline's legacy card (`_script/comments/legacy-thread-card.tsx`)
  calls `router.refresh()` instead, until its pass.
- **`whenLabel` renders `14:02` / `3 Sep` in the server's locale and zone** at request time, as
  the earlier card did.
- **The credits caption reads `≈ N frames · no expiry`**, N at `FRAME_GENERATION_COST`; the
  mockup's "full-draft passes" is an agent cost that does not exist.
- **The `+` / `⠿` handle widget exists on every block** (3,000 tiny nodes on a feature), hidden
  until hover or caret. A hover-tracked single widget would be cheaper and was not needed.

### Not built, by ruling or by absence

- Presence avatars; the `Read` button; `Help` in the rail.
- Assistant writes, proposals, tools, credits; chat deletion has an action and no button.
- A drop cursor; a rename of the Unicode glyph set's remaining consumers.
- The other six route bodies, Research, Production's body, `/settings` - each its own pass.

### Verification

- `pnpm typecheck` - 6 of 6. `pnpm lint` - clean. `pnpm --filter web build` - clean, secret scan
  clean, `/share/[token]` and `/api/assistant` present, no `/insights`.
- `vitest run --environment node tests/` - 318 pass; the 8 that fail are the three jsdom files
  (`project-card`, `workspace.test.tsx`, the `sessionStorage` assertion) on local Node 22.5.1
  (`ERR_REQUIRE_ESM`, `apps/web/CLAUDE.md` trap 1).
- `pnpm --filter @folio/db db:check` - journal clean with `0016`.
- The E2E walks (`workspace.spec.ts`, `script-route.spec.ts`, `theme.spec.ts`, `glyphs.spec.ts`)
  are rewritten to the new contract and **unrun** - no `E2E_EMAIL` / `E2E_PASSWORD` on this
  machine. A browser check of the Script route, the handles' drag, the thread portals and the
  assistant stream is the next thing a human should do.
