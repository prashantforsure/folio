'use server'

import type { Asset, AssetId, CameraMotion, NoteInput, Reel, ReelShot, ShotType } from '@folio/contracts'
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
  listStoryboardScenes,
  moveReelShot,
  patchReel as patchReelRow,
  patchShot as patchShotRow,
  readAssetRecords,
  readBoundCues,
  readDocumentByKind,
  readReel,
  readReelIdOfShot,
  readReelIdsInEpisode,
  readSceneHeader,
  readShotIdsInEpisode,
  readScreenplayNodes,
  retimeShot as retimeShotRow,
  saveViewPreferences as saveViewPreferencesRow,
  setSceneSetup as setSceneSetupRow,
  setSceneStill,
  softDeleteReel,
  softDeleteShot,
  upsertEpisodeSettings,
} from '@folio/db'
import type { CharacterId, DescriptionPart, NodeId, ShotSpec } from '@folio/script'
import { boundCueMap, parseDescription, proposeShots as proposeShotSpecs } from '@folio/script'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
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
  MovedResult,
  ReelResult,
  SavedResult,
  SettingsResult,
  ShotResult,
  UploadResult,
} from './result'
import { readCastAndPlaces } from './server'

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
 */

const NOT_A_SHOT = 'That shot is not on this board. Reload the page.'
const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'
const NOT_A_SCENE = 'That scene is not in this episode. Reload the page.'

const error = (message: string): Failure => ({ status: 'error', message })

const assetView = (map: ReadonlyMap<AssetId, AssetRecord>, id: AssetId | null): Asset | null => {
  if (id === null) return null
  const record = map.get(id)
  if (record === undefined) return null
  const { storageKey, ...rest } = record
  return { ...rest, url: publicUrl(storageKey) }
}

const shotView = (shot: ReelShotRecord, map: ReadonlyMap<AssetId, AssetRecord>): ReelShot => {
  const { frameAssetId, referenceAssetIds, ...rest } = shot
  return {
    ...rest,
    frame: assetView(map, frameAssetId),
    references: referenceAssetIds.map((id) => assetView(map, id)).filter((asset): asset is Asset => asset !== null),
  }
}

const reelView = (reel: ReelRecord, map: ReadonlyMap<AssetId, AssetRecord>): Reel => {
  const { shots, sheet, clip, ...rest } = reel
  return {
    ...rest,
    shots: shots.map((shot) => shotView(shot, map)),
    sheet:
      sheet === null
        ? null
        : {
            ...sheet,
            asset: assetView(map, sheet.assetId),
            frames: sheet.frames.map((frame) => ({ ...frame, asset: assetView(map, frame.assetId) })),
          },
    clip: clip === null ? null : { ...clip, poster: assetView(map, clip.posterAssetId), video: assetView(map, clip.videoAssetId) },
  }
}

const assetIdsOf = (reel: ReelRecord): readonly AssetId[] => [
  ...reel.shots.flatMap((shot) => [...(shot.frameAssetId === null ? [] : [shot.frameAssetId]), ...shot.referenceAssetIds]),
  ...(reel.sheet?.assetId ? [reel.sheet.assetId] : []),
  ...(reel.sheet?.frames.flatMap((frame) => (frame.assetId === null ? [] : [frame.assetId])) ?? []),
  ...(reel.clip?.posterAssetId ? [reel.clip.posterAssetId] : []),
  ...(reel.clip?.videoAssetId ? [reel.clip.videoAssetId] : []),
]

/** The record as the client's row: one asset read. */
const resolveShot = async (scope: ProjectScope, shot: ReelShotRecord): Promise<ReelShot> => {
  const ids = [...(shot.frameAssetId === null ? [] : [shot.frameAssetId]), ...shot.referenceAssetIds]
  return shotView(shot, await readAssetRecords(scope, ids))
}

