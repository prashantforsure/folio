import type { ArtStyle, Assignee, CreditBalance, EpisodeSettings, Generation, ProductionCastMember, ProductionScene, ViewPreferences } from '@folio/contracts'
import { DEFAULT_ART_STYLE_KEY, DEFAULT_SETTINGS, hueOfColor } from '@folio/contracts'
import { listCharacterRecords, listLocationRecords, listMemberProfiles, listPropRecords, readBalance, readProductionEpisode } from '@folio/db'
import { modelEnv } from '@folio/db/env'
import type { CharacterId, LocationId, PropId } from '@folio/script'
import { cache } from 'react'

import { initialsOf } from '../characters/cast'
import { publicUrl, storageAvailable } from '../storage/r2'
import type { EpisodeContext } from '../workspace/context'
import { composeScenes } from './compose'

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
  /** The project's props, for the `Prop` menu. Props is authoritative (`prop_id`, migration `0030`). */
  readonly props: readonly { readonly id: PropId; readonly name: string }[]
  readonly members: readonly Assignee[]
  readonly preferences: ViewPreferences
  readonly balance: CreditBalance
  readonly live: readonly Generation[]
  /** `R2_*` set: image and video outputs have somewhere to go. */
  readonly storage: boolean
  /** `GEMINI_API_KEY` set: the generate buttons are connected. */
  readonly model: boolean
}

/*
 * A generation stuck `queued` or `running` is no longer this page's to settle
 * (defect 0.6, closed by roadmap task 4.3). It used to fail anything older
 * than ten minutes on every load, because a serverless function killed mid-run
 * left nothing else to notice. Generations run on the worker now: a dead
 * worker's job is requeued by the stale sweep and failed at its third attempt,
 * and the reaper (`lib/worker/reaper.ts`) fails a generation left with no live
 * job as interrupted - so a page load writes nothing, and a generation waiting
 * its turn in a long queue is not mistaken for a dead one.
 */

export const loadProduction = cache(async (context: EpisodeContext): Promise<ProductionLoad> => {
  const { scope, episode } = context
  const [record, characters, locationRows, propRows, members, balance] = await Promise.all([
    readProductionEpisode(scope, episode.id),
    listCharacterRecords(scope),
    listLocationRecords(scope),
    listPropRecords(scope),
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
    props: propRows.map((prop) => ({ id: prop.id, name: prop.name })),
    members: members.map((member) => ({ id: member.userId, name: member.displayName })),
    preferences: record.preferences,
    balance,
    live: record.live,
    storage: storageAvailable(),
    model: modelEnv !== null,
  }
})
