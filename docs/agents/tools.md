# The tool catalogue

**Status:** the catalogue of record, 2026-09-23. Derived from
[`integration-plan.md`](integration-plan.md), *Tool catalogue*, with the build
phase of each tool added.

Each tool declares a name, a description, an input schema (Zod from
`@folio/contracts`, converted with Zod 4's `z.toJSONSchema`), a **minimum role**,
a **mode** and the function it wraps — ADR 0003 **D13**. Each turn loads the core
toolset, the toolset for the user's current route, and `load_toolset`.

## Modes

| Mode | Meaning |
| --- | --- |
| **read** | Runs immediately. |
| **propose** | Creates a proposal the user reviews (ADR 0003 **D1**). |
| **confirm** | Always asks first, in either autonomy setting. |
| **paid** | Shows the cost and checks the run's budget, which starts at 0 (**D3**). |
| **direct** | Its output already lands as proposed rows, or it only cancels something. |
| **client** | Handled by the panel, not the server. |

## Roles

`reader`, `writer` and `owner` are ADR 0003 **D2**; the column gives the
**minimum** role. `user` appears only in the launcher, which runs outside a
project where there is no membership to have a role in — it means any signed-in
user.

## Phases

Phases are [`roadmap.md`](roadmap.md)'s, and follow one rule with four
exceptions.

| | Phase |
| --- | --- |
| Every **read** and **client** tool, including the launcher's `list_projects` and `open_project` | **2** |
| Every **propose**, **confirm** and **direct** tool, including `start_story_project` and `undo_run` | **3** |
| `start_background_task` and `story_to_script` | **4** |
| Every **paid** tool, plus `script_to_production` | **5** |
| PDF output from `export_script` (the tool itself ships in Phase 2) | **5** |

## Reading the *wraps* column

A bare function name is a `'use server'` action under `apps/web/lib/`. Where a
name is ambiguous or the target is not an action, the column says so, because
four names collide across modules and several entries are pure helpers or
repository functions that need a server action written around them first.

Since roadmap task 4.2 a tool calls the action's **core function** -
`<action>With(gate, …)` in the same route's `core.ts` - rather than the action
itself: the same body, run as the turn's (or the worker's) gate instead of a
cookie, checking the same capability. The column still names the action,
because that is what the writer's button calls and what the tool must match.

---

## Core — always loaded

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `get_project_overview` | New: episodes, cast, sets, page totals | reader | read | 2 |
| `list_scenes` | New: `scene_derivations`, `measurement_scenes`, `scenes.synopsis` | reader | read | 2 |
| `read_scene` | `readSceneLines` — **`lib/timeline/actions.ts`**, not script | reader | read | 2 |
| `search_project` | New: node content plus entity names | reader | read | 2 |
| `navigate` | Client event through `lib/workspace/hrefs.ts` | reader | client | 2 |
| `load_toolset` | The registry itself | reader | read | 2 |
| `get_run_status` | `agent_runs`, `generations` | reader | read | 2 |

## Launcher — outside a project

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `list_projects` | `listProjectsFor` (`packages/db/src/repositories/users.ts`) plus the moved filters — `filterCounts`, `matchesFilter`, `sortCards` in `lib/projects/view.ts`, today client-only | user | read | 2 |
| `open_project` | Client navigation | user | client | 2 |
| `start_story_project` | Adapter over `createProject`'s logic, without the `redirect()` | user | confirm | 3 |

No chat is stored outside a project (**D15**). `matchesFilter` also exists in
`lib/storyboard/board.ts` over a different row type; this is the projects one.

## Script and outline

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `propose_script_edit` | New operation format validated by `packages/script` | writer | propose | 3 |
| `propose_outline_edit` | The same format, over `saveOutline` | writer | propose | 3 |
| `set_synopsis` | `saveSynopsis` — **`lib/scenes/actions.ts`** | writer | propose | 3 |
| `save_title_page` | `saveTitlePage` | writer | propose | 3 |
| `comment_on_node` | `openThreadOnNode` (`lib/script/actions.ts`) | reader | propose | 3 |
| `reply_thread` | `replyThread` — a **comment** thread, not a story thread | reader | propose | 3 |
| `resolve_thread` | `resolveThread` | reader | propose | 3 |
| `get_page_count` | New: server-side pagination, or the stored measurement when its `node_digest` matches | reader | read | 2 |
| `export_script` | `exportScriptFdx`; Fountain export over `serialiseFountain` (**a pure function in `packages/script`**, needs an action); PDF in Phase 5 | reader | read | 2 · PDF 5 |
| `export_outline` | Wrapper over `outlineMarkdown` (**`lib/outline/markdown.ts`**, a pure helper) | reader | read | 2 |
| `set_format` | `setFormat` | writer | confirm | 3 |
| `set_pagination` | `setPagination` | writer | confirm | 3 |

