# Folio agent copilot: integration plan

**Status:** plan of record, 2026-09-23. Decisions live in `docs/adr/0003-agent-copilot.md`; the task list lives in `docs/agents/roadmap.md`.

**Phase numbering:** this plan uses Phases 1 to 5, matching `docs/agents/roadmap.md`. An earlier chat draft numbered them 0 to 4; plan Phase 0 became roadmap Phase 1, and so on.

**Rulings applied (AGENTS.md, 2026-09-23):**
- R1: writes to script, outline and records are proposals, rendered as hunks or before/after values. Actions with no diffable form (uploads, generations, canvas moves) go through explicit confirmation.
- R2: settings, people, billing and keys stay off-limits to the agent. Export is allowed, as read-only downloads for the requesting user.
- R3: Research is read-only to the agent. The catalogue below has no research write tools.
- R4: reports never call a model. The agent may call report tools and phrase their results, but the numbers always come from code.
- R5: no realtime. Agent script edits apply in the writer's open editor or through compare-and-swap.
- R6: the worker is built in Phase 4 on the Postgres `jobs` table, with no Redis and no BullMQ.
- R7: dependencies still need approval. ADR 0003 pre-approves only `pdf-lib` and `@pdf-lib/fontkit`.
- R8: the assistant stays read-only until Phase 3, then writes through proposals.

## Why Folio is in good shape for this

- **The script is already structured.** It is stored as ordered `nodes` rows with inline JSON, and mentions point to record ids. An agent can edit individual scenes and elements precisely.
- **Server actions are consistent.** Every one checks project access and returns a typed result instead of throwing, which is exactly the shape a tool needs.
- **Validation is shared.** Zod contracts in `@folio/contracts` double as tool input schemas.
- **A persistent shell exists.** `app/(app)/layout.tsx` wraps every signed-in route, so a panel mounted there survives navigation.
- **A working assistant exists.** `/api/assistant` streams from Claude with prompt caching. It has no tools yet.

The work is five things: a tool layer, a proposal system, the worker, moving client-only logic to the server, and closing the permission and safety gaps before the agent magnifies them.

## Three design choices that follow from the readiness report

**1. Tools call the existing server actions directly.** Every action takes plain arguments, checks identity and membership itself, validates with Zod, and returns a typed result. An agent loop inside `/api/assistant` has the user's cookies, so it can call `createCharacter(projectId, input)` exactly as the UI does. Actions are split into "cookie wrapper + core function" only when the Phase 4 worker must act without a browser request. A few actions need small adapters: the ones that take `FormData` or call `redirect()`, mainly uploads and `createProject`.

**2. Script edits are applied inside the writer's own editor.** `saveScript` replaces the whole node list, and the last save wins, so an agent saving in the background would erase the writer's typing. Instead:

- The agent proposes node-level operations.
- The writer's open editor applies them to the Tiptap document.
- The normal autosave persists the result.

There is only ever one writer to the node list. When no editor is open (background runs), the server applies the operations using `packages/script` and a compare-and-swap check on `saveScript`.

**3. Existing attribution hooks are used.** `nodes.provenance_source = 'agent'` (which requires a `provenance_run_id`), `characters.origin = 'agent'`, and `versions.reason = 'before_agent_run'` all exist and nothing writes them yet. Every agent change is traceable to a run, and every run can be undone in one step.

## Architecture

### The agent loop

`ask()` in `lib/assistant/server.ts` becomes a loop:

1. Send the conversation and tools to Claude.
2. Execute any tool the model calls.
3. Append the result and repeat, until the model stops calling tools or the run hits its caps (12 steps and 60 seconds for interactive turns).
4. Enforce a spending budget for the run throughout.

Supporting changes:

