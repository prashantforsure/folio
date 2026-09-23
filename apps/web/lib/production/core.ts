import type { Asset, AssetId, CameraMotion, Reel, ReelShot, ShotType } from '@folio/contracts'
import {
  BulkPatchSchema,
  MoveShotSchema,
  NewShotSchema,
  NodeIdSchema,
  ReelIdSchema,
  ReelPatchSchema,
  ReelShotIdSchema,
  RetimeShotSchema,
  SettingsInputSchema,
  ShotPatchSchema,
} from '@folio/contracts'
import type { AssetRecord, ProjectScope, ReelRecord, ReelShotRecord } from '@folio/db'
import {
  bulkPatchShots as bulkPatchShotRows,
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
  softDeleteReel,
  softDeleteShot,
  upsertEpisodeSettings,
} from '@folio/db'
import type { CharacterId, DescriptionPart, NodeId, ShotSpec } from '@folio/script'
import { boundCueMap, parseDescription, proposeShots as proposeShotSpecs } from '@folio/script'

import { ROLE } from '../auth/roles'
import { BAD_IDEMPOTENCY_KEY, idempotencyKeyOf } from '../idempotency'
import type { EpisodeGate } from '../script/actor-gate'
import { roleRefusal } from '../script/actor-gate'
import { publicUrl } from '../storage/r2'
import { cutScene } from '../storyboard/scene-cut'
import { clampRetime } from './derive'
import type { BulkResult, DeleteReelResult, Failure, MovedResult, ReelResult, SettingsResult, ShotResult } from './result'
import { readCastAndPlaces } from './server'

/**
 * The Production route's authoring writes as **core functions** - roadmap
 * task 4.2.
 *
 * Each takes an episode gate already opened and the raw input its action
 * takes, checks the role itself (`ROLE.productionEdit`) and does everything the
 * action did after its gate, including the per-row episode checks
 * (`readReelIdsInEpisode` / `readShotIdsInEpisode`) that `actions.ts`'s header
 * explains. The actions open the cookie gate and call these; the agent's
 * Production tools and the worker call them with a gate of their own.
 */

export const NOT_A_SHOT = 'That shot is not on this board. Reload the page.'
export const NOT_A_REEL = 'That reel is not in this episode. Reload the page.'
export const NOT_A_SCENE = 'That scene is not in this episode. Reload the page.'

export const error = (message: string): Failure => ({ status: 'error', message })

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

export const settingsProblem = (raw: unknown): Failure | null =>
  SettingsInputSchema.safeParse(raw).success ? null : error('The settings did not read. Pick one option in each group.')

/** `PUT /episodes/:id/settings` - refused once `locked_at` is set. */
export const saveSettingsWith = async (gate: EpisodeGate, raw: unknown): Promise<SettingsResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = SettingsInputSchema.safeParse(raw)
  if (!input.success) return error('The settings did not read. Pick one option in each group.')
  return upsertEpisodeSettings(gate.scope, gate.episode.id, input.data)
}

// ---------------------------------------------------------------------------
// Reels
// ---------------------------------------------------------------------------

export const addReelProblem = (rawSceneNodeId: unknown, rawKey: unknown): Failure | null => {
  if (!NodeIdSchema.safeParse(rawSceneNodeId).success) return error(NOT_A_SCENE)
  if (!idempotencyKeyOf(rawKey).ok) return error(BAD_IDEMPOTENCY_KEY)
  return null
}

export const addReelWith = async (gate: EpisodeGate, rawSceneNodeId: unknown, rawKey: unknown = null): Promise<ReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return error(BAD_IDEMPOTENCY_KEY)
  if ((await readSceneHeader(gate.scope, gate.episode.id, sceneNodeId.data)) === null) return error(NOT_A_SCENE)
  const reel = await insertReel(gate.scope, sceneNodeId.data, undefined, key.key)
  return { status: 'saved', reel: reelView(reel, new Map()) }
}

export const patchReelProblem = (rawReelId: unknown, raw: unknown): Failure | null => {
  if (!ReelIdSchema.safeParse(rawReelId).success) return error(NOT_A_REEL)
  if (!ReelPatchSchema.safeParse(raw).success) return error('A reel takes a name and one of the four clip lengths.')
  return null
}

/** `PATCH /reels/:id` - `name`, `clip_length_s`. */
export const patchReelWith = async (gate: EpisodeGate, rawReelId: unknown, raw: unknown): Promise<ReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const reelId = ReelIdSchema.safeParse(rawReelId)
  const patch = ReelPatchSchema.safeParse(raw)
  if (!reelId.success) return error(NOT_A_REEL)
  if (!patch.success) return error('A reel takes a name and one of the four clip lengths.')
  const written = await patchReelRow(gate.scope, reelId.data, patch.data)
  if (written.status === 'no-reel') return error(NOT_A_REEL)
  return { status: 'saved', reel: reelView(written.reel, await readAssetRecords(gate.scope, assetIdsOf(written.reel))) }
}

export const deleteReelWith = async (gate: EpisodeGate, rawReelId: unknown): Promise<DeleteReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const reelId = ReelIdSchema.safeParse(rawReelId)
  if (!reelId.success) return error(NOT_A_REEL)
  const result = await softDeleteReel(gate.scope, reelId.data)
  if (result.status === 'no-reel') return error(NOT_A_REEL)
  if (result.status === 'busy') return { status: 'busy', message: 'Something is still generating for this reel. Wait for it, or cancel it, then delete.' }
  return { status: 'deleted' }
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export const addShotProblem = (raw: unknown, rawKey: unknown): Failure | null => {
  if (!NewShotSchema.safeParse(raw).success) return error(NOT_A_REEL)
  if (!idempotencyKeyOf(rawKey).ok) return error(BAD_IDEMPOTENCY_KEY)
  return null
}

