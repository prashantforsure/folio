import type { ShotSpec } from '@folio/script'
import { z } from 'zod'

import {
  CameraAngleSchema,
  JobKindSchema,
  JobStatusSchema,
  ShotMovementSchema,
  ShotOriginSchema,
  ShotSizeSchema,
  ShotStateSchema,
} from './enums'
import { assertExact } from './equality'
import type { Equals } from './equality'
import {
  GenerationIdSchema,
  JobIdSchema,
  LedgerEntryIdSchema,
  LocationIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  ReelIdSchema,
  ShotIdSchema,
  UserIdSchema,
} from './ids'
import { InlineContentSchema } from './model'
import { OrderKeySchema, TimestampSchema } from './primitives'

/**
 * The Storyboard: shots, the jobs that draw their frames, and the
 * generation rows that tie the two together. What the route reads and what
 * its actions accept.
 *
 * ## Three tables, and which class each is in
 *
 *   `shots`              AUTHORED. A scene does not say how it is shot; a
 *                        shot is the writer's (or, until accepted, the
 *                        proposer's) and nothing can re-derive it.
 *   `jobs`               AUTHORED - by the system, on the writer's click.
 *                        The row *is* the job's status; there is no queue
 *                        state anywhere else (AGENTS.md's exception table:
 *                        "`production.state` - the generation job's status.
 *                        Drive it from the job row").
 *   `frame_generations`  AUTHORED. One attempt at a frame. "Every generation
 *                        row links to its job and, on failure, to its refund
 *                        ledger entry" - two foreign keys and nothing else.
 *
 * A shot's *frame* is not a column. It is the generation the writer kept,
 * or failing that the latest one, read with its job, and `FrameState` below
 * is that read folded into the seven states the route draws. Every other
 * generation is a *take* the Production route can page through
 * (`production.ts`).
 *
 * ## Cost is named before it is spent
 *
 * `FRAME_GENERATION_COST` is what one frame reserves, in credits, and the
 * button says it before the click. **The number is a placeholder.** AGENTS.md,
 * When to ask first puts pricing behind a question, and this phase asked
 * none; it is one constant so that the answer is one edit, and the E2E walk
 * asserts the button prints whatever it is rather than a literal.
 */

/** Credits reserved for one frame. Placeholder - see the header. */
export const FRAME_GENERATION_COST = 4

/** The most an uploaded frame may weigh. The location photo's bound, for the same reason. */
export const FRAME_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

// ---------------------------------------------------------------------------
// The shot
// ---------------------------------------------------------------------------

/**
 * What a shot says. The pure core's `ShotSpec`, re-expressed as a schema and
 * proven identical to it. Bounds are the boundary's: a lens from 8mm to
 * 1200mm, a duration up to an hour - anything outside is a typo, not a
 * choice.
 */
const shotSpecShape = {
  size: ShotSizeSchema,
  movement: ShotMovementSchema,
  angle: CameraAngleSchema,
  lensMm: z.int().min(8).max(1_200).nullable(),
  durationSeconds: z.int().min(0).max(3_600).nullable(),
  description: InlineContentSchema,
}

export const ShotSpecSchema = z.object(shotSpecShape).readonly()

assertExact<Equals<z.infer<typeof ShotSpecSchema>, ShotSpec>>()

