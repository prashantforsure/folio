import type { ArtStyle, EpisodeSettings, GenerationTarget, ProductionScene, Reel } from '@folio/contracts'
import { GENERATION_COSTS, NodeIdSchema, ProductionGenerationIdSchema, ReelIdSchema, ReelShotIdSchema } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  cancelGeneration as cancelGenerationRow,
  createGeneration,
  readDocumentByKind,
  readLiveGenerationFor,
  readProductionEpisode,
  readScreenplayNodes,
} from '@folio/db'
import { modelEnv } from '@folio/db/env'
import type { InlineContent } from '@folio/script'
import { z } from 'zod'

import { checkRateLimit } from '../agent/rate-limit'
import { ROLE } from '../auth/roles'
import type { EpisodeGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { cutScene } from '../storyboard/scene-cut'
import { proposeShotsWith } from './core'
import { readinessOf } from './derive'
import { connected } from './pipeline/connection'
import { frameSpec, sceneImageSpec, sheetSpec, shootSpec, shotlistSpec } from './pipeline/spec'
import type { GenerationSpec } from './pipeline/spec'
import type { CancelResult, Failure, GenerationResult, ShootResult } from './result'
import { composeScenes, readCastAndPlaces } from './compose'

/**
 * The generate actions as **core functions** - roadmap task 4.2.
 *
 * `generate.ts`'s header is the account of each (the cost named before it is
 * spent, reserve then execute, the rate limit and the one action exempt from
 * it). Each core here takes an episode gate already opened and the raw input,
 * checks the role (`ROLE.paidGeneration`) and the D14 limit itself, and does
 * the rest: the model and storage checks, the spec, the row with its credits
 * held. The actions open the cookie gate and call these; the agent's
 * `ai_shotlist` and `cancel_generation` call them with a gate of their own.
 *
 * The generation runs on the worker (roadmap task 4.3): `createGeneration`
 * queues its `production_generation` job in the same statement that reserves
 * the credits, and `lib/worker/production-generation.ts` runs it.
 */

const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'
const NOT_A_SCENE = 'That scene is not in this episode. Reload the page.'

const error = (message: string): Failure => ({ status: 'error', message })

/** A node's content as prose for the text model: a mention reads as the character's name. */
const proseOf = (content: InlineContent, names: ReadonlyMap<string, string>): string =>
  content.map((run) => (run.kind === 'text' ? run.text : (names.get(run.target.id as string) ?? ''))).join('')

type Ground = {
  readonly gate: EpisodeGate
  readonly scenes: readonly ProductionScene[]
  readonly settings: EpisodeSettings
  readonly artStyle: ArtStyle
  readonly names: readonly { readonly id: ProductionScene['cast'][number]['id']; readonly name: string }[]
}

/** Everything a generation is assembled from, read once. Settings default to the mockup's when none are saved. */
const ground = async (gate: EpisodeGate): Promise<Ground | Failure> => {
  const [record, { cast, locations, names }] = await Promise.all([readProductionEpisode(gate.scope, gate.episode.id), readCastAndPlaces(gate.scope)])
  const scenes = composeScenes(record, cast, locations)
  const preset = record.artStyles.find((style) => style.key === 'netflix-prestige-drama') ?? record.artStyles[0]
  if (preset === undefined) return error('The art-style presets are missing.')
  const settings: EpisodeSettings = record.settings ?? {
    episodeId: gate.episode.id,
    aspectRatio: '16:9 landscape',
    productionType: 'Narrative',
    cameraStyle: 'Academy',
    pacing: 'Balanced',
    lighting: 'Motivated',
    artStyleId: preset.id,
    lockedAt: null,
  }
  const artStyle = record.artStyles.find((style) => style.id === settings.artStyleId) ?? preset
  return { gate, scenes, settings, artStyle, names }
}

const isFailure = (value: Ground | Failure): value is Failure => 'status' in value

const findReel = (scenes: readonly ProductionScene[], reelId: string): { readonly scene: ProductionScene; readonly reel: Reel } | null => {
  for (const scene of scenes) for (const reel of scene.reels) if (reel.id === reelId) return { scene, reel }
  return null
}

/** Create the row (credits held) and its job, in one statement; the worker runs it. */
const launch = async (g: Ground, targetType: GenerationTarget, targetId: string, spec: GenerationSpec): Promise<GenerationResult> => {
  const scope: ProjectScope = g.gate.scope
  const created = await createGeneration(scope, {
    episodeId: g.gate.episode.id,
    targetType,
    targetId,
    job: spec.job,
    cost: GENERATION_COSTS[spec.job],
    prompt: { text: spec.prompt, references: spec.references, aspect: spec.aspect, durationS: spec.durationS },
    settingsSnapshot: spec.settings,
    route: spec.route,
    sourceHash: spec.sourceHash,
  })
  if (created.status === 'insufficient') return created
  return { status: 'queued', generation: created.generation }
}

/** The role and the D14 limit, the first two things every core that starts work checks. */
const mayStart = async (gate: EpisodeGate): Promise<GenerationResult | null> => {
  const refused = roleRefusal(gate, ROLE.paidGeneration)
  if (refused !== null) return refused
  return checkRateLimit(gate.scope, gate.actor, 'generate')
}

// ---------------------------------------------------------------------------
// The five jobs
// ---------------------------------------------------------------------------

export const reelProblem = (rawReelId: unknown): Failure | null => (ReelIdSchema.safeParse(rawReelId).success ? null : error(NOT_A_REEL))

export const sceneProblem = (rawSceneNodeId: unknown): Failure | null => (NodeIdSchema.safeParse(rawSceneNodeId).success ? null : error(NOT_A_SCENE))

/** `POST /reels/:id/storyboard-sheet` - generate or redraw, 40 cr. Disabled with no shots (§3.4). */
export const generateSheetWith = async (gate: EpisodeGate, rawReelId: unknown): Promise<GenerationResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const off = connected('storyboard_sheet')
  if (off !== null) return off
  const stop = await mayStart(gate)
  if (stop !== null) return stop
  const g = await ground(gate)
  if (isFailure(g)) return g
  const found = findReel(g.scenes, reelId.data)
  if (found === null) return error(NOT_A_REEL)
  if (found.reel.shots.length === 0) return error('Add shots first - the sheet is drawn from the shotlist.')
  if ((await readLiveGenerationFor(gate.scope, 'reel', found.reel.id)) !== null) return error('This reel is already being drawn.')
  return launch(g, 'reel', found.reel.id, sheetSpec(found.scene, found.reel, g.settings, g.artStyle))
}

