import type { Asset, AssetId, Clip, ProductionCastMember, ProductionScene, Reel, ReelShot, Sheet } from '@folio/contracts'
import { hueOfColor } from '@folio/contracts'
import type { AssetRecord, ClipRecord, ProductionEpisodeRecord, ProjectScope, ReelRecord, ReelShotRecord, SheetRecord } from '@folio/db'
import { listCharacterRecords, listLocationRecords } from '@folio/db'
import type { CharacterId, LocationId } from '@folio/script'

import { initialsOf } from '../characters/cast'
import { publicUrl } from '../storage/r2'

/**
 * Production's read model composed from the records - the scenes with their
 * reels, shots, sheets and clips, the cast with portraits, the locations with
 * plates. Out of `server.ts` so that what the actions, the cores and the
 * worker (roadmap task 4.3) need does not carry `loadProduction`'s React
 * `cache()` with it; the route's load composes with these too.
 */

const assetOf = (map: ReadonlyMap<AssetId, AssetRecord>, id: AssetId | null): Asset | null => {
  if (id === null) return null
  const record = map.get(id)
  if (record === undefined) return null
  const { storageKey, ...rest } = record
  return { ...rest, url: publicUrl(storageKey) }
}

const shotOf = (shot: ReelShotRecord, map: ReadonlyMap<AssetId, AssetRecord>): ReelShot => {
  const { frameAssetId, referenceAssetIds, ...rest } = shot
  return {
    ...rest,
    frame: assetOf(map, frameAssetId),
    references: referenceAssetIds.map((id) => assetOf(map, id)).filter((asset): asset is Asset => asset !== null),
  }
}

const sheetOf = (sheet: SheetRecord | null, map: ReadonlyMap<AssetId, AssetRecord>): Sheet | null => {
  if (sheet === null) return null
  const { assetId, frames, ...rest } = sheet
  return {
    ...rest,
    asset: assetOf(map, assetId),
    frames: frames.map((frame) => {
      const { assetId: frameAssetId, ...frameRest } = frame
      return { ...frameRest, asset: assetOf(map, frameAssetId) }
    }),
  }
}

const clipOf = (clip: ClipRecord | null, map: ReadonlyMap<AssetId, AssetRecord>): Clip | null => {
  if (clip === null) return null
  const { posterAssetId, videoAssetId, ...rest } = clip
  return { ...rest, poster: assetOf(map, posterAssetId), video: assetOf(map, videoAssetId) }
}

const reelOf = (reel: ReelRecord, map: ReadonlyMap<AssetId, AssetRecord>): Reel => ({
  ...reel,
  shots: reel.shots.map((shot) => shotOf(shot, map)),
  sheet: sheetOf(reel.sheet, map),
  clip: clipOf(reel.clip, map),
})

/** The spec's `INT | EXT` from the slugline's four-way reading. */
const intExtOf = (ie: string | undefined): ProductionScene['intExt'] => {
  if (ie === 'INT') return 'INT'
  if (ie === 'EXT' || ie === 'EST' || ie === 'INT/EXT') return 'EXT'
  return null
}

export const composeScenes = (
  record: ProductionEpisodeRecord,
  cast: ReadonlyMap<CharacterId, ProductionCastMember>,
  locations: ReadonlyMap<LocationId, { readonly name: string; readonly plateReady: boolean }>,
): readonly ProductionScene[] => {
  const reelsOf = new Map<string, Reel[]>()
  for (const reel of record.reels) {
    const list = reelsOf.get(reel.sceneNodeId) ?? []
    list.push(reelOf(reel, record.assets))
    reelsOf.set(reel.sceneNodeId, list)
  }
  return record.scenes.map((scene) => {
    const location = scene.locationId === null ? null : (locations.get(scene.locationId) ?? null)
    return {
      sceneNodeId: scene.sceneNodeId,
      number: scene.number,
      heading: scene.heading,
      set: scene.reading?.set ?? scene.heading,
      locationId: scene.locationId,
      locationName: location?.name ?? scene.reading?.set ?? null,
      intExt: intExtOf(scene.reading?.ie),
      timeOfDay: scene.reading?.timeOfDay ?? null,
      logline: scene.logline,
      cast: scene.cast.map((id) => cast.get(id)).filter((member): member is ProductionCastMember => member !== undefined),
      plateReady: location?.plateReady ?? false,
      still: assetOf(record.assets, scene.stillAssetId),
      stillState: scene.stillState,
      setup: { ...scene.setup, note: record.notes.get(`scene:${scene.sceneNodeId}`) ?? null },
      reels: reelsOf.get(scene.sceneNodeId) ?? [],
    }
  })
}

/** The composed cast and location maps for an action that needs them beside a gate. */
export const readCastAndPlaces = async (
  scope: ProjectScope,
): Promise<{
  readonly cast: ReadonlyMap<CharacterId, ProductionCastMember>
  readonly names: readonly { readonly id: CharacterId; readonly name: string }[]
  readonly locations: ReadonlyMap<LocationId, { readonly name: string; readonly plateReady: boolean }>
}> => {
  const [characters, locationRows] = await Promise.all([listCharacterRecords(scope), listLocationRecords(scope)])
  const cast = new Map<CharacterId, ProductionCastMember>(
    characters.map((character) => [
      character.id,
      {
        id: character.id,
        name: character.name,
        initials: initialsOf(character.name),
        hue: hueOfColor(character.color),
        portraitUrl: publicUrl(character.portraitKey),
        appearanceReady: character.portraitKey !== null,
      },
    ]),
  )
  return {
    cast,
    names: characters.map((character) => ({ id: character.id, name: character.name })),
    locations: new Map(locationRows.map((location) => [location.id, { name: location.name, plateReady: location.photoKey !== null }])),
  }
}
