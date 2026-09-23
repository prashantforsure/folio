import type { Asset, CameraMotion, GenerationTarget, ProductionGenerationId, Reel, ShotType } from '@folio/contracts'
import { CAMERA_MOTIONS, SHOT_TYPES } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'
import { failGeneration, insertAsset, insertReelShots, progressGeneration, refuseGeneration, resumeGeneration, setLocationPhotoKey, succeedGeneration } from '@folio/db'
import type { CharacterId, LocationId } from '@folio/script'
import { parseDescription } from '@folio/script'

import { sheetCameraNote, sheetHeading } from '../camera'
import { shotClocks } from '../derive'
import { deleteObject, putObject } from '../../storage/r2'
import { generateImage, generateText, generateVideo } from './gemini'
import type { ModelOutcome } from './gemini'
import { parseShotlist } from './shotlist'
import type { GenerationSpec } from './spec'

/**
 * Run one generation - on the worker since roadmap task 4.3, as its
 * `production_generation` job (`lib/worker/production-generation.ts`); it ran
 * in `after()` inside the request that created the row until then. The row
 * already exists in `queued` with its credits held; this moves it:
 * `resumeGeneration` (a retried job picks up a `running` row) → the provider
 * → the output stored in R2 as an asset → `succeedGeneration` with the
 * job's outcome, or `refuseGeneration` / `failGeneration`, each of which
 * closes the reservation. Whatever throws lands in `failed` with its
 * message, so a row never stays `running` for a provider that died.
 *
 * The page polls while a generation is live (`polling.tsx`), so the
 * state changes here reach the screen without realtime.
 */

const EXTENSION: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const store = async (
  scope: ProjectScope,
  kind: Asset['kind'],
  bytes: Uint8Array,
  mime: string,
): Promise<{ readonly ok: true; readonly id: Asset['id'] } | { readonly ok: false; readonly message: string }> => {
  const key = `projects/${scope.projectId}/production/${kind}/${crypto.randomUUID()}.${EXTENSION[mime] ?? 'bin'}`
  const put = await putObject(key, bytes, mime)
  if (!put.ok) return { ok: false, message: put.message }
  const asset = await insertAsset(scope, { kind, storageKey: key, mime, width: null, height: null, source: 'generated' })
  return { ok: true, id: asset.id }
}

const settle = async (scope: ProjectScope, id: ProductionGenerationId, outcome: ModelOutcome<unknown>): Promise<boolean> => {
  if (outcome.ok) return true
  if (outcome.kind === 'refused') await refuseGeneration(scope, id, outcome.reason)
  else await failGeneration(scope, id, outcome.message)
  return false
}

export type RunInput = {
  readonly scope: ProjectScope
  readonly id: ProductionGenerationId
  readonly spec: GenerationSpec
  /** The reel a sheet or a shotlist is for; `null` for any other job. */
  readonly reel: Reel | null
  /** The cast's names, for reading a shotlist's descriptions into parts. */
  readonly names: readonly { readonly id: CharacterId; readonly name: string }[]
  /** What the generation is for, as its row names it - the record a plate or a look is stored on. */
  readonly target?: { readonly type: GenerationTarget; readonly id: string }
  /** Aborted when the writer cancels: the provider call stops. */
  readonly signal?: AbortSignal
}

const asShotType = (value: string): ShotType => (SHOT_TYPES as readonly string[]).includes(value) ? (value as ShotType) : 'Medium'
const asMotion = (value: string): CameraMotion => (CAMERA_MOTIONS as readonly string[]).includes(value) ? (value as CameraMotion) : 'Still'

