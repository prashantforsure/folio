'use server'

import {
  CanvasPositionSchema,
  FRAME_UPLOAD_MAX_BYTES,
  JobIdSchema,
  ShotIdSchema,
} from '@folio/contracts'
import {
  cancelJob,
  listSceneShots,
  moveShot as moveShotRow,
  placeShotOnCanvas as placeShotOnCanvasRow,
  readSceneHeader,
  readShot,
  setFrameUpload,
} from '@folio/db'
import { revalidatePath } from 'next/cache'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { deleteObject, keyOfPublicUrl, publicUrl, putObject, storageAvailable } from '../storage/r2'
import {
  NOT_A_SCENE,
  NOT_A_SHOT,
  acceptProblem,
  acceptShotsWith,
  addShotProblem,
  addShotWith,
  discardProblem,
  discardShotsWith,
  placeProblem,
  placeShotWith,
  proposeShotsForSceneWith,
  saveShotProblem,
  saveShotWith,
  sceneResult,
  shotResult,
} from './core'
import type { CancelResult, FrameResult, SceneShotsResult, ShotResult } from './result'

/**
 * The Storyboard route's writes.
 *
 * Three kinds, and the file keeps them apart:
 *
 * **Shot writes** - add, edit, accept, discard, move. All touch `shots`
 * and nothing else; none touches a node. Each first checks the scene it
 * names is a present heading of *this* episode's screenplay
 * (`readSceneHeader`): `shots.scene_node_id` has no foreign key, so the
 * check is here, at the gate, where every other rule is. A scene write
 * returns the scene's whole list re-read, numbered, because ordinals moved.
 *
 * **The proposal** - "propose shots for this scene". Reads the scene's
 * nodes and the alias table's bound cues, runs the pure proposer, and
 * writes the result as `proposed` rows after the scene's accepted shots,
 * replacing any proposal still waiting. Nothing is accepted here; the
 * writer does that, per shot or all at once, and editing is accepting.
 *
 * **The frame** - `requestFrame` refuses outright (defect 0.4): no runner
 * exists to draw a queued job, so nothing reserves credits for one.
 * `cancelFrame` still releases a queued job's reservation in one statement,
 * or asks a running one to stop - both real states a job can already be in.
 *
 * **The canvas** (2026-09-17) - `placeShotOnCanvas` writes where a card
 * was dropped, and nothing else: the sequence is still `order_key`. Not
 * locked, and no revalidation - a position is cosmetic. `uploadFrame` and
 * `clearFrame` are the location photo's shape (`lib/locations/actions.ts`):
 * storage checked before the bytes are read, the object written before the
 * row points at it, the previous object deleted after. The row stores the
 * URL, so the delete goes back through `keyOfPublicUrl`.
 *
 * The gate is the Script route's. Every write here is `ROLE.productionEdit`
 * except the two frame jobs, which are `ROLE.paidGeneration` - both a
 * writer's under ADR 0003 D2.
 *
 * **Thin actions over core functions** (roadmap task 4.2): the proposal and
 * the shot writes the agent's tools reach are core functions in `core.ts`
 * taking an episode gate - which the tools and the worker call with a gate of
 * their own. Each action parses what it always parsed before the gate, opens
 * the cookie gate, calls the core, and revalidates when it always did.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/**
 * Auto board: propose a first shot list for a scene (`proposeShotsForSceneWith`).
 * Replaces a proposal still waiting; never touches an accepted shot.
 */
export const proposeShotsForScene = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
): Promise<SceneShotsResult> => {
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return proposeShotsForSceneWith(gate, rawSceneNodeId)
}

// ---------------------------------------------------------------------------
// Shot writes
// ---------------------------------------------------------------------------

