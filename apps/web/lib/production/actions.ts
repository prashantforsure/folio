'use server'

import type { EpisodeId, Reel, ReelId } from '@folio/contracts'
import {
  ClipSecondsSchema,
  DEFAULT_CLIP_SECONDS,
  FRAME_GENERATION_COST,
  GenerationIdSchema,
  JobIdSchema,
  NodeIdSchema,
  REEL_RENDER_COST,
  ReelIdSchema,
  RenderResolutionSchema,
  ShotEditSchema,
  ShotIdSchema,
} from '@folio/contracts'
import type { ProjectScope, StoryboardSceneHeader } from '@folio/db'
import {
  assignShotsToReel as assignShotRows,
  cancelJob,
  deleteReel,
  deleteShots,
  insertReel,
  insertShots,
  keepGeneration,
  listSceneReels,
  listSceneShots,
  listStoryboardScenes,
  moveReel as moveReelRow,
  moveShot as moveShotRow,
  queueFrameGenerations,
  queueReelRender,
  readBalance,
  readBoundCues,
  readDocumentByKind,
  readProductionScene,
  readReel,
  readSceneHeader,
  readScreenplayNodes,
  readShot,
  readShotLock,
  renameReel as renameReelRow,
  setFinalized,
  setReelClip as setReelClipRow,
  setRenderResolution as setRenderResolutionRow,
} from '@folio/db'
import type { NodeId } from '@folio/script'
import { boundCueMap, proposeShots } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { EpisodeGate } from '../script/gate'
import { isRefusal, openEpisode, openProject } from '../script/gate'
import { cutScene } from '../storyboard/scene-cut'
import type { CancelResult, Failure, FramesResult, RenderResult, SavedResult, SceneResult } from './result'
import { describeReason, reelGates } from './status'
import type { GateInput } from './status'

/**
 * The Production route's writes. Every one goes gate -> repository ->
 * result, and every one that touches a scene's reels or shots returns the
 * whole scene re-read (`result.ts` says why).
 *
 * Four kinds, and the file keeps them apart:
 *
 * **Reel writes** - add, put shots in, rename, set the clip length, move,
 * remove. All touch `reels` (and `shots.reel_id`) and nothing else. Each
 * first checks the reel, or the scene, is a present heading of *this*
 * episode's screenplay: `reels.scene_node_id` has no foreign key, so the
 * check is here, at the gate, as the Storyboard's is.
 *
 * **Shot writes in a reel** - add, propose, assign, move. The rows are the
 * Storyboard's; editing a shot's text, accepting a proposal, discarding
 * one and cancelling a frame are the Storyboard's own actions, reused
 * unchanged. A finalized reel refuses all of it, in the repository.
 *
 * **The money writes** - frames for a reel, and the render. Each is one
 * statement after the gate (`queueFrameGenerations`, `queueReelRender`):
 * reserve then execute, the cost named before the click, nothing written
 * when the balance is short. The job is `queued` from here and stays so
 * until a worker exists (`apps/worker` is empty on purpose, and a queue
 * library needs approval).
 *
 * **The gates** - Generate, Finalize and Render each re-read the scene and
 * fold it (`status.ts`) before writing, and refuse with the fold's own
 * sentence. The client draws the same fold; the server decides.
 *
 * Membership, not role, as everywhere. The gate is the Script route's.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const NOT_A_SCENE = 'That scene is not in this episode. Reload the page.'
const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'
const NOT_A_SHOT = 'That shot is not in this scene. Reload the page.'
const LOCKED = 'This reel is finalized. Unlock it to edit its shots.'
const SHOT_LOCKED = 'This shot is in a finalized reel. Unlock the reel to edit it.'
const RENDER_BUSY = 'A render of this reel is queued. Cancel it first.'

const failure = (message: string): Failure => ({ status: 'error', message })

const gateInputOf = async (gate: EpisodeGate): Promise<GateInput> => ({
  available: (await readBalance(gate.scope)).available,
  frameCost: FRAME_GENERATION_COST,
  renderCost: REEL_RENDER_COST,
  resolution: gate.project.renderResolution,
})

/** The scene, whole, after a write. */
const sceneResult = async (scope: ProjectScope, episodeId: EpisodeId, sceneNodeId: NodeId): Promise<SceneResult> => {
  const scene = await readProductionScene(scope, episodeId, sceneNodeId)
  return scene === null ? failure(NOT_A_SCENE) : { status: 'saved', scene }
}

