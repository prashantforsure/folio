import { z } from 'zod'

import { ClipSecondsSchema } from './enums'
import {
  CharacterIdSchema,
  GenerationIdSchema,
  JobIdSchema,
  LedgerEntryIdSchema,
  LocationIdSchema,
  NodeIdSchema,
  ProjectIdSchema,
  ReelIdSchema,
  ReelRenderIdSchema,
} from './ids'
import { OrderKeySchema, TimestampSchema } from './primitives'
import { FrameStateSchema, ShotRowSchema } from './storyboard'

/**
 * Production: reels, the clip a reel renders to, and the takes a shot keeps.
 * What the route reads and what its actions accept. The UI over this is the
 * redesign's; this file is the shape it will be handed.
 *
 * ## What a reel is
 *
 * A **reel** is a run of one scene's shots that renders together as **one
 * clip of a fixed length** - `clipSeconds`, one of `CLIP_SECONDS`. The shots
 * are the Storyboard's own rows (`shots.reel_id` says which reel, null says
 * none yet); a reel adds nothing a shot could carry itself. Its status is
 * never stored: it is folded, on read, from its shots' frames and its latest
 * render's job, exactly as a shot's frame is folded from its generation and
 * job (AGENTS.md's exception table on `production.state` - "drive it from
 * the job row").
 *
 * `finalizedAt` is the one flag: set, the reel's shots are locked against
 * edits from either route and the reel may render; cleared, they are not.
 *
 * ## Takes
 *
 * Every `frame_generations` row a shot has ever had is a **take**. The shot's
 * `frame` is the take the writer kept (`keptAt`), else the latest. Nothing is
 * thrown away by generating again; the redesign pages through them.
 *
 * ## Two tables, and which class each is in
 *
 *   `reels`         AUTHORED. The writer's grouping and length.
 *   `reel_renders`  AUTHORED. One attempt at a reel's clip - reel to job, and
 *                   on failure to the refund entry, on `frame_generations`'
 *                   pattern.
 *
 * ## Cost is named before it is spent
 *
 * `REEL_RENDER_COST` is what one render reserves. **Placeholder**, exactly
 * as `FRAME_GENERATION_COST` is, and for the same reason: pricing is behind
 * a question (AGENTS.md, When to ask first). One constant so the answer is
 * one edit.
 */

/** Credits reserved for one reel render. Placeholder - see the header. */
export const REEL_RENDER_COST = 40

// ---------------------------------------------------------------------------
// The reel
// ---------------------------------------------------------------------------

/** AUTHORED. The `reels` row. */
export const ReelSchema = z.object({
  id: ReelIdSchema,
  projectId: ProjectIdSchema,
  /** The heading node's id, as `shots.scene_node_id`. Not a foreign key. */
  sceneNodeId: NodeIdSchema,
  orderKey: OrderKeySchema,
  name: z.string().min(1).max(80),
  clipSeconds: ClipSecondsSchema,
  /** Set when finalized: the shots are locked and the reel may render. */
  finalizedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type Reel = z.infer<typeof ReelSchema>

/** What creating or editing a reel takes. Both fields, whole. */
export const ReelEditSchema = z.object({
  name: z.string().trim().min(1).max(80),
  clipSeconds: ClipSecondsSchema,
})

export type ReelEdit = z.infer<typeof ReelEditSchema>

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

/** AUTHORED. One attempt at a reel's clip. */
export const ReelRenderSchema = z.object({
  id: ReelRenderIdSchema,
  projectId: ProjectIdSchema,
  reelId: ReelIdSchema,
  jobId: JobIdSchema,
  /** Where the clip is, once there is one. Null until the job finishes. */
  clipUrl: z.string().nullable(),
  /** The `refund` entry, when the job failed. Null otherwise. */
  refundEntryId: LedgerEntryIdSchema.nullable(),
  createdAt: TimestampSchema,
})

export type ReelRender = z.infer<typeof ReelRenderSchema>

/**
 * A reel's clip, as the route reads it. Folded from the latest render and
 * its job; `none` when there has never been one. The same seven shapes as
 * `FrameState`, named for a clip.
 */
export const ClipStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('queued'), jobId: JobIdSchema, cost: z.int().min(0) }),
  z.object({ kind: z.literal('running'), jobId: JobIdSchema, cost: z.int().min(0) }),
  z.object({ kind: z.literal('rendered'), jobId: JobIdSchema, url: z.string() }),
  z.object({ kind: z.literal('failed'), jobId: JobIdSchema, error: z.string().nullable(), refunded: z.boolean() }),
  z.object({ kind: z.literal('blocked'), jobId: JobIdSchema, reason: z.string() }),
  z.object({ kind: z.literal('cancelled'), jobId: JobIdSchema }),
])

export type ClipState = z.infer<typeof ClipStateSchema>

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

/** One generation of a shot, as a take the writer can page to and keep. */
export const TakeSchema = z.object({
  generationId: GenerationIdSchema,
  frame: FrameStateSchema,
  kept: z.boolean(),
  createdAt: TimestampSchema,
})

export type Take = z.infer<typeof TakeSchema>

/**
 * A shot as Production reads it: the Storyboard's row - numbered over the
 * scene's whole list so both routes print the same `01-03`, its frame the
 * kept-else-latest fold - plus every take, newest first.
 */
export const ProductionShotSchema = ShotRowSchema.extend({
  takes: z.array(TakeSchema),
})

export type ProductionShot = z.infer<typeof ProductionShotSchema>

/**
 * One reel as the route reads it: the row, its ordinal in the scene, its
 * shots in order, its clip. Everything a status is folded from is here;
 * the fold itself is `apps/web/lib/production/status.ts`, pure and tested.
 */
export const ReelRowSchema = ReelSchema.extend({
  number: z.int().min(1),
  shots: z.array(ProductionShotSchema),
  clip: ClipStateSchema,
})

export type ReelRow = z.infer<typeof ReelRowSchema>

/**
 * One present scene of the episode with its reels. `cast` is derivation's
 * (`scene_derivations.cast`) - who is in the scene, from the script, for the
 * reel's read-only cast column. `unreeled` is the scene's accepted-or-
 * proposed shots with no reel: boarded in the Storyboard, not yet placed.
 * A scene with no reels is a scene with an empty list, never omitted.
 */
export const ProductionSceneSchema = z.object({
  sceneNodeId: NodeIdSchema,
  number: z.int().min(1),
  heading: z.string(),
  ie: z.string().nullable(),
  set: z.string(),
  timeOfDay: z.string().nullable(),
  locationId: LocationIdSchema.nullable(),
  cast: z.array(CharacterIdSchema),
  reels: z.array(ReelRowSchema),
  unreeled: z.array(ProductionShotSchema),
})

export type ProductionScene = z.infer<typeof ProductionSceneSchema>