export const runGeneration = async (input: RunInput): Promise<void> => {
  const { scope, id, spec, signal } = input
  try {
    const generation = await resumeGeneration(scope, id)
    if (generation === null) return
    const model = spec.route
    if (model === null) {
      await failGeneration(scope, id, 'No model is registered for this job.')
      return
    }
    switch (spec.job) {
      case 'storyboard_sheet': {
        if (input.reel === null) return void (await failGeneration(scope, id, 'The reel is gone.'))
        const out = await generateImage(model, spec, signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const stored = await store(scope, 'sheet', out.value.bytes, out.value.mime)
        if (!stored.ok) return void (await failGeneration(scope, id, stored.message))
        const clocks = shotClocks(input.reel)
        await succeedGeneration(scope, id, {
          job: 'storyboard_sheet',
          asset: stored.id,
          artStyleId: null,
          frames: input.reel.shots.map((shot, index) => {
            const clock = clocks.find((entry) => entry.shotId === shot.id)
            return { shotId: shot.id, heading: sheetHeading(index, shot), cameraNote: sheetCameraNote(shot), timeFromS: clock?.from ?? 0, timeToS: clock?.to ?? 0 }
          }),
        })
        return
      }
      case 'scene_image': {
        const out = await generateImage(model, spec, signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const stored = await store(scope, 'still', out.value.bytes, out.value.mime)
        if (!stored.ok) return void (await failGeneration(scope, id, stored.message))
        await succeedGeneration(scope, id, { job: 'scene_image', asset: stored.id })
        return
      }
      case 'shot_frame': {
        const out = await generateImage(model, spec, signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const stored = await store(scope, 'frame', out.value.bytes, out.value.mime)
        if (!stored.ok) return void (await failGeneration(scope, id, stored.message))
        await succeedGeneration(scope, id, { job: 'shot_frame', asset: stored.id })
        return
      }
      case 'shoot_reel': {
        const out = await generateVideo(model, spec, (percent) => progressGeneration(scope, id, percent), signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const stored = await store(scope, 'clip', out.value.bytes, out.value.mime)
        if (!stored.ok) return void (await failGeneration(scope, id, stored.message))
        await succeedGeneration(scope, id, { job: 'shoot_reel', video: stored.id, poster: null })
        return
      }
      case 'ai_shotlist': {
        if (input.reel === null) return void (await failGeneration(scope, id, 'The reel is gone.'))
        const out = await generateText(model, spec, signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const items = parseShotlist(out.value)
        if (items === null) return void (await failGeneration(scope, id, 'The model did not return a shotlist it could be read as.'))
        await insertReelShots(
          scope,
          input.reel.id,
          items.map((item) => ({
            description: item.description,
            parts: parseDescription(item.description, input.names),
            durationS: item.durationS,
            shotType: asShotType(item.shotType),
            cameraAngle: item.cameraAngle,
            cameraMotion: asMotion(item.cameraMotion),
            lens: item.lens,
            proposed: true,
          })),
        )
        await succeedGeneration(scope, id, { job: 'ai_shotlist' })
        return
      }
      case 'location_plate': {
        // The plate is the location's photo (roadmap task 5.1): stored under the location, as an upload is, and pointed at once the row says it succeeded.
        if (input.target?.type !== 'location') return void (await failGeneration(scope, id, 'The location is gone.'))
        const out = await generateImage(model, spec, signal)
        if (!(await settle(scope, id, out)) || !out.ok) return
        const key = `projects/${scope.projectId}/locations/${input.target.id}/photo-${crypto.randomUUID()}.${EXTENSION[out.value.mime] ?? 'bin'}`
        const put = await putObject(key, out.value.bytes, out.value.mime)
        if (!put.ok) return void (await failGeneration(scope, id, put.message))
        if ((await succeedGeneration(scope, id, { job: 'location_plate' })) === null) {
          // Cancelled while it drew: nothing points at the object.
          await deleteObject(key)
          return
        }
        const location = input.target.id as LocationId
        const pointed = await setLocationPhotoKey(scope, location, key)
        if (!pointed.found) {
          await deleteObject(key)
        } else if (pointed.previous !== null && pointed.previous !== key) {
          // A photo the writer uploaded while it drew: theirs is kept, the plate goes. A plate never draws over a photo.
          await setLocationPhotoKey(scope, location, pointed.previous)
          await deleteObject(key)
        }
        return
      }
      default:
        await failGeneration(scope, id, `No runner for ${spec.job}.`)
    }
  } catch (cause) {
    await failGeneration(scope, id, cause instanceof Error ? cause.message : 'The generation died.').catch(() => undefined)
  }
}