/** `POST /scenes/:id/scene-image` (generate) - 40 cr. */
export const generateSceneImageWith = async (gate: EpisodeGate, rawSceneNodeId: unknown): Promise<GenerationResult> => {
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const off = connected('scene_image')
  if (off !== null) return off
  const stop = await mayStart(gate)
  if (stop !== null) return stop
  const g = await ground(gate)
  if (isFailure(g)) return g
  const scene = g.scenes.find((candidate) => candidate.sceneNodeId === sceneNodeId.data)
  if (scene === undefined) return error(NOT_A_SCENE)
  if ((await readLiveGenerationFor(gate.scope, 'scene', scene.sceneNodeId)) !== null) return error('This scene image is already being drawn.')
  return launch(g, 'scene', scene.sceneNodeId, sceneImageSpec(scene, g.settings, g.artStyle))
}

const FrameIdsSchema = z.array(ReelShotIdSchema).min(1).max(50)

export const framesProblem = (raw: unknown): Failure | null => (FrameIdsSchema.safeParse(raw).success ? null : error('Pick at least one shot.'))

/** The bulk bar's `✦ Generate n frames` - 4 cr each, one generation per shot; the first short balance stops the rest. */
export const generateFramesWith = async (gate: EpisodeGate, raw: unknown): Promise<GenerationResult> => {
  const ids = FrameIdsSchema.safeParse(raw)
  if (!ids.success) return error('Pick at least one shot.')
  const off = connected('shot_frame')
  if (off !== null) return off
  const stop = await mayStart(gate)
  if (stop !== null) return stop
  const g = await ground(gate)
  if (isFailure(g)) return g
  let last: GenerationResult | null = null
  for (const shotId of ids.data) {
    const found = g.scenes.flatMap((scene) => scene.reels.map((reel) => ({ scene, reel }))).find(({ reel }) => reel.shots.some((shot) => shot.id === shotId))
    if (found === undefined) continue
    const shot = found.reel.shots.find((candidate) => candidate.id === shotId)
    if (shot === undefined || shot.description.trim().length === 0) continue
    if ((await readLiveGenerationFor(gate.scope, 'shot', shot.id)) !== null) continue
    const result = await launch(g, 'shot', shot.id, frameSpec(found.scene, found.reel, shot, g.settings, g.artStyle))
    if (result.status === 'insufficient') return result
    last = result
  }
  return last ?? error('None of the picked shots has a description to draw from.')
}

