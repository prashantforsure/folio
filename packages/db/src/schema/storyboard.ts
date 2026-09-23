import { JOB_KINDS, JOB_STATUSES, SHOT_ORIGINS, SHOT_STATES } from '@folio/contracts'
import { CAMERA_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES } from '@folio/script'
import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  idempotencyKeyColumn,
  orderKeyColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'
import { creditLedger } from './credits'
import { projects, users } from './tenancy'

/**
 * The Storyboard: shots, jobs, and the generation rows between them. All
 * three AUTHORED.
 *
 * ## `shots` hangs off a scene the way a synopsis does
 *
 * "Break each scene into shots." A scene is a heading node, so a shot is keyed
 * to `scene_node_id` exactly as `scenes.scene_node_id` is - the heading node's
 * id, and deliberately **no foreign key to `nodes`**: a heading that leaves the
 * script and comes back by undo is the same scene and should find its shots
 * where it left them. The route lists shots only for scenes derivation says are
 * present; a shot whose scene is gone is unreachable, not wrong.
 *
 * Order is a fractional `order_key`, the node list's own mechanism
 * (`columns.ts`), so a drag never renumbers anything. The number the route
 * prints - `01-03` - is the scene's number and the shot's ordinal, computed at
 * read and never stored: AGENTS.md's "nothing is stored that can be computed".
 *
 * `description` is inline content as JSON, the same shape as a node's, so an
 * `@mention` in it is a record id and survives a rename. It is validated by the
 * pure core's own reader at the boundary (`InlineContentSchema`), not here.
 *
 * `origin` and `state` are "proposed, then accepted": a typed shot is born
 * accepted, and the check below refuses the one pair that would say otherwise.
 *
 * `canvas_x` / `canvas_y` are where the Storyboard canvas last left the
 * shot's card (world px, 2026-09-17 ruling). Position is cosmetic: null means
 * "laid out from `order_key`", and the sequence - the linked list the canvas
 * draws, the number it prints, the order a reel renders - is `order_key`
 * alone, so moving a card never reorders anything. Both or neither, by the
 * check.
 *
 * `frame_upload_url` is a frame the writer uploaded rather than drew, a URL
 * the way `frame_generations.frame_url` is one. It wins over a finished,
 * failed or cancelled generation until cleared, and a job in flight still
 * shows through it (`repositories/storyboard.ts`, `foldUpload`). It is a
 * column here and not a generation row because a generation needs a job,
 * and an upload has none.
 *
 * ## `jobs` is the queue's truth, not a mirror of it
 *
 * AGENTS.md wants long-running work to be "a job on the worker: status, cost,
 * cancellable, resumable, survives a closed tab", and its exception table says
 * the Production route's state is "the generation job's status. Drive it from
 * the job row." So the row *is* the status. There is no BullMQ and no Redis in
 * this repository yet (`apps/worker` is empty on purpose, and a dependency
 * needs approval); when they arrive, the queue entry carries this row's id and
 * the worker writes its progress back here. Until then a job written here is
 * `queued` and stays so - honestly, and visibly on the frame.
 *
 * `cost` is the credits reserved when the row was written, and the ledger's
 * `reserve` entry for the same `job_id` carries the same number. That column
 * was declared on the ledger as a forward reference with no foreign key before
 * jobs were a table; it still has none, because adding a constraint to an
 * append-only money table is a ledger change and AGENTS.md puts those behind a
 * question. It resolves by convention, and `frame_generations.job_id` below
 * does have the key.
 *
 * ## `frame_generations` is two foreign keys and an address
 *
 * "Every generation row links to its job and, on failure, to its refund ledger
 * entry." That is the whole table: which shot, which job, where the frame is
 * once there is one, and which `refund` entry made the writer whole if the job
 * failed. A shot's *frame* is its latest generation read with its job; there
 * is no `frame` column on `shots` to drift from it.
 */

export const shotSizeEnum = pgEnum('shot_size', SHOT_SIZES)
export const shotMovementEnum = pgEnum('shot_movement', SHOT_MOVEMENTS)
export const cameraAngleEnum = pgEnum('camera_angle', CAMERA_ANGLES)
export const shotOriginEnum = pgEnum('shot_origin', SHOT_ORIGINS)
export const shotStateEnum = pgEnum('shot_state', SHOT_STATES)
export const jobKindEnum = pgEnum('job_kind', JOB_KINDS)
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES)

