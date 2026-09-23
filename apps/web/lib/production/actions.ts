'use server'

import type { Asset, NoteInput } from '@folio/contracts'
import {
  NodeIdSchema,
  NoteInputSchema,
  PRODUCTION_IMAGE_MAX_BYTES,
  ReelIdSchema,
  ReelShotIdSchema,
  SceneSetupPatchSchema,
  ViewPreferencesPatchSchema,
} from '@folio/contracts'
import type { AssetRecord, ProjectScope } from '@folio/db'
import {
  addShotReference,
  appendNote,
  insertAsset,
  readReelIdsInEpisode,
  readSceneHeader,
  readShotIdsInEpisode,
  saveViewPreferences as saveViewPreferencesRow,
  setSceneSetup as setSceneSetupRow,
  setSceneStill,
} from '@folio/db'

import { ROLE } from '../auth/roles'
import { isRefusal, openEpisode } from '../script/gate'
import type { EpisodeGate } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { publicUrl, putObject, storageAvailable } from '../storage/r2'
import {
  NOT_A_REEL,
  NOT_A_SCENE,
  NOT_A_SHOT,
  addReelProblem,
  addReelWith,
  addShotProblem,
  addShotWith,
  bulkPatchShotsWith,
  bulkProblem,
  deleteReelWith,
  deleteShotWith,
  error,
  moveProblem,
  moveShotWith,
  patchReelProblem,
  patchReelWith,
  patchShotProblem,
  patchShotWith,
  proposeShotsProblem,
  proposeShotsWith,
  retimeProblem,
  retimeShotWith,
  saveSettingsWith,
  settingsProblem,
  shotIdProblem,
} from './core'
import type {
  BulkResult,
  DeleteReelResult,
  Failure,
  PreferencesResult,
  MovedResult,
  ReelResult,
  SavedResult,
  SettingsResult,
  ShotResult,
  UploadResult,
} from './result'

/**
 * The Production route's writes - `docs/production/production.md` §7,
 * "Suggested endpoints", as server actions (the client's ruling,
 * 2026-09-22: every gate is enforced here and the result carries what an
 * HTTP status would have). The generate actions - sheet, scene image,
 * frames, shotlist, shoot, cancel - are `generate.ts`; this file is the
 * authoring surface.
 *
 * Every action: zod first, then the gate (`openEpisode` - identity,
 * membership, the episode), then one repository call. Results are
 * discriminated (`result.ts`). Every write is `ROLE.productionEdit` - a
 * writer's, under ADR 0003 D2 - except the view preferences, which are the
 * reader's own arrangement of their own route.
 *
 * ## The gate proves the project; the episode is proved per row
 *
 * The scope makes every statement this file runs tenant-safe, and that is
 * where its guarantee ends: it says a reel is **this project's**, not that it
 * is **this episode's**. Production is episode-scoped and a project has many
 * episodes, so an action that takes a reel or a shot id also asks
 * `readReelIdsInEpisode` / `readShotIdsInEpisode` (`@folio/db`) whether the id
 * belongs to the episode the gate opened - one statement, whatever the length
 * of the list. Without it, an id from a sibling episode was accepted and
 * written; a shot id is not a secret, and a server action is a public
 * endpoint. The refusals are the ones already written here, `NOT_A_REEL` and
 * `NOT_A_SHOT`: "not in this episode" is what they have always said.
 *
 * ## Round trips are counted
 *
 * The dev pooler is far away and unprepared (`Script save path`, ~400 ms a
 * statement), so an action answers with what it wrote and one asset read,
 * never with the whole episode re-read: `resolveShot` / `resolveReel` turn
 * the repository's record into the client's row with a single statement
 * for the asset keys. A scene is checked with `readSceneHeader`, one row.
 * No `revalidatePath` either: it re-renders the whole route inside the
 * action's response (the full episode read again, several seconds here),
 * and the route is dynamic, so the next navigation reads fresh anyway;
 * the workspace calls `router.refresh()` itself where a write changes more
 * than it returns.
 *
 * ## Thin actions over core functions (roadmap task 4.2)
 *
 * The authoring writes the agent reaches are core functions in `core.ts`
 * taking an episode gate; each action here parses what it always parsed
 * before the gate, opens the cookie gate and calls the core. The scene setup,
 * the notes, the view preferences and the uploads are as they were.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** `PUT /episodes/:id/settings` - refused once `locked_at` is set. */