/**
 * `POST /reels/:id/ai-shotlist` - the text model proposes shots (free by the
 * client's ruling). Without a model key it falls back to the pure core's
 * rule-based proposer (`proposeShotsWith`, through the same gate), so the
 * button always does something true.
 */
export const aiShotlistWith = async (gate: EpisodeGate, rawReelId: unknown): Promise<GenerationResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const stop = await mayStart(gate)
  if (stop !== null) return stop
  const g = await ground(gate)
  if (isFailure(g)) return g
  const found = findReel(g.scenes, reelId.data)
  if (found === null) return error(NOT_A_REEL)
  if (modelEnv === null) {
    const proposed = await proposeShotsWith(gate, found.scene.sceneNodeId, found.reel.id)
    if (proposed.status !== 'saved') return proposed
    return { status: 'disconnected', message: 'The model is not connected, so the shotlist was proposed from the scene’s lines instead.' }
  }
  if ((await readLiveGenerationFor(gate.scope, 'reel', found.reel.id)) !== null) return error('This reel is already being worked on.')
  const document = await readDocumentByKind(gate.scope, gate.episode.id, 'screenplay')
  if (document === null) return error('This episode has no script to read.')
  const read = await readScreenplayNodes(gate.scope, document.id)
  if (!read.ok) return error(`The script would not read at ${read.error.at || 'a node'}: ${read.error.reason.kind}.`)
  const nameOf = new Map(g.names.map((name) => [name.id as string, name.name]))
  const nodes = read.value.map((entry) => entry.node)
  const sceneNodes = cutScene(nodes, found.scene.sceneNodeId, new Set(g.scenes.map((scene) => scene.sceneNodeId as string)))
  const sceneText = sceneNodes.map((node) => `${node.type.toUpperCase()}: ${proseOf(node.content, nameOf)}`).join('\n')
  return launch(g, 'reel', found.reel.id, shotlistSpec(found.scene, found.reel, sceneText, g.settings, g.artStyle))
}

/**
 * `POST /reels/:id/shoot` - 375 cr. The spec's 422: `not_ready` with the
 * failing readiness flags, computed here from the rows as stored, never
 * trusted from the button. The first success locks the episode's settings.
 */
export const shootReelWith = async (gate: EpisodeGate, rawReelId: unknown): Promise<ShootResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const off = connected('shoot_reel')
  if (off !== null) return off
  const stop = await mayStart(gate)
  if (stop !== null) return stop
  const g = await ground(gate)
  if (isFailure(g)) return g
  const found = findReel(g.scenes, reelId.data)
  if (found === null) return error(NOT_A_REEL)
  const readiness = readinessOf(found.scene, found.reel)
  if (!readiness.canShoot) return { status: 'not_ready', failed: readiness.failed }
  if ((await readLiveGenerationFor(gate.scope, 'reel', found.reel.id)) !== null) return error('This reel is already shooting.')
  return launch(g, 'reel', found.reel.id, shootSpec(found.scene, found.reel, g.settings, g.artStyle))
}

export const generationIdProblem = (rawId: unknown): Failure | null =>
  ProductionGenerationIdSchema.safeParse(rawId).success ? null : error('That generation is not in this episode.')

/** Stop a generation. Not rate-limited - see `generate.ts`'s header. */
export const cancelGenerationWith = async (gate: EpisodeGate, rawId: unknown): Promise<CancelResult> => {
  const refused = roleRefusal(gate, ROLE.paidGeneration)
  if (refused !== null) return refused
  const id = ProductionGenerationIdSchema.safeParse(rawId)
  if (!id.success) return error('That generation is not in this episode.')
  const result = await cancelGenerationRow(gate.scope, id.data)
  if (result.status === 'no-generation') return error('That generation is not in this episode.')
  return result.status === 'cancelled' ? { status: 'cancelled' } : { status: 'already-over' }
}