const resolveReel = async (scope: ProjectScope, reelId: Reel['id']): Promise<Reel | null> => {
  const reel = await readReel(scope, reelId)
  if (reel === null) return null
  return reelView(reel, await readAssetRecords(scope, assetIdsOf(reel)))
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
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const written = await upsertEpisodeSettings(gate.scope, gate.episode.id, input.data)
  return written
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
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return error(BAD_IDEMPOTENCY_KEY)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  if ((await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId.data)) === null) return error(NOT_A_SCENE)
  const reel = await insertReel(gate.scope, sceneNodeId.data, undefined, key.key)
  return { status: 'saved', reel: reelView(reel, new Map()) }
}

/** `PATCH /reels/:id` - `name`, `clip_length_s`. */
export const patchReel = async (projectId: string, episode: string, rawReelId: unknown, raw: unknown): Promise<ReelResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  const patch = ReelPatchSchema.safeParse(raw)
  if (!reelId.success) return error(NOT_A_REEL)
  if (!patch.success) return error('A reel takes a name and one of the four clip lengths.')
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const written = await patchReelRow(gate.scope, reelId.data, patch.data)
  if (written.status === 'no-reel') return error(NOT_A_REEL)
  return { status: 'saved', reel: reelView(written.reel, await readAssetRecords(gate.scope, assetIdsOf(written.reel))) }
}

export const deleteReel = async (projectId: string, episode: string, rawReelId: unknown): Promise<DeleteReelResult> => {
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const result = await softDeleteReel(gate.scope, reelId.data)
  if (result.status === 'no-reel') return error(NOT_A_REEL)
  if (result.status === 'busy') return { status: 'busy', message: 'Something is still generating for this reel. Wait for it, or cancel it, then delete.' }
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/** `POST /reels/:id/shots` - one empty shot at the end of the reel. */
export const addShot = async (projectId: string, episode: string, raw: unknown, rawKey: unknown = null): Promise<ShotResult> => {
  const input = NewShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_REEL)
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return error(BAD_IDEMPOTENCY_KEY)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const mine = await readReelIdsInEpisode(gate.scope, gate.episode.id, [input.data.reelId])
  if (!mine.has(input.data.reelId)) return error(NOT_A_REEL)
  const description = input.data.description ?? ''
  const parts = description.length === 0 ? [] : await partsOf(gate.scope, description)
  const [shot] = await insertReelShots(
    gate.scope,
    input.data.reelId,
    [{ description, parts, durationS: input.data.durationS ?? null }],
    key.key,
  )
  if (shot === undefined) return error(NOT_A_REEL)
  return { status: 'saved', shot: shotView(shot, new Map()) }
}

/** `PATCH /shots/:id` - any field. A changed description is re-read into parts and its auto characters. */
export const patchShot = async (projectId: string, episode: string, rawShotId: unknown, raw: unknown): Promise<ShotResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  const patch = ShotPatchSchema.safeParse(raw)
  if (!shotId.success) return error(NOT_A_SHOT)
  if (!patch.success) return error('That edit did not read. Reload the page.')
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const mine = await readShotIdsInEpisode(gate.scope, gate.episode.id, [shotId.data])
  if (!mine.has(shotId.data)) return error(NOT_A_SHOT)
  const parts = patch.data.description === undefined ? null : await partsOf(gate.scope, patch.data.description)
  const written = await patchShotRow(gate.scope, shotId.data, patch.data, parts)
  if (written.status === 'no-shot') return error(NOT_A_SHOT)
  return { status: 'saved', shot: await resolveShot(gate.scope, written.shot) }
}

/** `PATCH /shots/bulk` - the bulk bar. */
export const bulkPatchShots = async (projectId: string, episode: string, raw: unknown): Promise<BulkResult> => {
  const input = BulkPatchSchema.safeParse(raw)
  if (!input.success) return error('Pick at least one shot and one change.')
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  // Distinct, because the schema does not dedupe and a repeated id would
  // otherwise refuse a selection that is entirely this episode's.
  const asked = new Set(input.data.ids)
  const mine = await readShotIdsInEpisode(gate.scope, gate.episode.id, [...asked])
  if (mine.size !== asked.size) return error(NOT_A_SHOT)
  const changed = await bulkPatchShotRows(gate.scope, input.data)
  return { status: 'saved', changed }
}

