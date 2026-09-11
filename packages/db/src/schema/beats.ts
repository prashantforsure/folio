import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, projectIdColumn, updatedAtColumn } from './columns'
import { projects } from './tenancy'

/**
 * What a writer hangs on a beat. AUTHORED.
 *
 * A beat is an outline `beat` block - `@folio/script`'s `beats.ts` says why,
 * and `@folio/contracts`' `EpisodeNavMeta` already counts the nav's Beats row
 * from those blocks. The block carries the beat's number (its ordinal, never
 * stored) and its name and one-line (its text). This table carries what the
 * outline cannot say and the Beats route can: how long the beat runs, where
 * it sits on the episode timeline, and where its card was left on the
 * unplaced canvas.
 *
 * `beat_node_id` is the primary key and it is the **beat block's node id**,
 * not a minted one - the same shape as `scenes.scene_node_id`, for the same
 * reasons: a node id survives splits, merges, type changes and reorders, so
 * moving a beat up the outline does not detach its timing, and it spends no
 * entropy. And, as with `scenes`, there is deliberately **no foreign key to
 * `nodes`**: a block deleted from the outline and brought back by undo is the
 * same beat and should find its duration where it left it. The Beats route
 * lists a row only while its block exists; a row whose block is gone is
 * unreachable, not wrong, and is kept for the day the block comes back.
 *
 * ## Placed or unplaced is one nullable column
 *
 * The brief: "A placed beat has a minute position on the episode timeline; an
 * unplaced one sits on a canvas until you drop it." `placed_at_minute` is that
 * position, and `NULL` is *unplaced* - the status is not a second column that
 * could disagree with the position. The canvas spot is kept while a beat is
 * placed, so dragging it back off the track returns it to where it was.
 *
 * ## Where the scene links are
 *
 * Not here. "A beat names the scenes that deliver it" (the brief), and the
 * link is authored data on the *scene* side already: `scenes.beats` was
 * declared with "beat links" as its purpose and is carried through every
 * re-derive. The Beats route writes beat node ids into that array and reads
 * them back inverted. One home for the fact, and it is the one that was
 * already reserved for it.
 *
 * Nothing here is computable from the node list, so nothing here is a cache.
 */
export const beats = pgTable(
  'beats',
  {
    /** The beat block's node id. Not a foreign key - see the note above. */
    beatNodeId: uuid('beat_node_id').primaryKey(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** Whole minutes. Null until the writer gives the beat a length. */
    durationMinutes: integer('duration_minutes'),
    /** Start minute on the episode timeline. Null is *unplaced*. */
    placedAtMinute: integer('placed_at_minute'),
    /** The card's spot on the unplaced canvas, in unscaled pixels. Null until dragged. */
    canvasX: integer('canvas_x'),
    canvasY: integer('canvas_y'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('beats_project_idx').on(table.projectId),
    check(
      'beats_minutes_not_negative',
      sql`(${table.durationMinutes} IS NULL OR ${table.durationMinutes} >= 0) AND (${table.placedAtMinute} IS NULL OR ${table.placedAtMinute} >= 0)`,
    ),
    /** A canvas spot is a pair or nothing. */
    check('beats_canvas_spot_is_a_pair', sql`(${table.canvasX} IS NULL) = (${table.canvasY} IS NULL)`),
  ],
)
