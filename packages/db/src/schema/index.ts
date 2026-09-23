/**
 * The schema, and the classification of every table in it.
 *
 * Three classes, and which one a table is in decides who may write it. This is
 * the distinction AGENTS.md, Development philosophy 1 turns on - "Before adding
 * a column, ask whether it is a function of the node list. If it is, it is a
 * cache" - and the one worth reviewing hardest.
 *
 * ## AUTHORED - a human or an explicit operation wrote it
 *
 *   users                        the only table with no project_id
 *   projects
 *   memberships
 *   episodes
 *   title_pages                  the cover, one per episode, Fountain's keys as columns
 *   documents
 *   nodes                        the one hand-authored artefact
 *   node_tombstones
 *   comment_threads
 *   thread_comments
 *   versions                     immutable snapshots of authored data
 *   revisions
 *   locked_pages
 *   characters                   name, bio, notes, the profile the Characters route authors,
 *                                since 0017 its status and wants / needs, since 0021 its origin, since 0024
 *                                where the canvas left its card (canvas_x / canvas_y)
 *   character_bound_cues         the alias table's authored half
 *   character_relationships      one row per unordered pair with two directional labels and a line (0024
 *                                reshaped it; the Canvas's connect-drag and the drawer write it)
 *   character_findings           ORPHANED 2026-09-20 - a contradiction the assistant found between two lines
 *                                of the script and the writer's verdict (0022); no route reads or writes it
 *                                since the fourth Characters pass; kept forward-only, like revisions
 *   locations                    name, parent, scheduled days, description, the merge tombstone, and
 *                                since 0018 its scouting status, address and photo key
 *   location_bound_sluglines
 *   props                        a thing the film has to put in front of the camera: name, category (free
 *                                text, never an enum), description, status, photo key, merge tombstone.
 *                                AUTHORED with no derived half at all - nothing in a node list is a prop,
 *                                so what the script says about one is read at request time and never stored
 *   prop_aliases                 the alias table's authored half - `location_bound_sluglines` minus its
 *                                unique-per-project index, because two props may both be "the bag" (0030)
 *   scenes                       synopsis, story time (day, clock, flashback), beat links (opaque), thread links
 *   story_threads                a named, coloured storyline; the scenes it runs through are `scenes.threads`
 *   timeline_findings            the writer's `It's deliberate` on a continuity finding (0023) - the check is
 *                                pure and unstored; a row is the one thing it cannot compute
 *   resolve_decisions            authored input, never derived output
 *   credit_ledger                append-only
 *   shots                        a scene does not say how it is shot - keyed by the heading node's id
 *   jobs                         the job row is the status; written by the system on a click
 *   frame_generations            shot to job, and on failure to the refund entry
 *   art_styles                   the 14 presets (project_id null) and a project's own; Production v12 (0026)
 *   episode_settings             the Production Settings modal, one row per episode, locked by the first shoot
 *   reels                        one clip's worth of a scene - keyed by the heading node's id, like shots
 *   reel_shots                   a reel's timed segments, the spec's vocabulary; the Storyboard's `shots` is its own
 *   shot_description_parts       a shot's description as runs, so an @mention stays a record id
 *   shot_characters              the Character field: auto rows from mentions, or the writer's manual rows
 *   storyboard_sheets            one sheet per reel, with its frames in storyboard_frames
 *   storyboard_frames
 *   clips                        what Start shooting rendered for a reel
 *   assets                       the stored media behind all of the above, by object key
 *   generations                  every Production AI job: reserve, run, settle - the row is the status
 *   notes                        the notes popover's rows; the latest is the field
 *   view_preferences             View options and Filter & sort, per user per episode
 *   activity_log                 one row per Production mutation; no reader yet
 *   share_links                  the in-app invite: a token, a role, revocable (0016)
 *   assistant_chats              one conversation with the assistant about one episode's script (0016)
 *   assistant_messages           its turns, a person's and the model's
 *   research_collections         a named, coloured folder of sources; dropped by the repository when its last source leaves (0019)
 *   research_sources             an article, document, image set, interview or recording brought in from outside the script, with its text
 *   research_clips               a highlighted line of a source
 *   research_clip_filings        clip to character, location or scene - the scene by its heading node's id, no key, as `shots` does
 *   rate_limits                  one fixed-window counter per user, project and bucket (0033, ADR 0003 D14);
 *                                written by the request it is counting, read by nothing else
 *
 * ## DERIVED CACHE - reproducible by re-running `derive` over the node list
 *
 *   character_derivations
 *   character_cue_tallies
 *   location_derivations
 *   location_slugline_tallies
 *   scene_derivations
 *   resolve_rows
 *
 * Drop every one of these and re-derive, and the same rows come back. Nothing
 * may treat one as authoritative over the node list. AGENTS.md, exception
 * table: they exist for "cross-episode queryability" and must be "reproducible
 * by re-derivation".
 *
 * ## MEASUREMENT - produced by `paginate`, never by `derive`
 *
 *   measurements
 *   measurement_pages
 *   measurement_scenes
 *   measurement_nodes
 *
 * The only sanctioned home for a page number or an eighths count. AGENTS.md:
 * "Store on a **measurement record**. Never a node attribute."
 *
 * ## The two rules this list exists to make checkable
 *
 * **No table stores something computable except the three cases AGENTS.md
 * names.** Page numbers and eighths are on measurement rows; the credit balance
 * is a view over the ledger, not a column; the derived entity rows are marked as
 * caches. There is no fourth case in this schema. `versions.node_count` and
 * the four issue counts on `revisions` (`lines_added`, `lines_deleted`,
 * `scenes_touched`, `page_count`) are the ones that need an argument rather
 * than an exemption, and each carries it at its definition: all describe
 * frozen, immutable artefacts, so they cannot drift from what they summarise.
 *
 * **Every table carries `project_id` except `users`.** That exception is
 * enforced rather than documented: `users` has no such column, so it is not
 * assignable to `ProjectScopedTable` in `../scope.ts` and cannot be passed to a
 * scoped query at all.
 *
 * ## What is deliberately absent
 *
 * Lenses, and any table for project
 * settings `transfer` or `keys`. The last of those is AGENTS.md open decision
 * 7 and was left open on purpose. **Props** were on this list beside lenses
 * until the Props pass; `props.ts` is what one now is, and `scenes.prop` and
 * `reel_shots.prop` - free text while there was no table - are `prop_id`
 * foreign keys since `0030`. The rest are out of scope so far. Jobs,
 * generations and storyboard shots were on this list until the Storyboard
 * phase, story threads until the Timeline phase, research sources until the
 * Research v2 pass (2026-09-16); `storyboard.ts`, `timeline.ts` and
 * `research.ts` say what each now is. The Production v1 tables (`reels`,
 * `reel_renders`, migration `0014`) were dropped by `0025` (2026-09-22) for
 * the v12 rebuild. Bible entries were also authored here, migration `0012`
 * to `0015` (`docs/build-decisions.md`, "Bible route removed") - the five
 * tables and their three enums are dropped, not orphaned.
 */

export * from './columns'
export * from './tenancy'
export * from './documents'
export * from './threads'
export * from './history'
export * from './measurement'
export * from './props'
export * from './derived'
export * from './credits'
export * from './storyboard'
export * from './production-enums'
export * from './assets'
export * from './production'
export * from './timeline'
export * from './share'
export * from './assistant'
export * from './research'
export * from './limits'
