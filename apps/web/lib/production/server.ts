import type {
  ArtStyle,
  Asset,
  AssetId,
  Assignee,
  Clip,
  CreditBalance,
  EpisodeSettings,
  Generation,
  ProductionCastMember,
  ProductionScene,
  Reel,
  ReelShot,
  Sheet,
  ViewPreferences,
} from '@folio/contracts'
import { DEFAULT_ART_STYLE_KEY, DEFAULT_SETTINGS, hueOfColor } from '@folio/contracts'
import type { AssetRecord, ClipRecord, ProductionEpisodeRecord, ProjectScope, ReelRecord, ReelShotRecord, SheetRecord } from '@folio/db'
import { listCharacterRecords, listLocationRecords, listMemberProfiles, readBalance, readProductionEpisode } from '@folio/db'
import { modelEnv } from '@folio/db/env'
import type { CharacterId, LocationId } from '@folio/script'
import { cache } from 'react'

import { initialsOf } from '../characters/cast'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { EpisodeContext } from '../workspace/context'

/**
 * The Production route's one read, `cache()`d so the layout and the page
 * share it. The repository hands back rows and asset keys; this composes
 * what the spec's read model needs from the other routes - the cast with
 * its portraits (the appearance reference, by the client's ruling), the
 * locations with their photos (the plate), the members for the Assignee
 * menu - and turns every key into a URL. Nothing here computes a derived
 * value; `derive.ts` does that on the client and again in the actions.
 */

export type ProductionLoad = {
  readonly scenes: readonly ProductionScene[]
  readonly settings: EpisodeSettings | null
  /** The settings the modal opens with when none are saved: the mockup's defaults. */
  readonly defaults: EpisodeSettings
  readonly artStyles: readonly ArtStyle[]
  readonly locations: readonly { readonly id: LocationId; readonly name: string }[]
  readonly members: readonly Assignee[]
  readonly preferences: ViewPreferences
  readonly balance: CreditBalance
  readonly live: readonly Generation[]
  /** `R2_*` set: image and video outputs have somewhere to go. */
  readonly storage: boolean
  /** `GEMINI_API_KEY` set: the generate buttons are connected. */
  readonly model: boolean
}

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

export const loadProduction = cache(async (context: EpisodeContext): Promise<ProductionLoad> => {
  const { scope, episode } = context
  const [record, characters, locationRows, members, balance] = await Promise.all([
    readProductionEpisode(scope, episode.id),
    listCharacterRecords(scope),
    listLocationRecords(scope),
    listMemberProfiles(scope),
    readBalance(scope),
  ])
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
  const locationMap = new Map<LocationId, { readonly name: string; readonly plateReady: boolean }>(
    locationRows.map((location) => [location.id, { name: location.name, plateReady: location.photoKey !== null }]),
  )
  const preset = record.artStyles.find((style) => style.key === DEFAULT_ART_STYLE_KEY) ?? record.artStyles[0]
  if (preset === undefined) throw new Error('Folio: the art-style presets are missing - migration 0026 seeds them.')
  return {
    scenes: composeScenes(record, cast, locationMap),
    settings: record.settings,
    defaults: { episodeId: episode.id, ...DEFAULT_SETTINGS, artStyleId: preset.id, lockedAt: null },
    artStyles: record.artStyles,
    locations: locationRows.map((location) => ({ id: location.id, name: location.name })),
    members: members.map((member) => ({ id: member.userId, name: member.displayName })),
    preferences: record.preferences,
    balance,
    live: record.live,
    storage: storageAvailable(),
    model: modelEnv !== null,
  }
})

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
