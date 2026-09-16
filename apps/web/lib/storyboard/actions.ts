'use server'

import type { ShotRow } from '@folio/contracts'
import {
  CanvasPositionSchema,
  FRAME_GENERATION_COST,
  FRAME_UPLOAD_MAX_BYTES,
  JobIdSchema,
  NodeIdSchema,
  ShotEditSchema,
  ShotIdSchema,
} from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import {
  acceptShots as acceptShotRows,
  cancelJob,
  deleteShots,
  insertShots,
  listSceneShotRows,
  listSceneShots,
  listStoryboardScenes,
  moveShot as moveShotRow,
  placeShotOnCanvas as placeShotOnCanvasRow,
  queueFrameGeneration,
  readBoundCues,
  readDocumentByKind,
  readSceneHeader,
  readScreenplayNodes,
  readShot,
  readShotLock,
  setFrameUpload,
  updateShot,
} from '@folio/db'
import type { StoryboardSceneHeader } from '@folio/db'
import { boundCueMap, proposeShots } from '@folio/script'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { EpisodeGate } from '../script/gate'
import { isRefusal, openEpisode } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { deleteObject, keyOfPublicUrl, publicUrl, putObject, storageAvailable } from '../storage/r2'
import type { CancelResult, FrameResult, SceneShotsResult, ShotResult } from './result'
import { cutScene } from './scene-cut'

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
 * **The frame** - one money write. `queueFrameGeneration` reserves the cost
 * and writes the job and generation rows in one statement, only if the
 * balance covers it - "reserve then execute", and the button named the
 * cost before the click. `cancelFrame` releases a queued job's reservation
 * in one statement, or asks a running one to stop. Each is one statement
 * after the gate: the shot and job checks ride inside it.
 *
 * **The canvas** (2026-09-17) - `placeShotOnCanvas` writes where a card
 * was dropped, and nothing else: the sequence is still `order_key`. Not
 * locked, and no revalidation - a position is cosmetic. `uploadFrame` and
 * `clearFrame` are the location photo's shape (`lib/locations/actions.ts`):
 * storage checked before the bytes are read, the object written before the
 * row points at it, the previous object deleted after. The row stores the
 * URL, so the delete goes back through `keyOfPublicUrl`.
 *
 * **The lock** - since the Production phase, a shot in a finalized reel
 * refuses every write above; the repository's predicate does the refusing
 * and `readShotLock` is how the refusal is named here rather than reported
 * as a missing shot.
 *
 * Membership, not role, as everywhere. The gate is the Script route's.
 */

const workspacePath = (projectId: string): string => `/app/project/${projectId}`

const SceneAndShotsSchema = z.object({
  sceneNodeId: NodeIdSchema,
  shotIds: z.array(ShotIdSchema).min(1).max(200),
})

const NOT_A_SCENE = 'That scene is not in this episode. Reload the board.'
const NOT_A_SHOT = 'That shot is not on this board. Reload the board.'
/** A finalized reel locks its shots from both routes (`@folio/db`, `storyboard.ts`); this is the why. */
const LOCKED = 'This shot is in a finalized reel. Unlock the reel in Production to edit it.'

/** The message for a write that changed nothing: locked if the shot is, missing otherwise. */
const refusedWrite = async (scope: ProjectScope, shotId: Parameters<typeof readShotLock>[1]): Promise<string> =>
  (await readShotLock(scope, shotId)) ? LOCKED : NOT_A_SHOT

/** The scene, checked as this episode's, or the refusal to report. */
const sceneOf = async (
  gate: EpisodeGate,
  rawSceneNodeId: unknown,
): Promise<StoryboardSceneHeader | { readonly status: 'error'; readonly message: string }> => {
  const id = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!id.success) return { status: 'error', message: NOT_A_SCENE }
  const scene = await readSceneHeader(gate.scope, gate.episode.id, id.data)
  return scene ?? { status: 'error', message: NOT_A_SCENE }
}

const isScene = (value: StoryboardSceneHeader | { readonly status: string }): value is StoryboardSceneHeader =>
  'sceneNodeId' in value