/** AUTHORED. The `shots` row. */
export const ShotSchema = z.object({
  ...shotSpecShape,
  id: ShotIdSchema,
  projectId: ProjectIdSchema,
  /** The heading node's id, as `scenes.scene_node_id`. Not a foreign key. */
  sceneNodeId: NodeIdSchema,
  orderKey: OrderKeySchema,
  /**
   * The reel this shot renders in, or null: a shot boarded in the Storyboard
   * and not yet put in a reel. A reel is a Production-phase grouping over the
   * same rows (`production.ts`); the shot list stays one list, in one order.
   */
  reelId: ReelIdSchema.nullable(),
  origin: ShotOriginSchema,
  state: ShotStateSchema,
  /**
   * Where the Storyboard canvas last left the card, in world px, or null:
   * laid out from `order_key`. Cosmetic - the sequence is `order_key` alone
   * (`schema/storyboard.ts`). Both or neither.
   */
  canvasX: z.int().nullable(),
  canvasY: z.int().nullable(),
  /** A frame the writer uploaded, or null. Wins over a generation until cleared. */
  frameUploadUrl: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Shot = z.infer<typeof ShotSchema>

/**
 * Where a card is put on the canvas. World px, whole, and bounded so a
 * runaway drag cannot write a coordinate nothing can pan to.
 */
export const CanvasPositionSchema = z.object({
  x: z.int().min(-100_000).max(100_000),
  y: z.int().min(-100_000).max(100_000),
})

export type CanvasPosition = z.infer<typeof CanvasPositionSchema>

// ---------------------------------------------------------------------------
// Jobs and generations
// ---------------------------------------------------------------------------

/**
 * AUTHORED. The `jobs` row - "status, cost, cancellable, resumable, survives
 * a closed tab" (AGENTS.md, Jobs, credits and cost).
 *
 * `cost` is what was reserved when the row was written, so the button's
 * number and the ledger's number are the same number. `blockedReason` is
 * the refusal "in the writer's terms" and is non-null exactly when the
 * status is `blocked`; `error` is for the writer too, but is a failure and
 * not a refusal. `cancelRequestedAt` is how a running job is asked to stop -
 * a worker checks it between steps - and a queued one is cancelled outright.
 */
export const JobSchema = z.object({
  id: JobIdSchema,
  projectId: ProjectIdSchema,
  kind: JobKindSchema,
  status: JobStatusSchema,
  /** Credits reserved. Never negative; zero is a free job. */
  cost: z.int().min(0),
  createdBy: UserIdSchema.nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
  cancelRequestedAt: TimestampSchema.nullable(),
  error: z.string().nullable(),
  blockedReason: z.string().nullable(),
})

export type Job = z.infer<typeof JobSchema>

/** AUTHORED. One attempt at a shot's frame. */
export const FrameGenerationSchema = z.object({
  id: GenerationIdSchema,
  projectId: ProjectIdSchema,
  shotId: ShotIdSchema,
  jobId: JobIdSchema,
  /** Where the frame is, once there is one. Null until the job finishes. */
  frameUrl: z.string().nullable(),
  /** The `refund` entry, when the job failed. Null otherwise. */
  refundEntryId: LedgerEntryIdSchema.nullable(),
  /**
   * When the writer kept this take. At most one per shot (a partial unique
   * index says so); the shot's frame is the kept generation when there is
   * one, else the latest. Null on every other row.
   */
  keptAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
})

export type FrameGeneration = z.infer<typeof FrameGenerationSchema>

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/**
 * A shot's frame, as the route draws it. Folded from the latest generation
 * and its job; `empty` when there has never been one.
 *
 * The bundle draws two - drawn and empty. The other five are the job's
 * statuses, which "all get built" (AGENTS.md exception table on
 * `production.state`): a queued frame is not an empty one, and a blocked
 * one must show its reason.
 *
 * `uploaded` is the eighth (2026-09-17): a frame the writer put there
 * rather than drew, so it names no job. The fold prefers it over every
 * settled generation and lets a job in flight show through
 * (`repositories/storyboard.ts`, `foldUpload`).
 */
export const FrameStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('uploaded'), url: z.string() }),
  z.object({ kind: z.literal('queued'), jobId: JobIdSchema, cost: z.int().min(0) }),
  z.object({ kind: z.literal('running'), jobId: JobIdSchema, cost: z.int().min(0) }),
  z.object({ kind: z.literal('drawn'), jobId: JobIdSchema, url: z.string() }),
  z.object({ kind: z.literal('failed'), jobId: JobIdSchema, error: z.string().nullable(), refunded: z.boolean() }),
  z.object({ kind: z.literal('blocked'), jobId: JobIdSchema, reason: z.string() }),
  z.object({ kind: z.literal('cancelled'), jobId: JobIdSchema }),
])

export type FrameState = z.infer<typeof FrameStateSchema>

/**
 * One shot as the route reads it: the row, its number, its frame.
 *
 *   `number`  `shotLabel(scene number, ordinal)` - computed at read from
 *             `scene_derivations.number` and the shot's place among the
 *             scene's accepted-or-proposed shots in `order_key` order.
 *             Never stored.
 *   `frame`   see `FrameState`.
 */
export const ShotRowSchema = ShotSchema.extend({
  number: z.string(),
  frame: FrameStateSchema,
})

export type ShotRow = z.infer<typeof ShotRowSchema>

/**
 * One scene column of the board. Read from `scene_derivations` (number,
 * heading, the reading's I/E, set and time of day, the resolved location)
 * with the scene's shots under it. A scene with no shots is a column with
 * an empty list - the "No shots yet" state - and is never omitted.
 */
export const StoryboardSceneSchema = z.object({
  sceneNodeId: NodeIdSchema,
  number: z.int().min(1),
  heading: z.string(),
  ie: z.string().nullable(),
  set: z.string(),
  timeOfDay: z.string().nullable(),
  locationId: LocationIdSchema.nullable(),
  shots: z.array(ShotRowSchema),
})

export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>

/**
 * One scene's board coverage, as the writing sidebar's `Boards` group and
 * its `Boards drawn` widget read it (`docs/ui design/Route - Storyboard
 * v2.dc.html`). A count over the same rows `StoryboardScene` lists, read
 * in one statement so the three other writing routes can seed the sidebar
 * without the whole board:
 *
 *   `shots`     accepted shots. A proposal is not a shot until it is taken.
 *   `proposed`  proposals waiting on a decision.
 *   `drawn`     accepted shots whose frame - the kept generation, else the
 *               latest - finished with a picture (`FrameState.kind ===
 *               'drawn'`).
 */
export const BoardCoverageRowSchema = z.object({
  sceneNodeId: NodeIdSchema,
  number: z.int().min(1),
  heading: z.string(),
  /** The reading's `INT` / `EXT` and set, for the mono slug under `Scene NN`; empty when the heading did not read. */
  ie: z.string().nullable(),
  set: z.string(),
  shots: z.int().min(0),
  proposed: z.int().min(0),
  drawn: z.int().min(0),
})

export type BoardCoverageRow = z.infer<typeof BoardCoverageRowSchema>

/**
 * What a shot edit sends. Every field of the spec, whole - a shot is small
 * and "which of six fields did you mean" is a protocol nobody needs. The
 * description arrives as inline content: the client resolves `@Name` to a
 * mention through the label book it was given, and an unresolved one stays
 * text.
 */
export const ShotEditSchema = ShotSpecSchema

export type ShotEdit = z.infer<typeof ShotEditSchema>
