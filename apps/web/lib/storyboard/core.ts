import type { ShotRow } from '@folio/contracts'
import { FRAME_GENERATION_COST, NodeIdSchema, ShotEditSchema, ShotIdSchema } from '@folio/contracts'
import type { ProjectScope, StoryboardSceneHeader } from '@folio/db'
import {
  acceptShots as acceptShotRows,
  deleteShots,
  insertShots,
  listSceneShotRows,
  listSceneShots,
  listStoryboardScenes,
  moveShot as moveShotRow,
  queueFrameGeneration,
  readBoundCues,
  readDocumentByKind,
  readSceneHeader,
  readScreenplayNodes,
  readShot,
  updateShot,
} from '@folio/db'
import { boundCueMap, proposeShots } from '@folio/script'
import { z } from 'zod'

import { checkRateLimit } from '../agent/rate-limit'
import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import type { EpisodeGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { connected } from '../production/pipeline/connection'
import type { FrameResult, SceneShotsResult, ShotResult } from './result'
import { cutScene } from './scene-cut'

/**
 * The Storyboard's shot writes as **core functions** - roadmap task 4.2.
 *
 * Each takes an episode gate already opened and the raw input its action
 * takes, checks the role itself (`ROLE.productionEdit`), and does everything
 * the action did after its gate. The actions in `actions.ts` (whose header is
 * the route's account of each) open the cookie gate and revalidate; the
 * agent's storyboard tools and the worker call these with a gate of their own.
 */

const SceneAndShotsSchema = z.object({
  sceneNodeId: NodeIdSchema,
  shotIds: z.array(ShotIdSchema).min(1).max(200),
})

export const NOT_A_SCENE = 'That scene is not in this episode. Reload the board.'
export const NOT_A_SHOT = 'That shot is not on this board. Reload the board.'
const SHOT_SHAPE = 'A shot is a size, a movement, an angle, a lens, a duration and a description.'

type Problem = { readonly status: 'error'; readonly message: string }

/** The scene, checked as this episode's, or the refusal to report. */
export const sceneOf = async (gate: EpisodeGate, rawSceneNodeId: unknown): Promise<StoryboardSceneHeader | Problem> => {
  const id = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!id.success) return { status: 'error', message: NOT_A_SCENE }
  const scene = await readSceneHeader(gate.scope, gate.episode.id, id.data)
  return scene ?? { status: 'error', message: NOT_A_SCENE }
}

export const isScene = (value: StoryboardSceneHeader | { readonly status: string }): value is StoryboardSceneHeader =>
  'sceneNodeId' in value

export const sceneResult = async (scope: ProjectScope, scene: StoryboardSceneHeader): Promise<SceneShotsResult> => {
  const shots = await listSceneShotRows(scope, scene.sceneNodeId, scene.number)
  return { status: 'saved', shots, accepted: shots.filter((shot) => shot.state === 'accepted').length }
}

/** The row as the board reads it, after a write: numbered, with its frame. */
export const shotResult = async (gate: EpisodeGate, shotId: ShotRow['id'], sceneNodeId: ShotRow['sceneNodeId']): Promise<ShotResult> => {
  const scene = await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const rows = await listSceneShotRows(gate.scope, scene.sceneNodeId, scene.number)
  const shot: ShotRow | undefined = rows.find((row) => row.id === shotId)
  if (shot === undefined) return { status: 'error', message: 'The shot was written but is not on the board.' }
  return { status: 'saved', shot }
}

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/**
 * Auto board: propose a first shot list for a scene. Replaces a proposal
 * still waiting; never touches an accepted shot.
 */
export const proposeShotsForSceneWith = async (gate: EpisodeGate, rawSceneNodeId: unknown): Promise<SceneShotsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const { scope } = gate

  const scene = await sceneOf(gate, rawSceneNodeId)
  if (!isScene(scene)) return scene

  const document = await readDocumentByKind(scope, gate.episode.id, 'screenplay')
  if (document === null) return { status: 'error', message: 'This episode has no script to read.' }
  const [read, bound, existing, present] = await Promise.all([
    readScreenplayNodes(scope, document.id),
    readBoundCues(scope),
    listSceneShots(scope, scene.sceneNodeId),
    listStoryboardScenes(scope, gate.episode.id),
  ])
  if (!read.ok) {
    return { status: 'error', message: `The script would not read at ${read.error.at || 'a node'}: ${read.error.reason.kind}.` }
  }
  const nodes = read.value.map((entry) => entry.node)
  // The cut follows derivation's lines exactly as the Scenes excerpt does: a
  // scene runs to the next heading derivation accepted, and a demoted
  // heading stays inside the scene as the text the writer typed.
  const sceneNodes = cutScene(
    nodes,
    scene.sceneNodeId,
    new Set(present.map((header) => header.sceneNodeId as string)),
  )
  if (sceneNodes.length === 0) return { status: 'error', message: NOT_A_SCENE }

  const proposals = proposeShots({
    reading: scene.reading,
    nodes: sceneNodes,
    boundCues: boundCueMap(bound),
    locationId: scene.locationId,
  })

  const waiting = existing.filter((shot) => shot.state === 'proposed').map((shot) => shot.id)
  await deleteShots(scope, waiting)
  const accepted = existing.filter((shot) => shot.state === 'accepted')
  const last = accepted[accepted.length - 1]
  await insertShots(scope, scene.sceneNodeId, proposals, 'auto_board', 'proposed', {
    before: last?.orderKey ?? null,
    after: null,
  })
  return sceneResult(scope, scene)
}

