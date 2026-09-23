'use server'

import { after } from 'next/server'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode } from '../script/gate'
import {
  aiShotlistWith,
  cancelGenerationWith,
  connected,
  framesProblem,
  generateFramesWith,
  generateSceneImageWith,
  generateSheetWith,
  generationIdProblem,
  reelProblem,
  sceneProblem,
  shootReelWith,
} from './generate-core'
import type { CancelResult, GenerationResult, ShootResult } from './result'

/**
 * The generate actions - `docs/production/production.md` §7's endpoints
 * that cost credits: `POST /reels/:id/storyboard-sheet` (40),
 * `POST /scenes/:id/scene-image` (40), the bulk bar's frames (4 each),
 * `POST /reels/:id/ai-shotlist` (0), `POST /reels/:id/shoot` (375; a 422
 * with the failing readiness flags when the reel is not ready), and
 * cancel. Each: gate, the checks the button drew disabled on (the model
 * connected, storage for an image, readiness for a shoot), the spec
 * assembled, the row created with its credits held in one statement, and
 * the run handed to `after()` so the answer returns before the model does.
 *
 * "Cost is named before it is spent": the number on the button is
 * `GENERATION_COSTS[job]`, and the same number is what `createGeneration`
 * reserves. "Reserve then execute": the balance is checked in the insert's
 * `WHERE`, never inside the run.
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * Each body is a core function in `generate-core.ts` that takes an episode
 * gate - the agent's `ai_shotlist` and `cancel_generation` call those with a
 * gate of their own. Each action runs what it always ran before the gate
 * (the parse, the connection check), opens the cookie gate, and hands the core
 * Next's `after` to run the generation once its row exists.
 *
 * ## The rate limit, and the one action exempt from it
 *
 * The five actions that *start* work take `checkRateLimit(scope, actor,
 * 'generate')` after the gate - 30 an hour per user per project, ADR 0003
 * **D14**. **`cancelGeneration` does not**, and that is deliberate rather than
 * an oversight: it starts nothing, and refusing it is refusing somebody the
 * stop button on work that is already running and already holding credits. A
 * caller can only reach a cancel refusal by having made thirty generations in
 * the hour, which is exactly the person who most needs to stop one.
 */

const runAfter = (task: () => Promise<void>): void => {
  after(task)
}

/** `POST /reels/:id/storyboard-sheet` - generate or redraw, 40 cr. Disabled with no shots (§3.4). */
export const generateSheet = async (projectId: string, episode: string, rawReelId: unknown): Promise<GenerationResult> => {
  const problem = reelProblem(rawReelId) ?? connected('storyboard_sheet')
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return generateSheetWith(gate, rawReelId, runAfter)
}

/** `POST /scenes/:id/scene-image` (generate) - 40 cr. */
export const generateSceneImage = async (projectId: string, episode: string, rawSceneNodeId: unknown): Promise<GenerationResult> => {
  const problem = sceneProblem(rawSceneNodeId) ?? connected('scene_image')
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return generateSceneImageWith(gate, rawSceneNodeId, runAfter)
}

/** The bulk bar's `✦ Generate n frames` - 4 cr each, one generation per shot; the first short balance stops the rest. */
export const generateFrames = async (projectId: string, episode: string, raw: unknown): Promise<GenerationResult> => {
  const problem = framesProblem(raw) ?? connected('shot_frame')
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return generateFramesWith(gate, raw, runAfter)
}

/**
 * `POST /reels/:id/ai-shotlist` - the text model proposes shots (free by
 * the client's ruling). Without a model key it falls back to the pure
 * core's rule-based proposer, so the button always does something true.
 */
export const aiShotlist = async (projectId: string, episode: string, rawReelId: unknown): Promise<GenerationResult> => {
  const problem = reelProblem(rawReelId)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return aiShotlistWith(gate, rawReelId, runAfter)
}

/**
 * `POST /reels/:id/shoot` - 375 cr. The spec's 422: `not_ready` with the
 * failing readiness flags, computed here from the rows as stored, never
 * trusted from the button. The first success locks the episode's settings.
 */
export const shootReel = async (projectId: string, episode: string, rawReelId: unknown): Promise<ShootResult> => {
  const problem = reelProblem(rawReelId) ?? connected('shoot_reel')
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return shootReelWith(gate, rawReelId, runAfter)
}

export const cancelGeneration = async (projectId: string, episode: string, rawId: unknown): Promise<CancelResult> => {
  const problem = generationIdProblem(rawId)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return cancelGenerationWith(gate, rawId)
}