const sceneResult = async (scope: ProjectScope, scene: StoryboardSceneHeader): Promise<SceneShotsResult> => {
  const shots = await listSceneShotRows(scope, scene.sceneNodeId, scene.number)
  return { status: 'saved', shots, accepted: shots.filter((shot) => shot.state === 'accepted').length }
}

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

/**
 * Auto board: propose a first shot list for a scene. Replaces a proposal
 * still waiting; never touches an accepted shot.
 */
export const proposeShotsForScene = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
): Promise<SceneShotsResult> => {
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
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

/** Add a shot by hand, at the end of the scene's list. Born accepted. */
export const addShot = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: string,
  rawEdit: unknown,
): Promise<SceneShotsResult> => {
  const edit = ShotEditSchema.safeParse(rawEdit)
  if (!edit.success) return { status: 'error', message: 'A shot is a size, a movement, an angle, a lens, a duration and a description.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, rawSceneNodeId)
  if (!isScene(scene)) return scene
  const existing = await listSceneShots(scope, scene.sceneNodeId)
  const last = existing[existing.length - 1]
  await insertShots(scope, scene.sceneNodeId, [edit.data], 'typed', 'accepted', {
    before: last?.orderKey ?? null,
    after: null,
  })
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, scene)
}

/** Rewrite a shot, whole. Editing a proposal accepts it. */
export const saveShot = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  rawEdit: unknown,
): Promise<ShotResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  const edit = ShotEditSchema.safeParse(rawEdit)
  if (!id.success || !edit.success) {
    return { status: 'error', message: 'A shot is a size, a movement, an angle, a lens, a duration and a description.' }
  }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const before = await readShot(scope, id.data)
  if (before === null) return { status: 'error', message: NOT_A_SHOT }
  const scene = await readSceneHeader(scope, gate.episode.id, before.sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const wasProposed = before.state === 'proposed'
  const written = await updateShot(scope, id.data, edit.data)
  if (written === null) return { status: 'error', message: await refusedWrite(scope, id.data) }
  if (wasProposed) revalidatePath(workspacePath(gate.project.id), 'layout')

  const rows = await listSceneShotRows(scope, scene.sceneNodeId, scene.number)
  const shot: ShotRow | undefined = rows.find((row) => row.id === written.id)
  if (shot === undefined) return { status: 'error', message: 'The shot was written but is not on the board.' }
  return { status: 'saved', shot }
}

/** The row as the board reads it, after a write: numbered, with its frame. */
const shotResult = async (gate: EpisodeGate, shotId: ShotRow['id'], sceneNodeId: ShotRow['sceneNodeId']): Promise<ShotResult> => {
  const scene = await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId)
  if (scene === null) return { status: 'error', message: NOT_A_SCENE }
  const rows = await listSceneShotRows(gate.scope, scene.sceneNodeId, scene.number)
  const shot: ShotRow | undefined = rows.find((row) => row.id === shotId)
  if (shot === undefined) return { status: 'error', message: 'The shot was written but is not on the board.' }
  return { status: 'saved', shot }
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
  const gate = await openEpisode(projectId, episode)
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
  if (!storageAvailable()) return { status: 'refused', message: NO_FRAME_STORAGE }
  const image = await readImage(form.get('frame'), FRAME_UPLOAD_MAX_BYTES, 'frame')
  if (!image.ok) return { status: image.status, message: image.message }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
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
    return { status: 'error', message: await refusedWrite(scope, id.data) }
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
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const before = await readShot(scope, id.data)
  if (before === null) return { status: 'error', message: NOT_A_SHOT }
  const pointed = await setFrameUpload(scope, id.data, null)
  if (!pointed.found) return { status: 'error', message: await refusedWrite(scope, id.data) }
  if (pointed.previous !== null && storageAvailable()) {
    const previous = keyOfPublicUrl(pointed.previous)
    if (previous !== null) await deleteObject(previous)
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return shotResult(gate, before.id, before.sceneNodeId)
}

