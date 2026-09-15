import { CLIP_SECONDS } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, orderKeyColumn, projectIdColumn, timestampColumn, updatedAtColumn } from './columns'
import { creditLedger } from './credits'
import { jobs } from './storyboard'
import { projects } from './tenancy'

/**
 * Production: reels, and the render rows that tie a reel to the job that
 * makes its clip. Both AUTHORED.
 *
 * ## `reels` groups the Storyboard's shots; it does not copy them
 *
 * A reel is a run of one scene's shots that renders together as one clip of
 * a fixed length. The shots are `shots` rows - `shots.reel_id` says which
 * reel a shot is in, and null says none yet - so the shot list stays one
 * list in one order, read by both routes, and a reel carries only what no
 * shot could: a name, the clip length, and whether it is finalized.
 *
 * Keyed to `scene_node_id` exactly as `shots` and `scenes` are: the heading
 * node's id, and deliberately **no foreign key to `nodes`**, so a heading
 * that leaves by undo and comes back finds its reels. The assign statement,
 * not a constraint, keeps a reel's shots in the reel's scene - a cross-row
 * rule Postgres cannot check.
 *
 * `clip_seconds` is checked against the closed set in `@folio/contracts`
 * (`CLIP_SECONDS`), for the reason `story_thread_colour` is an enum: the
 * value is the model's, not the writer's, and "12 s" is not a clip a model
 * makes. The shots' durations must fill it exactly before the reel can
 * render; that sum is computed, never stored (`apps/web/lib/production/
 * status.ts`).
 *
 * `finalized_at` is the one flag. Set, the reel's shots refuse edits from
 * either route (the predicate is in `repositories/storyboard.ts`, on every
 * shot write) and the render statement will accept the reel; null, neither.
 * A reel's *status* - writing, ready, generating, blocked, rendered - is
 * never a column: it is folded on read from its shots' frames and its
 * latest render, as a shot's frame is folded from its generation and job.
 *
 * ## `reel_renders` is `frame_generations` for a reel
 *
 * "Every generation row links to its job and, on failure, to its refund
 * ledger entry." Which reel, which job (`kind = 'reel_render'`, payload
 * `{ reelId }`), where the clip is once there is one, and which `refund`
 * entry made the writer whole if the job failed. A reel's *clip* is its
 * latest render read with its job; nothing on `reels` mirrors it.
 *
 * There is still no worker: a render queued here stays `queued`, visibly,
 * as a frame does, until one exists.
 *
 * ## The import cycle with `storyboard.ts` is thunk-safe
 *
 * `shots.reel_id` references `reels` and `reel_renders.job_id` references
 * `jobs`, so the two files import each other. Drizzle takes every foreign
 * key as a thunk (`() => reels.id`) and evaluates the extra-config callback
 * lazily, so neither module touches the other's binding while it is still
 * initialising. `index.ts` exports `storyboard` first; either order works.
 */

export const reels = pgTable(
  'reels',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** The heading node's id. Not a foreign key - see the header. */
    sceneNodeId: uuid('scene_node_id').notNull(),
    orderKey: orderKeyColumn(),
    name: text('name').notNull(),
    /** One of `CLIP_SECONDS`. The clip a video model makes is this long. */
    clipSeconds: integer('clip_seconds').notNull(),
    /** Set when finalized: shots locked, render allowed. */
    finalizedAt: timestampColumn('finalized_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    /** The route's read: every reel of a scene, in order. */
    index('reels_project_scene_order_idx').on(table.projectId, table.sceneNodeId, table.orderKey),
    check('reels_name_not_empty', sql`length(btrim(${table.name})) > 0`),
    check('reels_clip_seconds_allowed', sql`${table.clipSeconds} = any(${sql.raw(`ARRAY[${CLIP_SECONDS.join(', ')}]::integer[]`)})`),
  ],
)

export const reelRenders = pgTable(
  'reel_renders',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    /** `restrict`: a job with a render behind it is history, not clutter. */
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    /** Where the rendered clip is. Null until the job finishes. */
    clipUrl: text('clip_url'),
    /** The `refund` entry when the job failed. Null otherwise. */
    refundEntryId: uuid('refund_entry_id').references(() => creditLedger.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    /** One render per job: a job makes one clip. */
    uniqueIndex('reel_renders_job_key').on(table.jobId),
    /** The clip read: the latest render for a reel. */
    index('reel_renders_reel_created_idx').on(table.reelId, table.createdAt),
    index('reel_renders_project_idx').on(table.projectId),
  ],
)