// ---------------------------------------------------------------------------
// Shot writes
// ---------------------------------------------------------------------------

export const addShotProblem = (rawEdit: unknown, rawKey: unknown): Problem | null => {
  if (!ShotEditSchema.safeParse(rawEdit).success) return { status: 'error', message: SHOT_SHAPE }
  if (!idempotencyKeyOf(rawKey).ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  return null
}

/** Add a shot by hand, at the end of the scene's list. Born accepted. */
export const addShotWith = async (gate: EpisodeGate, rawSceneNodeId: unknown, rawEdit: unknown, rawKey: unknown = null): Promise<SceneShotsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const edit = ShotEditSchema.safeParse(rawEdit)
  if (!edit.success) return { status: 'error', message: SHOT_SHAPE }
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return { status: 'error', message: BAD_IDEMPOTENCY_KEY }
  const { scope } = gate

  const scene = await sceneOf(gate, rawSceneNodeId)
  if (!isScene(scene)) return scene
  const existing = await listSceneShots(scope, scene.sceneNodeId)
  const last = existing[existing.length - 1]
  await insertShots(
    scope,
    scene.sceneNodeId,
    [edit.data],
    'typed',
    'accepted',
    { before: last?.orderKey ?? null, after: null },
    key.key,
  )
  return sceneResult(scope, scene)
}

export const saveShotProblem = (rawShotId: unknown, rawEdit: unknown): Problem | null =>
  ShotIdSchema.safeParse(rawShotId).success && ShotEditSchema.safeParse(rawEdit).success ? null : { status: 'error', message: SHOT_SHAPE }

/**
 * Rewrite a shot, whole. Editing a proposal accepts it - and `onAccepted`
 * runs at that moment, which is when the action revalidates the layout (the
 * accepted count on the rail changed; an edit to an accepted shot changes
 * nothing there).
 */
export const saveShotWith = async (
  gate: EpisodeGate,
  rawShotId: unknown,
  rawEdit: unknown,
  hooks: { readonly onAccepted?: () => void } = {},
): Promise<ShotResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const id = ShotIdSchema.safeParse(rawShotId)
  const edit = ShotEditSchema.safeParse(rawEdit)
  if (!id.success || !edit.success) return { status: 'error', message: SHOT_SHAPE }
  const { scope } = gate

  const before = await readShot(scope, id.data)
  if (before === null) return { status: 'error', message: NOT_A_SHOT }
  const scene = await readSceneHeader(scope, gate.episode.id, before.sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const wasProposed = before.state === 'proposed'
  const written = await updateShot(scope, id.data, edit.data)
  if (written === null) return { status: 'error', message: NOT_A_SHOT }
  if (wasProposed) hooks.onAccepted?.()

  const rows = await listSceneShotRows(scope, scene.sceneNodeId, scene.number)
  const shot: ShotRow | undefined = rows.find((row) => row.id === written.id)
  if (shot === undefined) return { status: 'error', message: 'The shot was written but is not on the board.' }
  return { status: 'saved', shot }
}

export const acceptProblem = (raw: unknown): Problem | null =>
  SceneAndShotsSchema.safeParse(raw).success ? null : { status: 'error', message: 'Accept names a scene and its proposals.' }

/** Take proposals: they become shots. */
export const acceptShotsWith = async (gate: EpisodeGate, raw: unknown): Promise<SceneShotsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = SceneAndShotsSchema.safeParse(raw)
  if (!input.success) return { status: 'error', message: 'Accept names a scene and its proposals.' }
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (!isScene(scene)) return scene
  await acceptShotRows(scope, input.data.shotIds)
  return sceneResult(scope, scene)
}