/** Add a shot by hand, at the end of the scene's list. Born accepted. */
export const addShot = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
  rawEdit: unknown,
  rawKey: unknown = null,
): Promise<SceneShotsResult> => {
  const problem = addShotProblem(rawEdit, rawKey)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const result = await addShotWith(gate, rawSceneNodeId, rawEdit, rawKey)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Rewrite a shot, whole. Editing a proposal accepts it, and only that revalidates the layout. */
export const saveShot = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  rawEdit: unknown,
): Promise<ShotResult> => {
  const problem = saveShotProblem(rawShotId, rawEdit)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return saveShotWith(gate, rawShotId, rawEdit, { onAccepted: () => revalidatePath(workspacePath(gate.project.id), 'layout') })
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/** Put a card where the canvas dropped it. Cosmetic: the sequence does not move. */
export const placeShotOnCanvas = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  rawPosition: unknown,
): Promise<ShotResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  const position = CanvasPositionSchema.safeParse(rawPosition)
  if (!id.success || !position.success) return { status: 'error', message: 'A card goes at a whole x and y.' }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate

  const written = await placeShotOnCanvasRow(gate.scope, id.data, position.data)
  if (written === null) return { status: 'error', message: NOT_A_SHOT }
  return shotResult(gate, written.id, written.sceneNodeId)
}

const NO_FRAME_STORAGE = 'Frame storage is not set up on this server yet.'

/**
 * Store a frame the writer chose. The file is the `frame` entry of the
 * form data. The upload wins over a settled generation until cleared
 * (`@folio/db`, `foldUpload`); a job in flight still shows through.
 */
export const uploadFrame = async (projectId: string, episode: string, rawShotId: string, form: FormData): Promise<ShotResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success) return { status: 'error', message: NOT_A_SHOT }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  if (!storageAvailable()) return { status: 'refused', message: NO_FRAME_STORAGE }
  const image = await readImage(form.get('frame'), FRAME_UPLOAD_MAX_BYTES, 'frame')
  if (!image.ok) return { status: image.status, message: image.message }
  const { scope } = gate

  const before = await readShot(scope, id.data)
  if (before === null) return { status: 'error', message: NOT_A_SHOT }
  if (before.state === 'proposed') return { status: 'error', message: 'Accept the shot before giving it a frame. A proposal has no frame.' }

  const key = `projects/${gate.project.id}/shots/${id.data}/frame-${crypto.randomUUID()}.${IMAGE_EXTENSION[image.type]}`
  const put = await putObject(key, image.bytes, image.type)
  if (!put.ok) return { status: 'error', message: put.message }
  const url = publicUrl(key)
  if (url === null) return { status: 'refused', message: NO_FRAME_STORAGE }
  const pointed = await setFrameUpload(scope, id.data, url)
  if (!pointed.found) {
    await deleteObject(key)
    return { status: 'error', message: NOT_A_SHOT }
  }
  const previous = pointed.previous === null ? null : keyOfPublicUrl(pointed.previous)
  if (previous !== null && previous !== key) await deleteObject(previous)
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return shotResult(gate, before.id, before.sceneNodeId)
}

/** Take the uploaded frame off a shot. The generation underneath, if any, shows again. */
export const clearFrame = async (projectId: string, episode: string, rawShotId: string): Promise<ShotResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success) return { status: 'error', message: NOT_A_SHOT }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const before = await readShot(scope, id.data)
  if (before === null) return { status: 'error', message: NOT_A_SHOT }
  const pointed = await setFrameUpload(scope, id.data, null)
  if (!pointed.found) return { status: 'error', message: NOT_A_SHOT }
  if (pointed.previous !== null && storageAvailable()) {
    const previous = keyOfPublicUrl(pointed.previous)
    if (previous !== null) await deleteObject(previous)
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return shotResult(gate, before.id, before.sceneNodeId)
}