## Characters, locations and props

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `create_character` | `createCharacter`, with the `tool_use` id as idempotency key; an optional `voice` note is stored in `characters.notes.voice`, never the bio | writer | propose | 3 |
| `create_location` | `createLocation`, same | writer | propose | 3 |
| `create_prop` | `createProp`, same | writer | propose | 3 |
| `update_character` | `saveProfile` | writer | propose | 3 |
| `update_location` | `saveLocation` | writer | propose | 3 |
| `update_prop` | `saveProp` | writer | propose | 3 |
| `preview_rename` | **Both** `previewRename` actions — `lib/characters/actions.ts` and `lib/locations/actions.ts` | reader | read | 2 |
| `rename_entity` | `renameCharacter`, `renameLocation`, `renameProp`; the undo payload is stored, because `undoRename` requires it | writer | confirm | 3 |
| `merge_entities` | `mergeCharacters`, `mergeLocations`, `mergeProps` | writer | confirm | 3 |
| `delete_entity` | `deleteCharacter`, `deleteLocation`, `deleteProp` | writer | confirm | 3 |
| `set_location_parent` | `setParent` | writer | propose | 3 |
| `resolve_queue_item` | `resolveCue`, `resolveSlugline`, `resolveStructure` | writer | propose | 3 |
| `save_relationship` | `saveRelationship` | writer | propose | 3 |
| `delete_relationship` | `deleteRelationship` | writer | propose | 3 |
| `export_entities_csv` | Wrappers over `csvOf` — **two of them**, `lib/characters/list.ts` and `lib/locations/sheet.ts` — and `breakdownCsvOf` (`lib/locations/sheet.ts`). All pure helpers | reader | read | 2 |

A rename is one of the two sanctioned write-backs into the document (AGENTS.md,
*Derivation is one-way — except*), which is why it is **confirm** and not
**propose**: its blast radius is every cue or heading that is the name.

## Timeline

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `run_continuity_check` | The promoted assistant path — `timelineOf`, **module-private** at `lib/assistant/server.ts:188-236`, over the exported helpers in `lib/timeline/view.ts` | reader | read | 2 |
| `set_story_time` | `saveStoryTime` | writer | propose | 3 |
| `place_scenes` | `placeScenes`, undone with `unplaceScenes` | writer | propose | 3 |
| `manage_threads` | `createThread`, `saveThread`, `orderThreads`, `setSceneThreads` — **story** threads; `deleteThread` in confirm mode | writer | propose · confirm | 3 |
| `mark_finding_deliberate` | `markDeliberate`, `reopenFinding` | writer | propose | 3 |
| `export_chronology` | Wrapper over `chronologyMarkdown` (`lib/timeline/markdown.ts`, a pure helper) | reader | read | 2 |

Timeline never reads a slugline as a date: `packages/script/src/time-cues.ts`
proposes and the writer accepts. `✦ Suggest placements` is not built, and open
decision 13's closure in ADR 0003 **D3** is what unblocks it.

## Research — read-only

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `read_research` | The Research route's loader: collections, sources, clips, filings | reader | read | 2 |

**There are no Research write tools.** `add_source`, `clip_line` and `send_clip`
were in an earlier draft of the catalogue and were taken out by AGENTS.md ruling
**R3**, reaffirmed 2026-09-23 over the integration plan
(`AGENTS.md`, *The agent may write anywhere — except*): a model that can edit the
evidence cannot be used to check itself. The per-source `readable` toggle remains
the one context gate, enforced in the context builder and never in the UI.

