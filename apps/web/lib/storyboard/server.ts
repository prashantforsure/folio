import type { CreditBalance, DocumentRecord, StoryboardScene } from '@folio/contracts'
import { FRAME_GENERATION_COST } from '@folio/contracts'
import { listStoryboard, readBalance, readDocumentByKind, readMentionLabels } from '@folio/db'
import type { MentionLabel } from '@folio/script'
import { cache } from 'react'

import { loadEpisode } from '../workspace/context'
import type { EpisodeContext } from '../workspace/context'

/**
 * Everything the Storyboard route renders, in one read, and where each part
 * comes from.
 *
 *   `scenes`     `listStoryboard` - every present scene of the episode
 *                (`scene_derivations`), its shots (`shots`) in order, each
 *                with its frame folded from the latest `frame_generations`
 *                row and its `jobs` row. A scene with no shots is a column.
 *   `labels`     `characters.name` / `locations.name` through the record id,
 *                for printing an `@mention` and for parsing one typed.
 *   `balance`    `readBalance` - computed from the ledger, never read from a
 *                column. The header prints `available`, and the frame button
 *                prints the cost beside it: "cost is named before it is spent".
 *   `cost`       `FRAME_GENERATION_COST`, the one constant the button, the
 *                reservation and the job row all take from.
 *
 * Three states the body tells apart, as the Scenes route does: no script at
 * all; a script with no scene derivation accepted; a board. There is no
 * "unreadable" here - the board reads derived rows, not the node list, and
 * the proposer reads nodes only inside its action, where it reports.
 *
 * Wrapped in `cache()` so the header (count, credits) and the body share
 * one read per request.
 */

export type StoryboardLoad =
  | { readonly state: 'empty'; readonly balance: CreditBalance }
  | {
      readonly state: 'script'
      readonly document: DocumentRecord
      readonly scenes: readonly StoryboardScene[]
      readonly labels: readonly MentionLabel[]
      readonly balance: CreditBalance
      readonly cost: number
    }

export const loadStoryboard = cache(async (context: EpisodeContext): Promise<StoryboardLoad> => {
  const { scope, episode } = context
  const [document, balance] = await Promise.all([
    readDocumentByKind(scope, episode.id, 'screenplay'),
    readBalance(scope),
  ])
  if (document === null) return { state: 'empty', balance }
  const [scenes, labels] = await Promise.all([listStoryboard(scope, episode.id), readMentionLabels(scope)])
  return { state: 'script', document, scenes, labels, balance, cost: FRAME_GENERATION_COST }
})

/** The route's context and its load, for a page or a header that has only raw params. */
export const enterStoryboard = async (
  rawProjectId: string,
  segment: string | null,
): Promise<{ readonly context: EpisodeContext; readonly load: StoryboardLoad }> => {
  const context = await loadEpisode(rawProjectId, segment)
  return { context, load: await loadStoryboard(context) }
}

/** Accepted shots across the board - what the header's chip and the nav's row count. */
export const acceptedShotCount = (scenes: readonly StoryboardScene[]): number =>
  scenes.reduce((total, scene) => total + scene.shots.filter((shot) => shot.state === 'accepted').length, 0)

/** Proposals not yet taken. Shown beside the count, never inside it. */
export const proposedShotCount = (scenes: readonly StoryboardScene[]): number =>
  scenes.reduce((total, scene) => total + scene.shots.filter((shot) => shot.state === 'proposed').length, 0)