/** Take proposals: they become shots. */
export const acceptShots = async (projectId: string, episode: string, raw: unknown): Promise<SceneShotsResult> => {
  const problem = acceptProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const result = await acceptShotsWith(gate, raw)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Discard proposals, or delete shots. The scene keeps the rest. */
export const discardShots = async (projectId: string, episode: string, raw: unknown): Promise<SceneShotsResult> => {
  const problem = discardProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const result = await discardShotsWith(gate, raw)
  if (result.status === 'saved') revalidatePath(workspacePath(gate.project.id), 'layout')
  return result
}

/** Move a shot one place up or down in its scene. */
export const moveShot = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  direction: 'up' | 'down',
): Promise<SceneShotsResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success || (direction !== 'up' && direction !== 'down')) {
    return { status: 'error', message: 'Move a shot up or down.' }
  }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const shot = await readShot(scope, id.data)
  if (shot === null) return { status: 'error', message: NOT_A_SHOT }
  const scene = await readSceneHeader(scope, gate.episode.id, shot.sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const list = await listSceneShots(scope, scene.sceneNodeId)
  const at = list.findIndex((entry) => entry.id === shot.id)
  const target = direction === 'up' ? at - 1 : at + 1
  const neighbour = list[target]
  if (at === -1 || neighbour === undefined) return sceneResult(scope, scene)
  // Landing on the far side of the neighbour: between it and the one beyond.
  const beyond = list[direction === 'up' ? target - 1 : target + 1]
  const moved = await moveShotRow(scope, shot.id, {
    before: direction === 'up' ? (beyond?.orderKey ?? null) : neighbour.orderKey,
    after: direction === 'up' ? neighbour.orderKey : (beyond?.orderKey ?? null),
  })
  if (moved === null) return { status: 'error', message: NOT_A_SHOT }
  return sceneResult(scope, scene)
}

/**
 * Put a shot at a place in its scene's list - the board card's drag
 * (`placeShotWith`). The same one-row write as `moveShot`, with the neighbours
 * read from the list rather than from a direction.
 */
export const placeShot = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  rawIndex: unknown,
): Promise<SceneShotsResult> => {
  const problem = placeProblem(rawShotId, rawIndex)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return placeShotWith(gate, rawShotId, rawIndex)
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Draw (or redraw) a shot's frame.
 *
 * Refused outright (defect 0.4): `apps/worker` is empty on purpose and,
 * unlike Production, nothing inside `web` stands in for it. Queuing the job
 * anyway - what this did before the fix - would reserve the cost and leave
 * it held forever with nothing ever drawing the frame. The button that calls
 * this is disabled with the same reason (`DRAW_FRAME_DISABLED`,
 * `shot-parts.tsx`); this refuses whatever reaches the action directly.
 * `queueFrameGeneration` (`@folio/db`) is what resumes this once a runner
 * exists to pick up what it queues.
 */
export const requestFrame = async (projectId: string, episode: string, rawShotId: string): Promise<FrameResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success) return { status: 'error', message: NOT_A_SHOT }
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate
  return { status: 'refused', message: 'Needs a frame-drawing worker - not built yet.' }
}

/** Stop a frame job. Queued: cancelled and released. Running: asked to stop. One statement after the gate. */
export const cancelFrame = async (projectId: string, episode: string, rawJobId: string): Promise<CancelResult> => {
  const id = JobIdSchema.safeParse(rawJobId)
  if (!id.success) return { status: 'error', message: 'That job could not be found.' }
  const gate = await openEpisode(projectId, episode, ROLE.paidGeneration)
  if (isRefusal(gate)) return gate

  const outcome = await cancelJob(gate.scope, id.data)
  switch (outcome.status) {
    case 'no-job':
      return { status: 'error', message: 'That job could not be found.' }
    case 'cancelled':
      return { status: 'cancelled', frame: { kind: 'cancelled', jobId: id.data }, available: outcome.available }
    case 'requested':
      return { status: 'requested', frame: { kind: 'running', jobId: id.data, cost: outcome.cost } }
    case 'already-over':
      return { status: 'error', message: `That job is already ${outcome.was} and cannot be cancelled.` }
  }
}