## Storyboard

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `propose_storyboard_shots` | `proposeShotsForScene` — lands as proposed rows | writer | direct | 3 |
| `edit_storyboard_shot` | `addShot`, `saveShot` — **`lib/storyboard/actions.ts`** | writer | propose | 3 |
| `accept_or_discard_shots` | `acceptShots`, `discardShots` | writer | propose | 3 |
| `reorder_storyboard_shot` | `placeShot` | writer | propose | 3 |

`addShot` exists in both `lib/storyboard/actions.ts` and
`lib/production/actions.ts`; `saveShot` exists **only** in storyboard, and
Production's equivalent is `patchShot`. `reel_shots` is Production's shot table
and `shots` is the Storyboard's — the two toolsets never cross.

## Production

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `save_episode_settings` | `saveSettings` | writer | propose | 3 |
| `manage_reels` | `addReel`, `patchReel`; `deleteReel` in confirm mode | writer | propose · confirm | 3 |
| `manage_shots` | `addShot`, `patchShot`, `bulkPatchShots`, `moveShot`, `retimeShot`, `deleteShot` — all **`lib/production/actions.ts`** | writer | propose | 3 |
| `ai_shotlist` | `aiShotlist` (`lib/production/generate.ts`) — 0 credits, lands as proposed | writer | direct | 3 |
| `generate_images` | `generateSheet` (40), `generateSceneImage` (40), `generateFrames` (4 each), and a location plate (40, provisional) drawn from a location's description (`generateLocationPlateWith`, added by task 5.1 at the client's ruling). One call names every image and is one confirmation. Built, task 5.1 | writer | paid | 5 |
| `shoot_reel` | `shootReel` (375 a reel); one call names every reel, one confirmation. Built, task 5.1 | writer | paid | 5 |
| `cancel_generation` | `cancelGeneration` | writer | direct | 3 |

Costs are `GENERATION_COSTS` in `packages/contracts/src/production.ts` and are
quoted from the registry at click, held on submit, settled on success, refunded
or released otherwise. A **paid** tool (task 5.1) prices its call when it is
made; the proposal carries the price; confirming it grants the run exactly
that budget (ADR 0003 **D3**, `grantRunBudget`), and each image or shoot spends
from the grant before it starts (`spendRunBudget`) and gives back what never
started. The writer sees tiers — `Draft · Standard · Cinema` —
never a model name. `moveShot` exists in both `lib/production/actions.ts` and
`lib/storyboard/actions.ts`; this is the Production one.

## Episodes, runs and pipelines

| Tool | Wraps | Role | Mode | Phase |
| --- | --- | --- | --- | --- |
| `create_episode` | `createEpisode` (`lib/workspace/actions.ts`) | writer | propose | 3 |
| `rename_episode` | `renameEpisode` | writer | propose | 3 |
| `undo_run` | Run-level undo: restore the `before_agent_run` snapshots, replay the inverse operations | writer | confirm | 3 |
| `start_background_task` | `startBackgroundRun` (`@folio/db`): the run, its chat, its brief and an `agent_run` job, in one transaction; two live per project (D14). Built, task 4.4 | writer | direct | **4** |
| `story_to_script` | The story pipeline (`lib/agent/story/pipeline.ts`): a background run, stages A-F, checkpoints, chained scene batches. Built, task 4.5 | writer | confirm | **4** |
| `script_to_production` | The production pipeline (`lib/agent/production/pipeline.ts`): a background run - settings and reels, shotlists, a checkpoint to accept shots, plates, then the cost table and a paid proposal for the images and another for the shoots. Built, task 5.1 | writer | confirm | **5** |
| `generate_character_look` | The `character_look` generation (40) | writer | paid | 5 |

`deleteEpisode` is **not** here — deleting an episode is owner-only under ADR
0003 **D2** and is not exposed at all under **D16**. Creating and renaming one is
a writer's.

---

## Not exposed

ADR 0003 **D16**. The agent is given no tool for any of these, at any phase:

- sign-in and account settings
- passwords
- sign-out
- account deletion
- share links
- `deleteEpisode`
- `importScript`
- purge
- duplicate
- view preferences
- canvas positions
- every Research write

**Export is allowed** — read-only, and only for the requesting user. It produces
a file they could have clicked for themselves and writes nothing (AGENTS.md
ruling **R2**, 2026-09-23).

A tool that is not in this document does not exist. Adding one is a change to
this file and to the registry in the same pull request, and widening what the
agent may read or write is on AGENTS.md's *When to ask first* list.
