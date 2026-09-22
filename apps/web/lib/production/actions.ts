'use server'

import type { Asset, CameraMotion, ProductionScene, Reel, ReelShot, ShotType } from '@folio/contracts'
import {
  BulkPatchSchema,
  MoveShotSchema,
  NewShotSchema,
  NodeIdSchema,
  NoteInputSchema,
  PRODUCTION_IMAGE_MAX_BYTES,
  ReelIdSchema,
  ReelPatchSchema,
  ReelShotIdSchema,
  RetimeShotSchema,
  SceneSetupPatchSchema,
  SettingsInputSchema,
  ShotPatchSchema,
  ViewPreferencesPatchSchema,
} from '@folio/contracts'
import type { AssetRecord, ProjectScope, ReelRecord, ReelShotRecord } from '@folio/db'
import {
  addShotReference,
  appendNote,
  bulkPatchShots as bulkPatchShotRows,
  insertAsset,
  insertReel,
  insertReelShots,
  moveReelShot,
  patchReel as patchReelRow,
  patchShot as patchShotRow,
  readProductionEpisode,
  readReel,
  readBoundCues,
  readDocumentByKind,
  readScreenplayNodes,
  retimeShot as retimeShotRow,
  saveViewPreferences as saveViewPreferencesRow,
  setSceneSetup as setSceneSetupRow,
  setSceneStill,
  softDeleteReel,
  softDeleteShot,
  upsertEpisodeSettings,
} from '@folio/db'
import type { CharacterId, DescriptionPart, ShotSpec } from '@folio/script'
import { boundCueMap, parseDescription, proposeShots as proposeShotSpecs } from '@folio/script'
import { revalidatePath } from 'next/cache'

import { isRefusal, openEpisode } from '../script/gate'
import type { EpisodeGate } from '../script/gate'
import { IMAGE_EXTENSION, readImage } from '../storage/image'
import { publicUrl, putObject, storageAvailable } from '../storage/r2'
import { cutScene } from '../storyboard/scene-cut'
import { clampRetime } from './derive'
import type {
  BulkResult,
  DeleteReelResult,
  Failure,
  PreferencesResult,
  ReelResult,
  ReelsResult,
  SavedResult,
  SettingsResult,
  ShotResult,
  UploadResult,
} from './result'
import { composeScenes, readCastAndPlaces } from './server'

/**
 * The Production route's writes - `docs/production/production.md` §7,
 * "Suggested endpoints", as server actions (the client's ruling,
 * 2026-09-22: every gate is enforced here and the result carries what an
 * HTTP status would have). The generate actions - sheet, scene image,
 * frames, shotlist, shoot, cancel - are `generate.ts`; this file is the
 * authoring surface.
 *
 * Every action: zod first, then the gate (`openEpisode` - identity,
 * membership, the episode), then one repository call, then
 * `revalidatePath` for the route. Results are discriminated (`result.ts`).
 * Membership, not role, as everywhere.
 */

const productionPath = (projectId: string): string => `/app/project/${projectId}`

const NOT_A_SHOT = 'That shot is not on this board. Reload the page.'
const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'
const NOT_A_SCENE = 'That scene is not in this episode. Reload the page.'

const error = (message: string): Failure => ({ status: 'error', message })

/** A shot record with its assets resolved - what the client holds. */
const shotOf = async (scope: ProjectScope, episodeId: EpisodeGate['episode']['id'], shot: ReelShotRecord): Promise<ReelShot> => {
  const scenes = await scenesOf(scope, episodeId)
  for (const scene of scenes) for (const reel of scene.reels) for (const candidate of reel.shots) if (candidate.id === shot.id) return candidate
  // The row exists but its scene is not present: hand back the record with nothing resolved.
  const { frameAssetId: _frame, referenceAssetIds: _refs, ...rest } = shot
  return { ...rest, frame: null, references: [] }
}

const reelOf = async (scope: ProjectScope, episodeId: EpisodeGate['episode']['id'], reelId: ReelRecord['id']): Promise<Reel | null> => {
  const scenes = await scenesOf(scope, episodeId)
  for (const scene of scenes) for (const reel of scene.reels) if (reel.id === reelId) return reel
  return null
}

const scenesOf = async (scope: ProjectScope, episodeId: EpisodeGate['episode']['id']): Promise<readonly ProductionScene[]> => {
  const [record, { cast, locations }] = await Promise.all([readProductionEpisode(scope, episodeId), readCastAndPlaces(scope)])
  return composeScenes(record, cast, locations)
}