/** The scene, checked as this episode's, or the refusal to report. */
const sceneOf = async (gate: EpisodeGate, rawSceneNodeId: unknown): Promise<StoryboardSceneHeader | Failure> => {
  const id = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!id.success) return failure(NOT_A_SCENE)
  const scene = await readSceneHeader(gate.scope, gate.episode.id, id.data)
  return scene ?? failure(NOT_A_SCENE)
}

/** The reel and its scene, both checked as this episode's, or the refusal. */
const reelOf = async (
  gate: EpisodeGate,
  rawReelId: unknown,
): Promise<{ readonly reel: Reel; readonly scene: StoryboardSceneHeader } | Failure> => {
  const id = ReelIdSchema.safeParse(rawReelId)
  if (!id.success) return failure(NOT_A_REEL)
  const reel = await readReel(gate.scope, id.data)
  if (reel === null) return failure(NOT_A_REEL)
  const scene = await readSceneHeader(gate.scope, gate.episode.id, reel.sceneNodeId)
  if (scene === null) return failure(NOT_A_REEL)
  return { reel, scene }
}

const isFailure = <T extends object>(value: T | Failure): value is Failure => 'status' in value

/**
 * Where a shot added to a reel goes: after the reel's last shot, before
 * whatever follows it in the scene, so a reel's shots stay together in
 * the scene's one order. An empty reel appends to the scene.
 */
const placementInReel = async (
  scope: ProjectScope,
  sceneNodeId: NodeId,
  reelId: ReelId,
): Promise<{ readonly before: string | null; readonly after: string | null }> => {
  const list = await listSceneShots(scope, sceneNodeId)
  const own = list.filter((shot) => shot.reelId === reelId && shot.state === 'accepted')
  const last = own[own.length - 1]
  if (last === undefined) {
    const tail = list[list.length - 1]
    return { before: tail?.orderKey ?? null, after: null }
  }
  const at = list.findIndex((shot) => shot.id === last.id)
  const next = list[at + 1]
  return { before: last.orderKey, after: next?.orderKey ?? null }
}

// ---------------------------------------------------------------------------
// Reel writes
// ---------------------------------------------------------------------------

const AddReelSchema = z.object({
  sceneNodeId: NodeIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  clipSeconds: ClipSecondsSchema.optional(),
})