export const saveSettings = async (projectId: string, episode: string, raw: unknown): Promise<SettingsResult> => {
  const problem = settingsProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return saveSettingsWith(gate, raw)
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

export const addReel = async (
  projectId: string,
  episode: string,
  rawSceneNodeId: unknown,
  rawKey: unknown = null,
): Promise<ReelResult> => {
  const problem = addReelProblem(rawSceneNodeId, rawKey)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return addReelWith(gate, rawSceneNodeId, rawKey)
}

/** `PATCH /reels/:id` - `name`, `clip_length_s`. */
export const patchReel = async (projectId: string, episode: string, rawReelId: unknown, raw: unknown): Promise<ReelResult> => {
  const problem = patchReelProblem(rawReelId, raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return patchReelWith(gate, rawReelId, raw)
}

export const deleteReel = async (projectId: string, episode: string, rawReelId: unknown): Promise<DeleteReelResult> => {
  if (!ReelIdSchema.safeParse(rawReelId).success) return error(NOT_A_REEL)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return deleteReelWith(gate, rawReelId)
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/** `POST /reels/:id/shots` - one empty shot at the end of the reel. */
export const addShot = async (projectId: string, episode: string, raw: unknown, rawKey: unknown = null): Promise<ShotResult> => {
  const problem = addShotProblem(raw, rawKey)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return addShotWith(gate, raw, rawKey)
}

/** `PATCH /shots/:id` - any field. A changed description is re-read into parts and its auto characters. */
export const patchShot = async (projectId: string, episode: string, rawShotId: unknown, raw: unknown): Promise<ShotResult> => {
  const problem = patchShotProblem(rawShotId, raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return patchShotWith(gate, rawShotId, raw)
}

/** `PATCH /shots/bulk` - the bulk bar. */
export const bulkPatchShots = async (projectId: string, episode: string, raw: unknown): Promise<BulkResult> => {
  const problem = bulkProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return bulkPatchShotsWith(gate, raw)
}

/** `POST /shots/:id/move { reel_id, before_id }` - within or across reels. Answers with the reels touched; the client keeps the order it drew. */
export const moveShot = async (projectId: string, episode: string, raw: unknown): Promise<MovedResult> => {
  const problem = moveProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return moveShotWith(gate, raw)
}

/** The timing bar's drag. The spec's clamp is re-applied here against the reel as stored. */
export const retimeShot = async (projectId: string, episode: string, raw: unknown): Promise<ReelResult> => {
  const problem = retimeProblem(raw)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return retimeShotWith(gate, raw)
}

/** `DELETE /shots/:id`. The reel comes back renumbered. */
export const deleteShot = async (projectId: string, episode: string, rawShotId: unknown): Promise<ReelResult> => {
  const problem = shotIdProblem(rawShotId)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return deleteShotWith(gate, rawShotId)
}

// ---------------------------------------------------------------------------
// Propose shots (rule-based, free)
// ---------------------------------------------------------------------------

/**
 * `POST /scenes/:id/propose-shots` - the pure core's rule-based proposer
 * (`@folio/script`, `proposeShots`) over the scene's lines, written as
 * `proposed` shots into a new reel (the empty scene's `✦ Propose shots
 * from the scene`) or the reel given (`✦ AI Shotlist` without a model key
 * falls back to this). Free, by the client's ruling.
 */
export const proposeShots = async (projectId: string, episode: string, rawSceneNodeId: unknown, rawReelId: unknown): Promise<ReelResult> => {
  const problem = proposeShotsProblem(rawSceneNodeId, rawReelId)
  if (problem !== null) return problem
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  return proposeShotsWith(gate, rawSceneNodeId, rawReelId)
}

// ---------------------------------------------------------------------------
// Scene setup, notes, preferences
// ---------------------------------------------------------------------------

export const setSceneSetup = async (projectId: string, episode: string, raw: unknown): Promise<SavedResult> => {
  const patch = SceneSetupPatchSchema.safeParse(raw)
  if (!patch.success) return error(NOT_A_SCENE)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  if ((await readSceneHeader(gate.scope, gate.episode.id, patch.data.sceneNodeId)) === null) return error(NOT_A_SCENE)
  await setSceneSetupRow(gate.scope, patch.data)
  return { status: 'saved' }
}

/**
 * Is the thing this note is about a thing of this episode?
 *
 * `notes` stores `(target_type, target_id)` and has no foreign key - the three
 * targets live in three tables, one of which (`scene`) is not a table at all
 * but a heading node. So the check is per kind, and it is a check the insert
 * cannot make: `appendNote` is a bare insert, and a note on an id that is not
 * this episode's was written happily, tenant-correct and dangling, readable by
 * nobody and deleted by nothing.
 */
const noteTargetExists = async (gate: EpisodeGate, input: NoteInput): Promise<boolean> => {
  if (input.targetType === 'scene') {
    const sceneNodeId = NodeIdSchema.safeParse(input.targetId)
    return sceneNodeId.success && (await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId.data)) !== null
  }
  if (input.targetType === 'reel') {
    const reelId = ReelIdSchema.safeParse(input.targetId)
    return reelId.success && (await readReelIdsInEpisode(gate.scope, gate.episode.id, [reelId.data])).size === 1
  }
  const shotId = ReelShotIdSchema.safeParse(input.targetId)
  return shotId.success && (await readShotIdsInEpisode(gate.scope, gate.episode.id, [shotId.data])).size === 1
}

/** The notes popover's `Save note` / `Remove` (an empty body). */
export const saveNote = async (projectId: string, episode: string, raw: unknown): Promise<SavedResult> => {
  const input = NoteInputSchema.safeParse(raw)
  if (!input.success) return error('A note names what it is about.')
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  if (!(await noteTargetExists(gate, input.data))) return error('A note names what it is about.')
  await appendNote(gate.scope, input.data.targetType, input.data.targetId, input.data.body)
  return { status: 'saved' }
}

/** `PUT /users/me/view-preferences/:epId`. */
export const saveViewPreferences = async (projectId: string, episode: string, raw: unknown): Promise<PreferencesResult> => {
  const patch = ViewPreferencesPatchSchema.safeParse(raw)
  if (!patch.success) return error('Those view options did not read.')
  const gate = await openEpisode(projectId, episode, ROLE.preference)
  if (isRefusal(gate)) return gate
  const preferences = await saveViewPreferencesRow(gate.scope, gate.episode.id, patch.data)
  return { status: 'saved', preferences }
}

// ---------------------------------------------------------------------------
// Uploads: the scene image, a reference
// ---------------------------------------------------------------------------

const STORAGE_OFF = 'Image storage is not set up on this server yet.'

const storeImage = async (
  scope: ProjectScope,
  projectId: string,
  kind: Asset['kind'],
  form: FormData,
  field: string,
): Promise<{ readonly ok: true; readonly asset: AssetRecord } | { readonly ok: false; readonly failure: Failure }> => {
  const image = await readImage(form.get(field), PRODUCTION_IMAGE_MAX_BYTES, kind === 'still' ? 'scene image' : 'reference')
  if (!image.ok) return { ok: false, failure: { status: image.status, message: image.message } }
  const key = `projects/${projectId}/production/${kind}/${crypto.randomUUID()}.${IMAGE_EXTENSION[image.type]}`
  const put = await putObject(key, image.bytes, image.type)
  if (!put.ok) return { ok: false, failure: error(put.message) }
  const asset = await insertAsset(scope, { kind, storageKey: key, mime: image.type, width: null, height: null, source: 'uploaded' })
  return { ok: true, asset }
}

const uploadedView = (asset: AssetRecord): Asset => {
  const { storageKey, ...rest } = asset
  return { ...rest, url: publicUrl(storageKey) }
}

/** `POST /scenes/:id/scene-image` (upload). */
export const uploadSceneImage = async (projectId: string, episode: string, rawSceneNodeId: string, form: FormData): Promise<UploadResult> => {
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  if (!storageAvailable()) return { status: 'refused', message: STORAGE_OFF }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  if ((await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId.data)) === null) return error(NOT_A_SCENE)
  const stored = await storeImage(gate.scope, gate.project.id, 'still', form, 'image')
  if (!stored.ok) return stored.failure
  await setSceneStill(gate.scope, sceneNodeId.data, stored.asset.id)
  return { status: 'saved', asset: uploadedView(stored.asset) }
}

/** The drawer's References `＋`. */
export const uploadReference = async (projectId: string, episode: string, rawShotId: string, form: FormData): Promise<UploadResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  if (!shotId.success) return error(NOT_A_SHOT)
  if (!storageAvailable()) return { status: 'refused', message: STORAGE_OFF }
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const mine = await readShotIdsInEpisode(gate.scope, gate.episode.id, [shotId.data])
  if (!mine.has(shotId.data)) return error(NOT_A_SHOT)
  const stored = await storeImage(gate.scope, gate.project.id, 'reference', form, 'image')
  if (!stored.ok) return stored.failure
  const pointed = await addShotReference(gate.scope, shotId.data, stored.asset.id)
  if (!pointed) return error(NOT_A_SHOT)
  return { status: 'saved', asset: uploadedView(stored.asset) }
}