const partsOf = async (scope: ProjectScope, description: string): Promise<readonly DescriptionPart[]> => {
  const { names } = await readCastAndPlaces(scope)
  return parseDescription(description, names)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** `PUT /episodes/:id/settings` - refused once `locked_at` is set. */
export const saveSettings = async (projectId: string, episode: string, raw: unknown): Promise<SettingsResult> => {
  const input = SettingsInputSchema.safeParse(raw)
  if (!input.success) return error('The settings did not read. Pick one option in each group.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const written = await upsertEpisodeSettings(gate.scope, gate.episode.id, input.data)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return written
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

export const addReel = async (projectId: string, episode: string, rawSceneNodeId: unknown): Promise<ReelResult> => {
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const scenes = await scenesOf(gate.scope, gate.episode.id)
  if (!scenes.some((scene) => scene.sceneNodeId === sceneNodeId.data)) return error(NOT_A_SCENE)
  const reel = await insertReel(gate.scope, sceneNodeId.data)
  revalidatePath(productionPath(gate.project.id), 'layout')
  const full = await reelOf(gate.scope, gate.episode.id, reel.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

/** `PATCH /reels/:id` - `name`, `clip_length_s`. */
export const patchReel = async (projectId: string, episode: string, rawReelId: unknown, raw: unknown): Promise<ReelResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  const patch = ReelPatchSchema.safeParse(raw)
  if (!reelId.success) return error(NOT_A_REEL)
  if (!patch.success) return error('A reel takes a name and one of the four clip lengths.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const written = await patchReelRow(gate.scope, reelId.data, patch.data)
  if (written.status === 'no-reel') return error(NOT_A_REEL)
  revalidatePath(productionPath(gate.project.id), 'layout')
  const full = await reelOf(gate.scope, gate.episode.id, reelId.data)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

export const deleteReel = async (projectId: string, episode: string, rawReelId: unknown): Promise<DeleteReelResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const result = await softDeleteReel(gate.scope, reelId.data)
  if (result.status === 'no-reel') return error(NOT_A_REEL)
  if (result.status === 'busy') return { status: 'busy', message: 'Something is still generating for this reel. Wait for it, or cancel it, then delete.' }
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/** `POST /reels/:id/shots` - one empty shot at the end of the reel. */
export const addShot = async (projectId: string, episode: string, raw: unknown): Promise<ShotResult> => {
  const input = NewShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_REEL)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const reel = await readReel(gate.scope, input.data.reelId)
  if (reel === null) return error(NOT_A_REEL)
  const description = input.data.description ?? ''
  const parts = await partsOf(gate.scope, description)
  const [shot] = await insertReelShots(gate.scope, reel.id, [{ description, parts, durationS: input.data.durationS ?? null }])
  if (shot === undefined) return error(NOT_A_SHOT)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved', shot: await shotOf(gate.scope, gate.episode.id, shot) }
}

/** `PATCH /shots/:id` - any field. A changed description is re-read into parts and its auto characters. */
export const patchShot = async (projectId: string, episode: string, rawShotId: unknown, raw: unknown): Promise<ShotResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  const patch = ShotPatchSchema.safeParse(raw)
  if (!shotId.success) return error(NOT_A_SHOT)
  if (!patch.success) return error('That edit did not read. Reload the page.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const parts = patch.data.description === undefined ? null : await partsOf(gate.scope, patch.data.description)
  const written = await patchShotRow(gate.scope, shotId.data, patch.data, parts)
  if (written.status === 'no-shot') return error(NOT_A_SHOT)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved', shot: await shotOf(gate.scope, gate.episode.id, written.shot) }
}

/** `PATCH /shots/bulk` - the bulk bar. */
export const bulkPatchShots = async (projectId: string, episode: string, raw: unknown): Promise<BulkResult> => {
  const input = BulkPatchSchema.safeParse(raw)
  if (!input.success) return error('Pick at least one shot and one change.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const changed = await bulkPatchShotRows(gate.scope, input.data)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved', changed }
}

/** `POST /shots/:id/move { reel_id, before_id }` - within or across reels. */
export const moveShot = async (projectId: string, episode: string, raw: unknown): Promise<ReelsResult> => {
  const input = MoveShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_SHOT)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const moved = await moveReelShot(gate.scope, input.data.shotId, input.data.reelId, input.data.beforeId)
  if (moved.status === 'no-shot') return error(NOT_A_SHOT)
  if (moved.status === 'no-reel') return error(NOT_A_REEL)
  revalidatePath(productionPath(gate.project.id), 'layout')
  const scenes = await scenesOf(gate.scope, gate.episode.id)
  const ids = new Set(moved.reels.map((reel) => reel.id))
  return { status: 'saved', reels: scenes.flatMap((scene) => scene.reels.filter((reel) => ids.has(reel.id))) }
}

/** The timing bar's drag. The spec's clamp is re-applied here against the reel as stored. */
export const retimeShot = async (projectId: string, episode: string, raw: unknown): Promise<ReelResult> => {
  const input = RetimeShotSchema.safeParse(raw)
  if (!input.success) return error('A shot is between 1 and 15 seconds.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const scenes = await scenesOf(gate.scope, gate.episode.id)
  const reel = scenes.flatMap((scene) => scene.reels).find((candidate) => candidate.shots.some((shot) => shot.id === input.data.shotId))
  if (reel === undefined) return error(NOT_A_SHOT)
  const seconds = clampRetime(reel, input.data.shotId, input.data.durationS)
  const written = await retimeShotRow(gate.scope, input.data.shotId, seconds)
  if (written.status === 'no-shot') return error(NOT_A_SHOT)
  revalidatePath(productionPath(gate.project.id), 'layout')
  const full = await reelOf(gate.scope, gate.episode.id, reel.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

/** `DELETE /shots/:id`. The reel comes back renumbered. */
export const deleteShot = async (projectId: string, episode: string, rawShotId: unknown): Promise<ReelResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  if (!shotId.success) return error(NOT_A_SHOT)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const reel = await softDeleteShot(gate.scope, shotId.data)
  if (reel === null) return error(NOT_A_SHOT)
  revalidatePath(productionPath(gate.project.id), 'layout')
  const full = await reelOf(gate.scope, gate.episode.id, reel.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

// ---------------------------------------------------------------------------
// Propose shots (rule-based, free)
// ---------------------------------------------------------------------------

const SIZE_TO_TYPE: Readonly<Record<ShotSpec['size'], ShotType>> = {
  ews: 'Wide angle',
  ws: 'Wide angle',
  mws: 'Medium',
  ms: 'Medium',
  mcu: 'Close-up',
  cu: 'Close-up',
  ecu: 'Close-up',
  ots: 'Over',
  insert: 'Close-up',
}

const MOVEMENT_TO_MOTION: Readonly<Record<ShotSpec['movement'], CameraMotion>> = {
  static: 'Still',
  handheld: 'Handheld',
  pan: 'Pan',
  tilt: 'Tilt',
  dolly: 'Dolly',
  track: 'Track',
  crane: 'Crane',
  steadicam: 'Follow',
  zoom: 'Zoom',
}

const ANGLE_LABEL: Readonly<Record<ShotSpec['angle'], string>> = {
  eye_level: 'Eye level',
  low: 'Low',
  high: 'High',
  dutch: 'Dutch',
  overhead: 'Overhead',
  pov: 'POV',
}

/** The pure core's inline content as the description text: a mention becomes `@Name`. */
const specText = (spec: ShotSpec, names: ReadonlyMap<CharacterId, string>): string =>
  spec.description
    .map((run) => (run.kind === 'text' ? run.text : run.target.entity === 'character' ? `@${names.get(run.target.id) ?? 'someone'}` : ''))
    .join('')

/**
 * `POST /scenes/:id/propose-shots` - the pure core's rule-based proposer
 * (`@folio/script`, `proposeShots`) over the scene's lines, written as
 * `proposed` shots into a new reel (the empty scene's `✦ Propose shots
 * from the scene`) or the reel given (`✦ AI Shotlist` without a model key
 * falls back to this). Free, by the client's ruling.
 */
export const proposeShots = async (projectId: string, episode: string, rawSceneNodeId: unknown, rawReelId: unknown): Promise<ReelResult> => {
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const reelId = rawReelId === null ? null : ReelIdSchema.safeParse(rawReelId)
  if (reelId !== null && !reelId.success) return error(NOT_A_REEL)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const { scope } = gate
  const scenes = await scenesOf(scope, gate.episode.id)
  const scene = scenes.find((candidate) => candidate.sceneNodeId === sceneNodeId.data)
  if (scene === undefined) return error(NOT_A_SCENE)
  const document = await readDocumentByKind(scope, gate.episode.id, 'screenplay')
  if (document === null) return error('This episode has no script to read.')
  const [read, bound, { names }] = await Promise.all([readScreenplayNodes(scope, document.id), readBoundCues(scope), readCastAndPlaces(scope)])
  if (!read.ok) return error(`The script would not read at ${read.error.at || 'a node'}: ${read.error.reason.kind}.`)
  const nodes = read.value.map((entry) => entry.node)
  const sceneNodes = cutScene(nodes, scene.sceneNodeId, new Set(scenes.map((candidate) => candidate.sceneNodeId as string)))
  if (sceneNodes.length === 0) return error(NOT_A_SCENE)
  const record = await readProductionEpisode(scope, gate.episode.id)
  const header = record.scenes.find((candidate) => candidate.sceneNodeId === scene.sceneNodeId)
  const specs = proposeShotSpecs({
    reading: header?.reading ?? null,
    nodes: sceneNodes,
    boundCues: boundCueMap(bound),
    locationId: scene.locationId,
  })
  const nameOf = new Map(names.map((name) => [name.id, name.name]))
  const target = reelId === null ? await insertReel(scope, scene.sceneNodeId) : await readReel(scope, reelId.data)
  if (target === null) return error(NOT_A_REEL)
  await insertReelShots(
    scope,
    target.id,
    specs.map((spec) => {
      const text = specText(spec, nameOf)
      return {
        description: text,
        parts: parseDescription(text, names),
        durationS: spec.durationSeconds === null ? null : Math.max(1, Math.min(15, Math.round(spec.durationSeconds))),
        shotType: SIZE_TO_TYPE[spec.size],
        cameraAngle: ANGLE_LABEL[spec.angle],
        cameraMotion: MOVEMENT_TO_MOTION[spec.movement],
        lens: spec.lensMm === null ? '' : `${String(spec.lensMm)}mm`,
        proposed: true,
      }
    }),
  )
  revalidatePath(productionPath(gate.project.id), 'layout')
  const full = await reelOf(scope, gate.episode.id, target.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

// ---------------------------------------------------------------------------
// Scene setup, notes, preferences
// ---------------------------------------------------------------------------

export const setSceneSetup = async (projectId: string, episode: string, raw: unknown): Promise<SavedResult> => {
  const patch = SceneSetupPatchSchema.safeParse(raw)
  if (!patch.success) return error(NOT_A_SCENE)
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const scenes = await scenesOf(gate.scope, gate.episode.id)
  if (!scenes.some((scene) => scene.sceneNodeId === patch.data.sceneNodeId)) return error(NOT_A_SCENE)
  await setSceneSetupRow(gate.scope, patch.data)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/** The notes popover's `Save note` / `Remove` (an empty body). */
export const saveNote = async (projectId: string, episode: string, raw: unknown): Promise<SavedResult> => {
  const input = NoteInputSchema.safeParse(raw)
  if (!input.success) return error('A note names what it is about.')
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  await appendNote(gate.scope, input.data.targetType, input.data.targetId, input.data.body)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved' }
}

/** `PUT /users/me/view-preferences/:epId`. */
export const saveViewPreferences = async (projectId: string, episode: string, raw: unknown): Promise<PreferencesResult> => {
  const patch = ViewPreferencesPatchSchema.safeParse(raw)
  if (!patch.success) return error('Those view options did not read.')
  const gate = await openEpisode(projectId, episode)
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

const assetView = (asset: AssetRecord): Asset => {
  const { storageKey, ...rest } = asset
  return { ...rest, url: publicUrl(storageKey) }
}

/** `POST /scenes/:id/scene-image` (upload). */
export const uploadSceneImage = async (projectId: string, episode: string, rawSceneNodeId: string, form: FormData): Promise<UploadResult> => {
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  if (!storageAvailable()) return { status: 'refused', message: STORAGE_OFF }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const scenes = await scenesOf(gate.scope, gate.episode.id)
  if (!scenes.some((scene) => scene.sceneNodeId === sceneNodeId.data)) return error(NOT_A_SCENE)
  const stored = await storeImage(gate.scope, gate.project.id, 'still', form, 'image')
  if (!stored.ok) return stored.failure
  await setSceneStill(gate.scope, sceneNodeId.data, stored.asset.id)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved', asset: assetView(stored.asset) }
}

/** The drawer's References `＋`. */
export const uploadReference = async (projectId: string, episode: string, rawShotId: string, form: FormData): Promise<UploadResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  if (!shotId.success) return error(NOT_A_SHOT)
  if (!storageAvailable()) return { status: 'refused', message: STORAGE_OFF }
  const gate = await openEpisode(projectId, episode)
  if (isRefusal(gate)) return gate
  const stored = await storeImage(gate.scope, gate.project.id, 'reference', form, 'image')
  if (!stored.ok) return stored.failure
  const pointed = await addShotReference(gate.scope, shotId.data, stored.asset.id)
  if (!pointed) return error(NOT_A_SHOT)
  revalidatePath(productionPath(gate.project.id), 'layout')
  return { status: 'saved', asset: assetView(stored.asset) }
}