/** Take proposals: they become shots. */
export const acceptShots = async (projectId: string, episode: string, raw: unknown): Promise<SceneShotsResult> => {
  const input = SceneAndShotsSchema.safeParse(raw)
  if (!input.success) return { status: 'error', message: 'Accept names a scene and its proposals.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (!isScene(scene)) return scene
  const accepted = await acceptShotRows(scope, input.data.shotIds)
  const first = input.data.shotIds[0]
  if (accepted === 0 && first !== undefined && (await readShotLock(scope, first))) {
    return { status: 'error', message: LOCKED }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, scene)
}

/** Discard proposals, or delete shots. The scene keeps the rest. */
export const discardShots = async (projectId: string, episode: string, raw: unknown): Promise<SceneShotsResult> => {
  const input = SceneAndShotsSchema.safeParse(raw)
  if (!input.success) return { status: 'error', message: 'Discard names a scene and its shots.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate

  const scene = await sceneOf(gate, input.data.sceneNodeId)
  if (!isScene(scene)) return scene
  const own = new Set((await listSceneShots(scope, scene.sceneNodeId)).map((shot) => shot.id as string))
  const wanted = input.data.shotIds.filter((id) => own.has(id as string))
  const deleted = await deleteShots(scope, wanted)
  const first = wanted[0]
  if (deleted === 0 && first !== undefined && (await readShotLock(scope, first))) {
    return { status: 'error', message: LOCKED }
  }
  revalidatePath(workspacePath(gate.project.id), 'layout')
  return sceneResult(scope, scene)
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
  const gate = await openEpisode(projectId, episode)
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
  if (moved === null) return { status: 'error', message: await refusedWrite(scope, shot.id) }
  return sceneResult(scope, scene)
}

/**
 * Put a shot at a place in its scene's list - the board card's drag
 * (`cursor: grab` in the v2 mockup). `index` is where the shot lands among
 * the scene's shots once it has been lifted out; past the end is the end.
 * The same one-row write as `moveShot`, with the neighbours read from the
 * list rather than from a direction.
 */
export const placeShot = async (
  projectId: string,
  episode: string,
  rawShotId: string,
  rawIndex: unknown,
): Promise<SceneShotsResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  const index = z.int().min(0).max(10_000).safeParse(rawIndex)
  if (!id.success || !index.success) return { status: 'error', message: 'Place a shot at a position in its scene.' }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
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
  if (moved === null) return { status: 'error', message: await refusedWrite(scope, shot.id) }
  return sceneResult(scope, scene)
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * Draw (or redraw) a shot's frame: reserve the cost, write the job. The
 * job is `queued` from here; the frame shows that until a worker exists to
 * run it (`apps/worker` is empty on purpose, and a queue library needs
 * approval). Cost and balance are the ledger's numbers.
 *
 * One statement after the gate. The shot's checks - this episode's, a
 * present scene's, accepted - ride inside it, because on the request path
 * every sequential statement is two round trips (`@folio/db`, `client.ts`).
 */
export const requestFrame = async (projectId: string, episode: string, rawShotId: string): Promise<FrameResult> => {
  const id = ShotIdSchema.safeParse(rawShotId)
  if (!id.success) return { status: 'error', message: NOT_A_SHOT }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate

  const queued = await queueFrameGeneration(gate.scope, gate.episode.id, id.data, FRAME_GENERATION_COST)
  if (queued.status === 'no-shot') {
    return queued.state === 'proposed'
      ? { status: 'error', message: 'Accept the shot before drawing its frame. A proposal has no frame.' }
      : { status: 'error', message: NOT_A_SHOT }
  }
  if (queued.status === 'insufficient') {
    return { status: 'insufficient', available: queued.available, cost: FRAME_GENERATION_COST }
  }
  return {
    status: 'queued',
    frame: { kind: 'queued', jobId: queued.jobId, cost: FRAME_GENERATION_COST },
    available: queued.available,
  }
}

/** Stop a frame job. Queued: cancelled and released. Running: asked to stop. One statement after the gate. */
export const cancelFrame = async (projectId: string, episode: string, rawJobId: string): Promise<CancelResult> => {
  const id = JobIdSchema.safeParse(rawJobId)
  if (!id.success) return { status: 'error', message: 'That job could not be found.' }
  const gate = await openEpisode(projectId, episode)
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
