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
 *   characters                   name, bio, notes, and the profile the Characters route authors
 *   character_bound_cues         the alias table's authored half
 *   character_relationships
 *   character_arc_turns          one turn of an arc, pointing at a heading node or at nothing
 *   locations                    name, parent, scheduled days, description, the merge tombstone
 *   location_bound_sluglines
 *   location_arc_notes           one note per location per episode - "how this place changes"
 *   scenes                       synopsis, story time, beat and thread links (both opaque)
 *   resolve_decisions            authored input, never derived output
 *   credit_ledger                append-only
 *   shots                        a scene does not say how it is shot - keyed by the heading node's id
 *   jobs                         the job row is the status; written by the system on a click
 *   frame_generations            shot to job, and on failure to the refund entry
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
 * Bible entries, research sources, props, lenses, story threads, and any table
 * for project settings `transfer` or `keys`. The last of those is AGENTS.md
 * open decision 7 and was left open on purpose. The rest are out of scope so
 * far. Jobs, generations and storyboard shots were on this list until the
 * Storyboard phase; `storyboard.ts` says what each now is.
 */

export * from './columns'
export * from './tenancy'
export * from './documents'
export * from './threads'
export * from './history'
export * from './measurement'
export * from './derived'
export * from './credits'
export * from './storyboard'