export const discardProblem = (raw: unknown): Problem | null =>
  SceneAndShotsSchema.safeParse(raw).success ? null : { status: 'error', message: 'Discard names a scene and its shots.' }

/** Discard proposals, or delete shots. The scene keeps the rest. */
export const discardShotsWith = async (gate: EpisodeGate, raw: unknown): Promise<SceneShotsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = SceneAndShotsSchema.safeParse(raw)
  if (!input.success) return { status: 'error', message: 'Discard names a scene and its shots.' }
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (!isScene(scene)) return scene
  const own = new Set((await listSceneShots(scope, scene.sceneNodeId)).map((shot) => shot.id as string))
  const wanted = input.data.shotIds.filter((id) => own.has(id as string))
  await deleteShots(scope, wanted)
  return sceneResult(scope, scene)
}

const IndexSchema = z.int().min(0).max(10_000)

export const placeProblem = (rawShotId: unknown, rawIndex: unknown): Problem | null =>
  ShotIdSchema.safeParse(rawShotId).success && IndexSchema.safeParse(rawIndex).success ? null : { status: 'error', message: 'Place a shot at a position in its scene.' }

/**
 * Put a shot at a place in its scene's list - the board card's drag. `index`
 * is where the shot lands among the scene's shots once it has been lifted
 * out; past the end is the end.
 */
export const placeShotWith = async (gate: EpisodeGate, rawShotId: unknown, rawIndex: unknown): Promise<SceneShotsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const id = ShotIdSchema.safeParse(rawShotId)
  const index = IndexSchema.safeParse(rawIndex)
  if (!id.success || !index.success) return { status: 'error', message: 'Place a shot at a position in its scene.' }
  const { scope } = gate

  const shot = await readShot(scope, id.data)
  if (shot === null) return { status: 'error', message: NOT_A_SHOT }
  const scene = await readSceneHeader(scope, gate.episode.id, shot.sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const others = (await listSceneShots(scope, scene.sceneNodeId)).filter((entry) => entry.id !== shot.id)
  const at = Math.min(index.data, others.length)
  const before = others[at - 1]
  const after = others[at]
  const moved = await moveShotRow(scope, shot.id, {
    before: before?.orderKey ?? null,
    after: after?.orderKey ?? null,
  })
  if (moved === null) return { status: 'error', message: NOT_A_SHOT }
  return sceneResult(scope, scene)
}

// ---------------------------------------------------------------------------
// The frame (roadmap task 4.3)
// ---------------------------------------------------------------------------

export const frameShotProblem = (rawShotId: unknown): Problem | null => (ShotIdSchema.safeParse(rawShotId).success ? null : { status: 'error', message: NOT_A_SHOT })

/**
 * Why a frame cannot be drawn on this server, or `null` when it can: the
 * `shot_frame` model needs `GEMINI_API_KEY`, and the drawing needs the `R2_*`
 * block to be stored anywhere. The button draws disabled with this reason; the
 * action refuses with it.
 */
export const frameDrawingOff = (): string | null => {
  const off = connected('shot_frame')
  return off === null ? null : off.message
}

/**
 * Draw (or redraw) a shot's frame - defect 0.4 closed properly. Reserve then
 * execute, in one statement (`queueFrameGeneration`): the credits are held and
 * the `frame_generation` job queued only if the balance covers
 * `FRAME_GENERATION_COST`, and the worker draws it
 * (`lib/worker/frame-generation.ts`). A proposal has no frame; the shot must be
 * an accepted shot of a present scene of this episode. The D14 generate limit
 * applies, as it does to every generate action.
 */
export const requestFrameWith = async (gate: EpisodeGate, rawShotId: unknown): Promise<FrameResult> => {
  const refused = roleRefusal(gate, ROLE.paidGeneration)
  if (refused !== null) return refused
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success) return { status: 'error', message: NOT_A_SHOT }
  const off = frameDrawingOff()
  if (off !== null) return { status: 'refused', message: off }
  const limited = await checkRateLimit(gate.scope, gate.actor, 'generate')
  if (limited !== null) return limited

  const queued = await queueFrameGeneration(gate.scope, gate.episode.id, id.data, FRAME_GENERATION_COST)
  if (queued.status === 'insufficient') return { status: 'insufficient', available: queued.available, cost: FRAME_GENERATION_COST }
  if (queued.status === 'no-shot') {
    return { status: 'error', message: queued.state === 'proposed' ? 'Accept the shot before drawing its frame. A proposal has no frame.' : NOT_A_SHOT }
  }
  return { status: 'queued', frame: { kind: 'queued', jobId: queued.jobId, cost: FRAME_GENERATION_COST }, available: queued.available }
}
