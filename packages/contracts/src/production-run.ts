import { z } from 'zod'

import type { StoryCheckpoint, StoryStage } from './story'
import { STORY_CHECKPOINTS, STORY_STAGES } from './story'

/**
 * The script-to-production pipeline's shapes - roadmap task 5.1, ADR 0003
 * D3/D4/D5.
 *
 * A `script_to_production` run carries an episode's script into Production:
 * it never calls a model of its own (Production's jobs do the drawing), so its
 * stages store which proposals and generations it is waiting on rather than a
 * model's answer. Each stage is a row of `agent_run_stages` (`0038`, widened
 * in `0039`), so a paused run picks up where it stopped:
 *
 *   `production_setup`   the episode's settings (they lock at the first shoot)
 *                        and a reel for every scene without one, as one
 *                        proposal the writer applies.
 *   `production_shots`   a shotlist drafted for every empty reel, landing as
 *                        proposed shots. A checkpoint: the writer accepts the
 *                        shots in Production, then presses Approve.
 *   `production_plates`  only when a scene's location has no photo, which a
 *                        shoot needs. A checkpoint: upload photos, or Approve
 *                        and the images include a plate drawn from each
 *                        location's description.
 *   `production_images`  the cost table, then one **paid** proposal for every
 *                        image still missing - plates, character looks, scene
 *                        images, sheets, frames. Confirmed once.
 *   `production_shoot`   one **paid** proposal shooting every reel that is
 *                        ready, confirmed separately.
 */

export const PRODUCTION_STAGES = ['production_setup', 'production_shots', 'production_plates', 'production_images', 'production_shoot'] as const

export type ProductionStage = (typeof PRODUCTION_STAGES)[number]

/** The production stops that wait on the writer's Approve, as the story's A, C and D do. */
export const PRODUCTION_CHECKPOINTS = ['production_shots', 'production_plates'] as const satisfies readonly ProductionStage[]

export type ProductionCheckpoint = (typeof PRODUCTION_CHECKPOINTS)[number]

/** Every stage `agent_run_stages` holds, for either pipeline - the `story_stage` enum's values. */
export const RUN_STAGES = [...STORY_STAGES, ...PRODUCTION_STAGES] as const

export type RunStageName = StoryStage | ProductionStage

/** Every stage only the run card's Approve moves on. */
export const RUN_CHECKPOINTS = [...STORY_CHECKPOINTS, ...PRODUCTION_CHECKPOINTS] as const

export type RunCheckpoint = StoryCheckpoint | ProductionCheckpoint

export const isRunCheckpoint = (stage: string): stage is RunCheckpoint => (RUN_CHECKPOINTS as readonly string[]).includes(stage)

/** A `script_to_production` run's input (`agent_runs.input`): the episode is the run's own. */
export const ScriptToProductionInputSchema = z.object({
  kind: z.literal('script_to_production'),
  title: z.string().trim().min(1).max(120),
})

export type ScriptToProductionInput = z.infer<typeof ScriptToProductionInputSchema>

export const ProductionStageOutputSchemas = {
  /** The settings-and-reels proposal, or null when there was nothing to propose. */
  production_setup: z.object({ proposalId: z.uuid().nullable() }),
  /** The reels a shotlist was drafted for. */
  production_shots: z.object({ reels: z.array(z.uuid()) }),
  /** The locations with no photo when the run stopped to ask. */
  production_plates: z.object({ locations: z.array(z.object({ id: z.uuid(), name: z.string() })) }),
  /** The images proposal of this round, or null; a round is one proposal and its generations. */
  production_images: z.object({ proposalId: z.uuid().nullable(), round: z.int().min(0) }),
  production_shoot: z.object({ proposalId: z.uuid().nullable(), round: z.int().min(0) }),
} as const