export const shots = pgTable(
  'shots',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** The heading node's id. Not a foreign key - see the header. */
    sceneNodeId: uuid('scene_node_id').notNull(),
    orderKey: orderKeyColumn(),
    size: shotSizeEnum('size').notNull(),
    movement: shotMovementEnum('movement').notNull(),
    angle: cameraAngleEnum('angle').notNull(),
    lensMm: integer('lens_mm'),
    durationSeconds: integer('duration_seconds'),
    /** Inline content as JSON - `@mentions` are record ids. */
    description: jsonb('description').notNull().default(sql`'[]'::jsonb`),
    origin: shotOriginEnum('origin').notNull(),
    state: shotStateEnum('state').notNull(),
    /** Where the canvas last left the card. Null = laid out from `order_key`. See the header. */
    canvasX: integer('canvas_x'),
    canvasY: integer('canvas_y'),
    /** A frame the writer uploaded. Wins over a generation until cleared. See the header. */
    frameUploadUrl: text('frame_upload_url'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    /** Null for a person clicking a button; set by a caller that can be retried (ADR 0003 D13). */
    idempotencyKey: idempotencyKeyColumn(),
  },
  (table) => [

    /** A retried create lands once. Partial, so the null every UI create carries is free. */
    uniqueIndex('shots_idempotency_key')
      .on(table.projectId, table.idempotencyKey)
      .where(sql`idempotency_key is not null`),    /** The board's read: every shot of a scene, in order. */
    index('shots_project_scene_order_idx').on(table.projectId, table.sceneNodeId, table.orderKey),
    check(
      'shots_lens_and_duration_sane',
      sql`(${table.lensMm} IS NULL OR ${table.lensMm} > 0) AND (${table.durationSeconds} IS NULL OR ${table.durationSeconds} >= 0)`,
    ),
    /** A typed shot is born accepted. Only a proposal can be waiting. */
    check('shots_typed_is_accepted', sql`${table.origin} <> 'typed' OR ${table.state} = 'accepted'`),
    /** A canvas position is a pair or nothing. */
    check('shots_canvas_position_whole', sql`(${table.canvasX} IS NULL) = (${table.canvasY} IS NULL)`),
  ],
)

export const jobs = pgTable(
  'jobs',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    kind: jobKindEnum('kind').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    /** Credits reserved for this job. The ledger's `reserve` entry says the same number. */
    cost: integer('cost').notNull().default(0),
    /** What the job is to do, by kind. For `frame_generation`: `{ shotId }`. */
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
    startedAt: timestampColumn('started_at'),
    finishedAt: timestampColumn('finished_at'),
    /** Set by the writer; read by a worker between steps. */
    cancelRequestedAt: timestampColumn('cancel_requested_at'),
    /** A failure, for the writer. */
    error: text('error'),
    /** A moderation refusal, in the writer's terms. Non-null exactly when blocked. */
    blockedReason: text('blocked_reason'),
    /**
     * How many times a worker has claimed it (`0036`, roadmap task 4.1). A
     * claim adds one; a job still silent at its third is failed rather than
     * requeued, so a job that kills its worker cannot kill every worker.
     */
    attempts: integer('attempts').notNull().default(0),
    /**
     * When the current claim was taken - also the lease token: a heartbeat
     * or a finish names it, so a worker whose lease lapsed and was taken
     * over cannot settle the job the next worker now holds.
     */
    claimedAt: timestampColumn('claimed_at'),
    /** The claimant's last sign of life. Two minutes without one and the job goes back to the queue. */
    heartbeatAt: timestampColumn('heartbeat_at'),
  },
  (table) => [
    index('jobs_project_status_idx').on(table.projectId, table.status),
    /** The claim's read: the oldest queued jobs, across projects. Partial, so it holds only the queue. */
    index('jobs_queued_idx')
      .on(table.createdAt)
      .where(sql`status = 'queued'`),
    /** The stale sweep's read: running jobs by their last heartbeat. */
    index('jobs_running_heartbeat_idx')
      .on(table.heartbeatAt)
      .where(sql`status = 'running'`),
    check('jobs_cost_not_negative', sql`${table.cost} >= 0`),
    check('jobs_attempts_not_negative', sql`${table.attempts} >= 0`),
    /** "`blocked` means moderation refused a shot, and it must show the refusal reason." */
    check(
      'jobs_blocked_states_reason',
      sql`(${table.status} = 'blocked') = (${table.blockedReason} IS NOT NULL)`,
    ),
    /** A job that is over says when; one that is not, does not. */
    check(
      'jobs_finished_at_matches_status',
      sql`(${table.status} IN ('finished', 'failed', 'blocked', 'cancelled')) = (${table.finishedAt} IS NOT NULL)`,
    ),
  ],
)

export const frameGenerations = pgTable(
  'frame_generations',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id')
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
    /** `restrict`: a job with a generation behind it is history, not clutter. */
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    /** Where the drawn frame is. Null until the job finishes. */
    frameUrl: text('frame_url'),
    /** The `refund` entry when the job failed. Null otherwise. */
    refundEntryId: uuid('refund_entry_id').references(() => creditLedger.id, { onDelete: 'set null' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    /** One generation per job: a job draws one frame. */
    uniqueIndex('frame_generations_job_key').on(table.jobId),
    /** The frame read: the latest generation for a shot. */
    index('frame_generations_shot_created_idx').on(table.shotId, table.createdAt),
    index('frame_generations_project_idx').on(table.projectId),
  ],
)