- **Typed event stream.** The response switches from `text/plain` to newline-delimited JSON events: `text`, `tool_started`, `tool_finished`, `proposal`, `confirm_required`, `navigate`, `refresh`, `download`, `error`, `done`.
- **Stored tool calls.** A `content jsonb` column on `assistant_messages` stores tool calls and results, which the API needs replayed on the next turn.
- **Rewritten system prompt.** The "cannot change the script" lines go once writes ship (Phase 3). The craft rules in `docs/agents/craft.md` and a tool-use policy are added.
- **Results passed through unchanged.** Each action's result (`refused`, `insufficient`, `busy` and so on) goes straight back as the tool result; the refusal messages are already human-readable.
- **Prompt caching** covers the system block and the tool definitions. The full episode script stays in context for episode-scope chats.

### The tool registry

`lib/agent/tools/` holds the registry. Each tool declares a name and description, an input schema (Zod from `@folio/contracts`, converted with Zod 4's `z.toJSONSchema()`), a minimum role, a mode, and the function it wraps.

Each turn loads a small core toolset, the toolset for the user's current route, and a `load_toolset(name)` tool for tasks that cross routes. The API's tool call id is the idempotency key for create actions, so a retried call cannot duplicate a record.

### Proposals, runs and undo

Three tables:

- **`agent_runs`**: one row per agent task; its id is the `provenance_run_id`. Records chat and message, actor, status, token usage, credit budget and spend.
- **`agent_proposals`**: a reviewable group of changes, with the base it was planned against (document id and node digest), a status (pending, applied, rejected, stale, failed, partially applied), and who decided.
- **`agent_proposal_ops`**: the ordered tool calls with arguments, idempotency key, result and undo payload.

Applying a proposal:

1. Snapshot `before_agent_run` versions for the affected documents.
2. Run the operations in order through the same server actions.
3. Store undo payloads as they come back (`renameCharacter`'s restore payload is required by `undoRename`).
4. Re-derive once at the end instead of once per operation.
5. Write `activity_log` rows and emit a `refresh` event.

"Undo this run" restores the snapshots and replays the inverse operations. For documents changed since the run, it creates a new proposal instead of overwriting.

In the panel, each proposal renders as a card: script and outline changes as diff hunks using `diffScreenplays`, record changes as before and after values. Each user has an autonomy setting: **review each change** (default) or **apply automatically**. Destructive and paid operations always ask, in either mode.

### The side panel

1. **App-wide mount.** `AssistantPanel` moves into `app/(app)/layout.tsx`, reusing the 400px width, the `⌘J` shortcut and the breakpoint rule from `project-shell.tsx`.
2. **Hidden, not unmounted.** Closing the panel keeps the conversation. Chat id and draft live in the Zustand session store.
3. **Launcher outside a project.** The panel can list and open projects and start "new project from a story", which creates the project after confirmation and continues the chat inside it. No chat is stored outside a project.
4. **Context with each message:** route, project, episode, focus, and the editor selection as node ids.
5. **Navigation through the existing helpers.** The `navigate` tool returns a route and parameters; the panel builds the URL with `hrefs.ts` or `enterEpisodeRoute` and calls `router.push`. URLs are never concatenated by hand.
6. **Refresh after writes** with `router.refresh()`, covering the actions that never call `revalidatePath`.

### The worker and background runs

`apps/worker` becomes a long-running Node process that drains the existing `jobs` table:

- **Claiming:** `SELECT … FOR UPDATE SKIP LOCKED`, woken by `LISTEN/NOTIFY` over the session pooler. No Redis, no queue library.
- **Job kinds:** `agent_run` and the Production generation jobs are added.
- **Identity:** the worker acts as the user who started the run and re-checks membership and role before every step.
- **Generations:** `runGeneration` moves off `after()`; `requestFrame` is wired to `queueFrameGeneration`; `listOrphanedReservations` runs periodically as a cleanup job; an R2 sweeper handles objects whose row never landed.
- **Progress:** background runs are polled every 2 seconds while live.

### Moving client-only logic to the server

| Logic | Server version |
|---|---|
| Continuity check | Promote the path at `lib/assistant/server.ts:188-236` |
| Page counts | Run `paginate.ts` on the server, or read the stored measurement when its `node_digest` matches |
| Exports | Server actions wrapping `outlineMarkdown`, `chronologyMarkdown`, `csvOf`, `breakdownCsvOf`, plus Fountain export through `serialiseFountain` |
| Facts cells | Move their predicates into `lib/*/server.ts` read functions |
| Project list filters | Move `filterCounts`, `matchesFilter`, `sortCards` to the server |

## Tool catalogue

Modes: **read** runs immediately; **propose** creates a reviewable proposal; **confirm** always asks first; **paid** shows the credit cost and checks the run's budget; **direct** means the output already lands as proposed rows or it only cancels something; **client** is handled by the panel.

**Core (always loaded)**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `get_project_overview` | New: episodes, cast, sets, page totals | reader | read |
| `list_scenes` | New: `scene_derivations`, `measurement_scenes`, `scenes.synopsis` | reader | read |
| `read_scene` | `readSceneLines` | reader | read |
| `search_project` | New: node content plus entity names | reader | read |
| `navigate` | Client event through `hrefs.ts` | reader | client |
| `load_toolset` | Registry | reader | read |
| `get_run_status` | `agent_runs`, `generations` | reader | read |

**Launcher (outside a project)**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `list_projects` | `listProjectsFor` plus the moved filters | user | read |
| `open_project` | Client navigation | user | client |
| `start_story_project` | Adapter over `createProject`'s logic, without the redirect | user | confirm |

**Script and outline**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `propose_script_edit` | New operation format validated by `packages/script` | writer | propose |
| `propose_outline_edit` | Same format, over `saveOutline` | writer | propose |
| `set_synopsis` | `saveSynopsis` | writer | propose |
| `save_title_page` | `saveTitlePage` | writer | propose |
| `comment_on_node`, `reply_thread`, `resolve_thread` | The thread actions | reader | propose |
| `get_page_count` | New server-side pagination | reader | read |
| `export_script` | `exportScriptFdx`, Fountain export, PDF (Phase 5) | reader | read |
| `export_outline` | Wrapper over `outlineMarkdown` | reader | read |
| `set_format`, `set_pagination` | `setFormat`, `setPagination` | writer | confirm |

**Characters, locations, props**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `create_character`, `create_location`, `create_prop` | The create actions, with idempotency keys | writer | propose |
| `update_character`, `update_location`, `update_prop` | `saveProfile`, `saveLocation`, `saveProp` | writer | propose |
| `preview_rename` | Both `previewRename` actions | reader | read |
| `rename_entity` | The rename actions, undo payload stored | writer | confirm |
| `merge_entities`, `delete_entity` | The merge and delete actions | writer | confirm |
| `set_location_parent` | `setParent` | writer | propose |
| `resolve_queue_item` | `resolveCue`, `resolveSlugline`, `resolveStructure` | writer | propose |
| `save_relationship`, `delete_relationship` | The relationship actions | writer | propose |
| `export_entities_csv` | Wrappers over the CSV functions | reader | read |

**Timeline**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `run_continuity_check` | The promoted assistant path | reader | read |
| `set_story_time` | `saveStoryTime` | writer | propose |
| `place_scenes` | `placeScenes` (undone with `unplaceScenes`) | writer | propose |
| `manage_threads` | `createThread`, `saveThread`, `orderThreads`, `setSceneThreads`; `deleteThread` in confirm mode | writer | propose |
| `mark_finding_deliberate` | `markDeliberate`, `reopenFinding` | writer | propose |
| `export_chronology` | Wrapper over `chronologyMarkdown` | reader | read |

**Research (read-only, ruling R3)**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `read_research` | The Research route's loader: collections, sources, clips, filings | reader | read |

**Storyboard**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `propose_storyboard_shots` | `proposeShotsForScene` (lands as proposed rows) | writer | direct |
| `edit_storyboard_shot` | `addShot`, `saveShot` | writer | propose |
| `accept_or_discard_shots` | `acceptShots`, `discardShots` | writer | propose |
| `reorder_storyboard_shot` | `placeShot` | writer | propose |

**Production**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `save_episode_settings` | `saveSettings` | writer | propose |
| `manage_reels` | `addReel`, `patchReel`; `deleteReel` in confirm mode | writer | propose |
| `manage_shots` | `addShot`, `patchShot`, `bulkPatchShots`, `moveShot`, `retimeShot`, `deleteShot` | writer | propose |
| `ai_shotlist` | `aiShotlist` (0 credits, lands as proposed) | writer | direct |
| `generate_images` | `generateSheet` (40), `generateSceneImage` (40), `generateFrames` (4 each) | writer | paid |
| `shoot_reel` | `shootReel` (375) | writer | paid |
| `cancel_generation` | `cancelGeneration` | writer | direct |

**Episodes, runs and pipelines**

| Tool | Wraps | Role | Mode |
|---|---|---|---|
| `create_episode`, `rename_episode` | The episode actions | writer | propose |
| `undo_run` | Run-level undo | writer | confirm |
| `start_background_task` | Enqueues an `agent_run` job (Phase 4) | writer | direct |
| `story_to_script` | The story pipeline (Phase 4) | writer | confirm |
| `script_to_production` | The production pipeline (Phase 5) | writer | confirm |
| `generate_character_look` | `character_look` generation (Phase 5) | writer | paid |

**Not exposed to the agent:** sign-in and account settings, passwords, sign-out, account deletion, share links, `deleteEpisode`, `importScript`, purge, duplicate, view preferences, canvas positions, and every Research write.

## The "story in, everything out" pipeline

A worker job with checkpoints where the writer approves before the next stage:

1. **Intake.** Expand the story into genre, tone, format, target length, the protagonist's want and need, stakes, setting and stated assumptions. Checkpoint.
2. **Setup.** Create or reuse the project; add the title page and logline.
3. **Characters and locations first**, with `origin = 'agent'`. Cues and headings only resolve through exact alias matches, so drafts must use the bound spellings and mention runs pointing to the new record ids.
4. **Outline.** Acts as `h1`, beats as `beat` blocks. Checkpoint.
5. **Scene list and synopses.** Checkpoint.
6. **Draft scene by scene** with agent provenance, a critic pass against the craft rubric, and one re-derive at the end of the stage.
7. **Timeline.** Story days, threads, continuity check.
8. **Production.** Episode settings, reels per scene, `ai_shotlist`, accepting shots, then a total cost estimate from `GENERATION_COSTS` before any paid step. `shoot_reel` always needs explicit confirmation.

Each stage produces its own proposals and saves progress, so a failed run resumes where it stopped.

## Build order

**Phase 1: foundations.** Security fixes from report §3.4; role enforcement; idempotency keys; `COLLATE "C"` on order keys; the 0030 check; batched re-derive; compare-and-swap on saves; rate limits; Fountain export, removing `REDIS_URL`, and batching comment reads.

**Phase 2: agent loop, app-wide panel, read tools.** The panel in the root layout, kept mounted, with the launcher; the agent loop with the event stream and stored tool calls; server-side reads for the client-only logic; the read tools and `navigate`; editor selection in context.

**Phase 3: proposals and write tools.** Run, proposal and operation tables; the apply executor and run-level undo; proposal cards with diff hunks; editor-side apply for script and outline operations; the write tools; the autonomy setting and the rewritten system prompt.

**Phase 4: worker, background runs, story-to-script.** The worker runtime; actor gates and core functions; generations moved off `after()`; background agent runs; the story-to-script pipeline.

**Phase 5: production automation, exports, quality.** The script-to-production pipeline with cost confirmation; character look generation; PDF export; run history; the eval harness; end-to-end hardening.