/** Add a reel at the end of the scene's list. `Reel N` and the default clip length unless told otherwise. */
export const addReel = async (projectId: string, episode: string, raw: unknown): Promise<SceneResult> => {
  const input = AddReelSchema.safeParse(raw)
  if (!input.success) return failure('A reel is a scene, a name up to 80 characters, and a clip length.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (isFailure(scene)) return scene
  const existing = await listSceneReels(scope, scene.sceneNodeId)
  const last = existing[existing.length - 1]
  await insertReel(
    scope,
    scene.sceneNodeId,
    { name: input.data.name ?? `Reel ${existing.length + 1}`, clipSeconds: input.data.clipSeconds ?? DEFAULT_CLIP_SECONDS },
    { before: last?.orderKey ?? null, after: null },
  )
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

const PutShotsSchema = z.object({
  sceneNodeId: NodeIdSchema,
  /** The reel to put them in. Absent: a new reel at the end of the scene. */
  reelId: ReelIdSchema.optional(),
})

/**
 * Put the scene's shots that are not in a reel into one - the first-visit
 * path for a scene boarded in the Storyboard. Accepted shots only; a
 * proposal is not a shot yet.
 */
export const putShotsInReel = async (projectId: string, episode: string, raw: unknown): Promise<SceneResult> => {
  const input = PutShotsSchema.safeParse(raw)
  if (!input.success) return failure('Name the scene, and the reel if there is one.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (isFailure(scene)) return scene
  const loose = (await listSceneShots(scope, scene.sceneNodeId)).filter(
    (shot) => shot.reelId === null && shot.state === 'accepted',
  )
  if (loose.length === 0) return failure('Every shot of this scene is already in a reel.')

  let reel: Reel
  if (input.data.reelId === undefined) {
    const existing = await listSceneReels(scope, scene.sceneNodeId)
    const last = existing[existing.length - 1]
    reel = await insertReel(
      scope,
      scene.sceneNodeId,
      { name: `Reel ${existing.length + 1}`, clipSeconds: DEFAULT_CLIP_SECONDS },
      { before: last?.orderKey ?? null, after: null },
    )
  } else {
    const found = await readReel(scope, input.data.reelId)
    if (found === null || found.sceneNodeId !== scene.sceneNodeId) return failure(NOT_A_REEL)
    if (found.finalizedAt !== null) return failure(LOCKED)
    reel = found
  }
  await assignShotRows(
    scope,
    reel.id,
    loose.map((shot) => shot.id),
  )
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

/** Rename a reel. A name locks nothing, so a finalized reel may be renamed. */
export const renameReel = async (
  projectId: string,
  episode: string,
  rawReelId: string,
  rawName: unknown,
): Promise<SceneResult> => {
  const name = z.string().trim().min(1).max(80).safeParse(rawName)
  if (!name.success) return failure('A reel needs a name, up to 80 characters.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  await renameReelRow(scope, found.reel.id, name.data)
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/** Set the clip length. Refused on a finalized reel. */
export const setReelClip = async (
  projectId: string,
  episode: string,
  rawReelId: string,
  rawSeconds: unknown,
): Promise<SceneResult> => {
  const seconds = ClipSecondsSchema.safeParse(rawSeconds)
  if (!seconds.success) return failure('A clip is 5, 8, 10 or 15 seconds.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  if (found.reel.finalizedAt !== null) return failure(LOCKED)
  const written = await setReelClipRow(scope, found.reel.id, seconds.data)
  if (!written) return failure(NOT_A_REEL)
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/** Move a reel one place up or down in its scene. */
export const moveReel = async (
  projectId: string,
  episode: string,
  rawReelId: string,
  direction: 'up' | 'down',
): Promise<SceneResult> => {
  if (direction !== 'up' && direction !== 'down') return failure('Move a reel up or down.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  const list = await listSceneReels(scope, found.scene.sceneNodeId)
  const at = list.findIndex((entry) => entry.id === found.reel.id)
  const target = direction === 'up' ? at - 1 : at + 1
  const neighbour = list[target]
  if (at === -1 || neighbour === undefined) return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
  // Landing on the far side of the neighbour: between it and the one beyond.
  const beyond = list[direction === 'up' ? target - 1 : target + 1]
  await moveReelRow(scope, found.reel.id, {
    before: direction === 'up' ? (beyond?.orderKey ?? null) : neighbour.orderKey,
    after: direction === 'up' ? neighbour.orderKey : (beyond?.orderKey ?? null),
  })
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/** Remove a reel. Its shots stay in the scene, out of any reel. Refused while a render of it is in flight. */
export const removeReel = async (projectId: string, episode: string, rawReelId: string): Promise<SceneResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  const outcome = await deleteReel(scope, found.reel.id)
  if (outcome === 'busy') return failure(RENDER_BUSY)
  if (outcome === 'missing') return failure(NOT_A_REEL)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

// ---------------------------------------------------------------------------
// Shot writes in a reel
// ---------------------------------------------------------------------------

/** Add a shot by hand at the end of the reel. Born accepted, born in the reel. */
export const addShotToReel = async (
  projectId: string,
  episode: string,
  rawReelId: string,
  rawEdit: unknown,
): Promise<SceneResult> => {
  const edit = ShotEditSchema.safeParse(rawEdit)
  if (!edit.success) return failure('A shot is a size, a movement, an angle, a lens, a duration and a description.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  if (found.reel.finalizedAt !== null) return failure(LOCKED)
  const placement = await placementInReel(scope, found.scene.sceneNodeId, found.reel.id)
  await insertShots(scope, found.scene.sceneNodeId, [edit.data], 'typed', 'accepted', placement, found.reel.id)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/**
 * Propose shots for a reel from its scene: the Storyboard's proposer, the
 * Storyboard's cut, written as `proposed` rows in this reel after its
 * accepted shots, replacing any proposal still waiting in it. Nothing is
 * accepted here; the writer does that with the Storyboard's own actions.
 * Proposing costs nothing.
 */
export const proposeShotsForReel = async (projectId: string, episode: string, rawReelId: string): Promise<SceneResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  if (found.reel.finalizedAt !== null) return failure(LOCKED)
  const { scene, reel } = found

  const document = await readDocumentByKind(scope, gate.episode.id, 'screenplay')
  if (document === null) return failure('This episode has no script to read.')
  const [read, bound, existing, present] = await Promise.all([
    readScreenplayNodes(scope, document.id),
    readBoundCues(scope),
    listSceneShots(scope, scene.sceneNodeId),
    listStoryboardScenes(scope, gate.episode.id),
  ])
  if (!read.ok) {
    return failure(`The script would not read at ${read.error.at || 'a node'}: ${read.error.reason.kind}.`)
  }
  const sceneNodes = cutScene(
    read.value.map((entry) => entry.node),
    scene.sceneNodeId,
    new Set(present.map((header) => header.sceneNodeId as string)),
  )
  if (sceneNodes.length === 0) return failure(NOT_A_SCENE)

  const proposals = proposeShots({
    reading: scene.reading,
    nodes: sceneNodes,
    boundCues: boundCueMap(bound),
    locationId: scene.locationId,
  })
  const waiting = existing.filter((shot) => shot.reelId === reel.id && shot.state === 'proposed').map((shot) => shot.id)
  await deleteShots(scope, waiting)
  const placement = await placementInReel(scope, scene.sceneNodeId, reel.id)
  await insertShots(scope, scene.sceneNodeId, proposals, 'auto_board', 'proposed', placement, reel.id)
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

const AssignSchema = z.object({
  reelId: ReelIdSchema,
  shotIds: z.array(ShotIdSchema).min(1).max(200),
})

/** Put named shots in a reel - from no reel, or from another. The statement carries the rules. */
export const assignShotsToReel = async (projectId: string, episode: string, raw: unknown): Promise<SceneResult> => {
  const input = AssignSchema.safeParse(raw)
  if (!input.success) return failure('Assign names a reel and its shots.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, input.data.reelId)
  if (isFailure(found)) return found
  if (found.reel.finalizedAt !== null) return failure(LOCKED)
  const changed = await assignShotRows(scope, found.reel.id, input.data.shotIds)
  const first = input.data.shotIds[0]
  if (changed < input.data.shotIds.length && first !== undefined && (await readShotLock(scope, first))) {
    return failure(SHOT_LOCKED)
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/** Move a shot one place up or down among its reel's shots. */
export const moveShotInReel = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  direction: 'up' | 'down',
): Promise<SceneResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success || (direction !== 'up' && direction !== 'down')) return failure('Move a shot up or down.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const shot = await readShot(scope, id.data)
  if (shot === null) return failure(NOT_A_SHOT)
  if (shot.reelId === null) return failure('Put the shot in a reel to order it there.')
  const scene = await readSceneHeader(scope, gate.episode.id, shot.sceneNodeId)
  if (scene === null) return failure(NOT_A_SCENE)
  const list = (await listSceneShots(scope, scene.sceneNodeId)).filter((entry) => entry.reelId === shot.reelId)
  const at = list.findIndex((entry) => entry.id === shot.id)
  const target = direction === 'up' ? at - 1 : at + 1
  const neighbour = list[target]
  if (at === -1 || neighbour === undefined) return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
  const beyond = list[direction === 'up' ? target - 1 : target + 1]
  const moved = await moveShotRow(scope, shot.id, {
    before: direction === 'up' ? (beyond?.orderKey ?? null) : neighbour.orderKey,
    after: direction === 'up' ? neighbour.orderKey : (beyond?.orderKey ?? null),
  })
  if (moved === null) return failure((await readShotLock(scope, shot.id)) ? SHOT_LOCKED : NOT_A_SHOT)
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

// ---------------------------------------------------------------------------
// The money writes, and their gates
// ---------------------------------------------------------------------------

/**
 * Generate every frame the reel still needs: reserve `cost × N`, write N
 * jobs. The gate is the fold's - every shot described, none refused and
 * unfixed, none in flight, the reel not finalized - and the statement
 * re-checks the rows it writes against. `queued` from here until a worker
 * exists.
 */
export const generateReelFrames = async (projectId: string, episode: string, rawReelId: string): Promise<FramesResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  const [scene, input] = await Promise.all([
    readProductionScene(scope, gate.episode.id, found.scene.sceneNodeId),
    gateInputOf(gate),
  ])
  const reel = scene?.reels.find((row) => row.id === found.reel.id)
  if (scene === null || reel === undefined) return failure(NOT_A_REEL)
  const gates = reelGates(reel, input)
  if (!gates.canGenerate) return failure(describeReason(gates.reason))

  const queued = await queueFrameGenerations(
    scope,
    gate.episode.id,
    reel.id,
    gates.pending.map((shot) => shot.id),
    FRAME_GENERATION_COST,
  )
  switch (queued.status) {
    case 'no-reel':
      return failure(NOT_A_REEL)
    case 'finalized':
      return failure(LOCKED)
    case 'not-eligible':
      return failure('Some of those shots are no longer in this reel. Reload the page.')
    case 'insufficient':
      return { status: 'insufficient', available: queued.available, needed: queued.needed }
    case 'queued': {
      const after = await readProductionScene(scope, gate.episode.id, scene.sceneNodeId)
      if (after === null) return failure(NOT_A_SCENE)
      return { status: 'queued', scene: after, available: queued.available }
    }
  }
}

/** Keep a take: it becomes the shot's frame, for both routes. Only a drawn one. */
export const keepFrame = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
  rawGenerationId: string,
): Promise<SceneResult> => {
  const id = GenerationIdSchema.safeParse(rawGenerationId)
  if (!id.success) return failure('That take could not be found.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, rawSceneNodeId)
  if (isFailure(scene)) return scene
  const outcome = await keepGeneration(scope, id.data)
  if (outcome === 'missing') return failure('That take could not be found.')
  if (outcome === 'not-drawn') return failure('Only a drawn take can be kept.')
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

/** Finalize: lock the shots, allow the render. The gate is the fold's - every frame drawn, the clip filled exactly. */
export const finalizeReel = async (projectId: string, episode: string, rawReelId: string): Promise<SceneResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  if (found.reel.finalizedAt !== null) return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
  const [scene, input] = await Promise.all([
    readProductionScene(scope, gate.episode.id, found.scene.sceneNodeId),
    gateInputOf(gate),
  ])
  const reel = scene?.reels.find((row) => row.id === found.reel.id)
  if (scene === null || reel === undefined) return failure(NOT_A_REEL)
  const gates = reelGates(reel, input)
  if (!gates.canFinalize) return failure(describeReason(gates.reason))

  const outcome = await setFinalized(scope, reel.id, true)
  if (outcome === 'missing') return failure(NOT_A_REEL)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, scene.sceneNodeId)
}

/** Unlock: the shots may be edited again. Refused while the clip is rendering. */
export const unlockReel = async (projectId: string, episode: string, rawReelId: string): Promise<SceneResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  const outcome = await setFinalized(scope, found.reel.id, false)
  if (outcome === 'busy') return failure('The clip is rendering. Unlock waits until it is done.')
  if (outcome === 'missing') return failure(NOT_A_REEL)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, gate.episode.id, found.scene.sceneNodeId)
}

/**
 * Render the reel: reserve the cost, write the job and its render row.
 * The statement carries the gate - finalized, nothing already in flight,
 * the balance covers it. `queued` from here until a worker exists.
 */
export const renderReel = async (projectId: string, episode: string, rawReelId: string): Promise<RenderResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const found = await reelOf(gate, rawReelId)
  if (isFailure(found)) return found
  const queued = await queueReelRender(scope, gate.episode.id, found.reel.id, REEL_RENDER_COST)
  switch (queued.status) {
    case 'no-reel':
      return failure(NOT_A_REEL)
    case 'not-finalized':
      return failure('Finalize the reel before rendering it.')
    case 'busy':
      return failure('A render of this reel is already queued.')
    case 'insufficient':
      return { status: 'insufficient', available: queued.available, cost: REEL_RENDER_COST }
    case 'queued': {
      const after = await readProductionScene(scope, gate.episode.id, found.scene.sceneNodeId)
      if (after === null) return failure(NOT_A_SCENE)
      return { status: 'queued', scene: after, available: queued.available }
    }
  }
}

/** Stop a job of this scene - a frame's or a render's. Queued: cancelled and released. Running: asked to stop. */
export const cancelSceneJob = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
  rawJobId: string,
): Promise<CancelResult> => {
  const id = JobIdSchema.safeParse(rawJobId)
  if (!id.success) return failure('That job could not be found.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, rawSceneNodeId)
  if (isFailure(scene)) return scene
  const outcome = await cancelJob(scope, id.data)
  switch (outcome.status) {
    case 'no-job':
      return failure('That job could not be found.')
    case 'already-over':
      return failure(`That job is already ${outcome.was} and cannot be cancelled.`)
    case 'cancelled': {
      const after = await readProductionScene(scope, gate.episode.id, scene.sceneNodeId)
      if (after === null) return failure(NOT_A_SCENE)
      return { status: 'cancelled', scene: after, available: outcome.available }
    }
    case 'requested': {
      const after = await readProductionScene(scope, gate.episode.id, scene.sceneNodeId)
      if (after === null) return failure(NOT_A_SCENE)
      return { status: 'requested', scene: after }
    }
  }
}

// ---------------------------------------------------------------------------
// The project-wide setting
// ---------------------------------------------------------------------------

/** Set the resolution every reel of the project renders at. Project-scoped: the episode is not part of it. */
export const setRenderResolution = async (projectId: string, raw: unknown): Promise<SavedResult> => {
  const value = RenderResolutionSchema.safeParse(raw)
  if (!value.success) return failure('A clip renders at 720p or 1080p.')
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  await setRenderResolutionRow(gate.scope, value.data)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return { status: 'saved' }
}