/** `POST /reels/:id/shots` - one empty shot at the end of the reel. */
export const addShotWith = async (gate: EpisodeGate, raw: unknown, rawKey: unknown = null): Promise<ShotResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = NewShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_REEL)
  const key = idempotencyKeyOf(rawKey)
  if (!key.ok) return error(BAD_IDEMPOTENCY_KEY)
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

export const patchShotProblem = (rawShotId: unknown, raw: unknown): Failure | null => {
  if (!ReelShotIdSchema.safeParse(rawShotId).success) return error(NOT_A_SHOT)
  if (!ShotPatchSchema.safeParse(raw).success) return error('That edit did not read. Reload the page.')
  return null
}

/** `PATCH /shots/:id` - any field. A changed description is re-read into parts and its auto characters. */
export const patchShotWith = async (gate: EpisodeGate, rawShotId: unknown, raw: unknown): Promise<ShotResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  const patch = ShotPatchSchema.safeParse(raw)
  if (!shotId.success) return error(NOT_A_SHOT)
  if (!patch.success) return error('That edit did not read. Reload the page.')
  const mine = await readShotIdsInEpisode(gate.scope, gate.episode.id, [shotId.data])
  if (!mine.has(shotId.data)) return error(NOT_A_SHOT)
  const parts = patch.data.description === undefined ? null : await partsOf(gate.scope, patch.data.description)
  const written = await patchShotRow(gate.scope, shotId.data, patch.data, parts)
  if (written.status === 'no-shot') return error(NOT_A_SHOT)
  return { status: 'saved', shot: await resolveShot(gate.scope, written.shot) }
}

export const bulkProblem = (raw: unknown): Failure | null => (BulkPatchSchema.safeParse(raw).success ? null : error('Pick at least one shot and one change.'))

/** `PATCH /shots/bulk` - the bulk bar. */
export const bulkPatchShotsWith = async (gate: EpisodeGate, raw: unknown): Promise<BulkResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = BulkPatchSchema.safeParse(raw)
  if (!input.success) return error('Pick at least one shot and one change.')
  // Distinct, because the schema does not dedupe and a repeated id would
  // otherwise refuse a selection that is entirely this episode's.
  const asked = new Set(input.data.ids)
  const mine = await readShotIdsInEpisode(gate.scope, gate.episode.id, [...asked])
  if (mine.size !== asked.size) return error(NOT_A_SHOT)
  const changed = await bulkPatchShotRows(gate.scope, input.data)
  return { status: 'saved', changed }
}

export const moveProblem = (raw: unknown): Failure | null => (MoveShotSchema.safeParse(raw).success ? null : error(NOT_A_SHOT))

/** `POST /shots/:id/move { reel_id, before_id }` - within or across reels. Answers with the reels touched. */
export const moveShotWith = async (gate: EpisodeGate, raw: unknown): Promise<MovedResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = MoveShotSchema.safeParse(raw)
  if (!input.success) return error(NOT_A_SHOT)
  const moved = await moveReelShot(gate.scope, input.data.shotId, input.data.reelId, input.data.beforeId)
  if (moved.status === 'no-shot') return error(NOT_A_SHOT)
  if (moved.status === 'no-reel') return error(NOT_A_REEL)
  return { status: 'saved', reelIds: moved.reelIds }
}

export const retimeProblem = (raw: unknown): Failure | null => (RetimeShotSchema.safeParse(raw).success ? null : error('A shot is between 1 and 15 seconds.'))

/** The timing bar's drag. The spec's clamp is re-applied here against the reel as stored. */
export const retimeShotWith = async (gate: EpisodeGate, raw: unknown): Promise<ReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const input = RetimeShotSchema.safeParse(raw)
  if (!input.success) return error('A shot is between 1 and 15 seconds.')
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

export const shotIdProblem = (rawShotId: unknown): Failure | null => (ReelShotIdSchema.safeParse(rawShotId).success ? null : error(NOT_A_SHOT))

/** `DELETE /shots/:id`. The reel comes back renumbered. */
export const deleteShotWith = async (gate: EpisodeGate, rawShotId: unknown): Promise<ReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const shotId = ReelShotIdSchema.safeParse(rawShotId)
  if (!shotId.success) return error(NOT_A_SHOT)
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

export const proposeShotsProblem = (rawSceneNodeId: unknown, rawReelId: unknown): Failure | null => {
  if (!NodeIdSchema.safeParse(rawSceneNodeId).success) return error(NOT_A_SCENE)
  if (rawReelId !== null && !ReelIdSchema.safeParse(rawReelId).success) return error(NOT_A_REEL)
  return null
}

/**
 * `POST /scenes/:id/propose-shots` - the pure core's rule-based proposer over
 * the scene's lines, written as `proposed` shots into a new reel or the reel
 * given. Free, by the client's ruling.
 */
export const proposeShotsWith = async (gate: EpisodeGate, rawSceneNodeId: unknown, rawReelId: unknown): Promise<ReelResult> => {
  const refused = roleRefusal(gate, ROLE.productionEdit)
  if (refused !== null) return refused
  const sceneNodeId = NodeIdSchema.safeParse(rawSceneNodeId)
  if (!sceneNodeId.success) return error(NOT_A_SCENE)
  const reelId = rawReelId === null ? null : ReelIdSchema.safeParse(rawReelId)
  if (reelId !== null && !reelId.success) return error(NOT_A_REEL)
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