/** `POST /shots/:id/move { reel_id, before_id }` - within or across reels. Answers with the reels touched; the client keeps the order it drew. */
export const moveShot = async (projectId: string, episode: string, raw: unknown): Promise<MovedResult> => {
  const input = MoveShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_SHOT)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const moved = await moveReelShot(gate.scope, input.data.shotId, input.data.reelId, input.data.beforeId)
  if (moved.status === 'no-shot') return error(NOT_A_SHOT)
  if (moved.status === 'no-reel') return error(NOT_A_REEL)
  return { status: 'saved', reelIds: moved.reelIds }
}

/** The timing bar's drag. The spec's clamp is re-applied here against the reel as stored. */
export const retimeShot = async (projectId: string, episode: string, raw: unknown): Promise<ReelResult> => {
  const input = RetimeShotSchema.safeParse(raw)
  if (!input.success) return error('A shot is between 1 and 15 seconds.')
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const reelId = await readReelIdOfShot(gate.scope, input.data.shotId)
  if (reelId === null) return error(NOT_A_SHOT)
  const reel = await readReel(gate.scope, reelId)
  if (reel === null) return error(NOT_A_REEL)
  const seconds = clampRetime(reel, input.data.shotId, input.data.durationS)
  const written = await retimeShotRow(gate.scope, input.data.shotId, seconds)
  if (written.status === 'no-shot') return error(NOT_A_SHOT)
  const full = await resolveReel(gate.scope, reel.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
}

/** `DELETE /shots/:id`. The reel comes back renumbered. */
export const deleteShot = async (projectId: string, episode: string, rawShotId: unknown): Promise<ReelResult> => {
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  if (!shotId.success) return error(NOT_A_SHOT)
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const reel = await softDeleteShot(gate.scope, shotId.data)
  if (reel === null) return error(NOT_A_SHOT)
  return { status: 'saved', reel: reelView(reel, await readAssetRecords(gate.scope, assetIdsOf(reel))) }
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
  const gate = await openEpisode(projectId, episode, ROLE.productionEdit)
  if (isRefusal(gate)) return gate
  const { scope } = gate
  const [scene, document, present] = await Promise.all([
    readSceneHeader(scope, gate.episode.id, sceneNodeId.data),
    readDocumentByKind(scope, gate.episode.id, 'screenplay'),
    listStoryboardScenes(scope, gate.episode.id),
  ])
  if (scene === null) return error(NOT_A_SCENE)
  if (document === null) return error('This episode has no script to read.')
  const [read, bound, { names }] = await Promise.all([readScreenplayNodes(scope, document.id), readBoundCues(scope), readCastAndPlaces(scope)])
  if (!read.ok) return error(`The script would not read at ${read.error.at || 'a node'}: ${read.error.reason.kind}.`)
  const nodes = read.value.map((entry) => entry.node)
  const sceneNodes = cutScene(nodes, scene.sceneNodeId, new Set(present.map((header) => header.sceneNodeId as string)))
  if (sceneNodes.length === 0) return error(NOT_A_SCENE)
  const specs = proposeShotSpecs({ reading: scene.reading, nodes: sceneNodes, boundCues: boundCueMap(bound), locationId: scene.locationId })
  const nameOf = new Map(names.map((name) => [name.id, name.name]))
  const target = reelId === null ? await insertReel(scope, scene.sceneNodeId as NodeId) : await readReel(scope, reelId.data)
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
  const full = await resolveReel(scope, target.id)
  return full === null ? error(NOT_A_REEL) : { status: 'saved', reel: full }
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
