import { z } from 'zod'

import { NodeIdSchema, ProjectIdSchema } from './ids'
import { TimestampSchema } from './primitives'

/**
 * Beats. What the Beats route reads and what its actions accept.
 *
 * A beat is an outline `beat` block; `@folio/script`'s `beats.ts` says why
 * and gives it its number and its headline. These shapes are the *authored*
 * half that hangs off the block by node id - the `beats` table in
 * `packages/db` - and the read model the route assembles from that row, the
 * block, and the scene links on `scenes.beats`.
 *
 * Minutes are whole and never negative. The timeline is minutes because the
 * brief says so ("Story structure as time - what happens when, in minutes");
 * nothing here converts to pages, because a page is a measurement and a beat
 * is not measured.
 */

/** A spot on the unplaced canvas, in unscaled pixels from the canvas origin. */
export const CanvasSpotSchema = z.object({
  x: z.int().min(0).max(100_000),
  y: z.int().min(0).max(100_000),
})

export type CanvasSpot = z.infer<typeof CanvasSpotSchema>

/**
 * What the writer sets on a beat. Every field is optional in the row and
 * `null` means unset; `placedAtMinute: null` is *unplaced*, which is a
 * status the brief names and this shape does not store twice.
 */
export const BeatTimingSchema = z.object({
  durationMinutes: z.int().min(0).max(100_000).nullable(),
  placedAtMinute: z.int().min(0).max(100_000).nullable(),
  canvas: CanvasSpotSchema.nullable(),
})

export type BeatTiming = z.infer<typeof BeatTimingSchema>

export const UNSET_BEAT_TIMING: BeatTiming = { durationMinutes: null, placedAtMinute: null, canvas: null }

/** AUTHORED. The `beats` row. */
export const BeatAuthoredSchema = BeatTimingSchema.extend({
  beatNodeId: NodeIdSchema,
  projectId: ProjectIdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export type BeatAuthoredRow = z.infer<typeof BeatAuthoredSchema>

/**
 * One scene a beat names. Read from `scene_derivations` (number, heading)
 * and `measurement_scenes` (the page, `null` when the script is unmeasured -
 * a page lives on the measurement record and nowhere else).
 */
export const BeatSceneSchema = z.object({
  sceneNodeId: NodeIdSchema,
  number: z.int().min(1),
  heading: z.string(),
  page: z.int().min(1).nullable(),
})

export type BeatScene = z.infer<typeof BeatSceneSchema>

/**
 * One beat as the route reads it.
 *
 *   `beatNodeId`  the block's node id
 *   `ordinal`     its number among the outline's beat blocks - computed
 *   `text`        the block's text, rendered; the name and one-line are
 *                 `readBeatHeadline` over it, at render
 *   `timing`      the `beats` row, or `UNSET_BEAT_TIMING` when there is none
 *   `scenes`      the scenes whose `scenes.beats` names this block, in
 *                 script order
 */
export const BeatRowSchema = z.object({
  beatNodeId: NodeIdSchema,
  ordinal: z.int().min(1),
  text: z.string(),
  timing: BeatTimingSchema,
  scenes: z.array(BeatSceneSchema),
})

export type BeatRow = z.infer<typeof BeatRowSchema>
