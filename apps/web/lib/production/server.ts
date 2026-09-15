import type { CastRow, CreditBalance, DocumentRecord, ProductionScene, RenderResolution } from '@folio/contracts'
import { FRAME_GENERATION_COST, REEL_RENDER_COST } from '@folio/contracts'
import {
  listCharacterRecords,
  listLocationRecords,
  listProductionScenes,
  readBalance,
  readDocumentByKind,
  readMentionLabels,
} from '@folio/db'
import type { LocationId, MentionLabel } from '@folio/script'
import { cache } from 'react'

import { castRowOf } from '../characters/server'
import { loadEpisode } from '../workspace/context'
import type { EpisodeContext } from '../workspace/context'
import { episodeStats } from './status'
import type { EpisodeStats, GateInput } from './status'

/**
 * Everything the Production route renders, in one read, and where each part
 * comes from. Data, not view props: the UI is the redesign's, and it folds
 * a reel's status with `status.ts` from what is here.
 *
 *   `scenes`      `listProductionScenes` - every present scene of the
 *                 episode (`scene_derivations`), its reels in order, each
 *                 reel's shots in the scene's order with every take, each
 *                 reel's clip folded from its latest render and job, and the
 *                 scene's shots not yet in a reel. A scene with no reels is
 *                 a scene with an empty list.
 *   `labels`      `characters.name` / `locations.name` through the record
 *                 id, for printing an `@mention` and for parsing one typed.
 *   `cast`        the Characters route's own rows - name, colour, portrait
 *                 URL - for the read-only cast column beside a reel. Read,
 *                 never written here: a look is edited in Characters.
 *   `locations`   name and description by id, for the location line beside
 *                 a reel. Read, never written here. No plate: none exists.
 *   `balance`     `readBalance` - computed from the ledger, never read from
 *                 a column. The header prints `available`; every button
 *                 prints its cost beside it.
 *   `costs`       the two placeholders every button, reservation and job
 *                 row take their number from.
 *   `resolution`  the project's, for the header control and the render.
 *
 * Two states the body tells apart: no script at all, and an episode with
 * scenes. There is no "unreadable" here for the Storyboard's reason.
 *
 * Wrapped in `cache()` so the column, the header and the body share one
 * read per request.
 */

export type LocationSummary = {
  readonly id: LocationId
  readonly name: string
  readonly description: string | null
}

export type ProductionLoad =
  | { readonly state: 'empty'; readonly balance: CreditBalance; readonly resolution: RenderResolution }
  | {
      readonly state: 'script'
      readonly document: DocumentRecord
      readonly scenes: readonly ProductionScene[]
      readonly labels: readonly MentionLabel[]
      readonly cast: readonly CastRow[]
      readonly locations: ReadonlyMap<LocationId, LocationSummary>
      readonly balance: CreditBalance
      readonly costs: { readonly frame: number; readonly render: number }
      readonly resolution: RenderResolution
      readonly stats: EpisodeStats
    }

export const loadProduction = cache(async (context: EpisodeContext): Promise<ProductionLoad> => {
  const { scope, episode, project } = context
  const [document, balance] = await Promise.all([
    readDocumentByKind(scope, episode.id, 'screenplay'),
    readBalance(scope),
  ])
  if (document === null) return { state: 'empty', balance, resolution: project.renderResolution }
  const [scenes, labels, characters, locationRecords] = await Promise.all([
    listProductionScenes(scope, episode.id),
    readMentionLabels(scope),
    listCharacterRecords(scope),
    listLocationRecords(scope),
  ])
  const locations = new Map<LocationId, LocationSummary>(
    locationRecords.map((record) => [record.id, { id: record.id, name: record.name, description: record.description }]),
  )
  return {
    state: 'script',
    document,
    scenes,
    labels,
    cast: characters.map(castRowOf),
    locations,
    balance,
    costs: { frame: FRAME_GENERATION_COST, render: REEL_RENDER_COST },
    resolution: project.renderResolution,
    stats: episodeStats(scenes),
  }
})

/** The route's context and its load, for a page or a column that has only raw params. */
export const enterProduction = async (
  rawProjectId: string,
  segment: string | null,
): Promise<{ readonly context: EpisodeContext; readonly load: ProductionLoad }> => {
  const context = await loadEpisode(rawProjectId, segment)
  return { context, load: await loadProduction(context) }
}

/** What the fold needs from a load, for a client that folds. */
export const gateInputOf = (load: Extract<ProductionLoad, { state: 'script' }>): GateInput => ({
  available: load.balance.available,
  frameCost: load.costs.frame,
  renderCost: load.costs.render,
  resolution: load.resolution,
})
