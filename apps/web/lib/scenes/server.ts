import type { DocumentRecord, Measurement, MeasurementScene, SceneBoardRow } from '@folio/contracts'
import {
  listSceneBoard,
  listSceneMeasurements,
  readDocumentByKind,
  readMeasurement,
  readMentionLabels,
  readScreenplayNodes,
} from '@folio/db'
import type { CharacterId, NodeId } from '@folio/script'
import { labelBook } from '@folio/script'
import { cache } from 'react'

import { nodeDigest } from '../script/server'
import { loadEpisode } from '../workspace/context'
import type { EpisodeContext } from '../workspace/context'
import { cutExcerpts } from './excerpt'
import type { SceneExcerpt, UnacceptedHeading } from './excerpt'

/**
 * Everything the Scenes route renders, in one read, and where each part
 * comes from.
 *
 * The route is "the end-to-end proof that derivation and measurement actually
 * work against a real document", so this loader is deliberately a *join* and
 * never a *computation*. Every number on a card is read from the table that
 * owns it and carried to the component under a name that says which table:
 *
 *   `scenes[].derived`      `scene_derivations` + `scenes.synopsis`   (`listSceneBoard`)
 *   `scenes[].measured`     `measurement_scenes`                       (`listSceneMeasurements`)
 *                           `null` when there is no measurement, and the
 *                           card prints `—`. Nothing here paginates.
 *   `scenes[].cast`         `characters.name` through the record id   (`readMentionLabels`)
 *   `scenes[].excerpt`      the node list, cut at derivation's headings (`cutExcerpts`)
 *   `measurement`           the `measurements` header at the project's format,
 *                           `paged` - the same row the nav and the project
 *                           card count from (`workspace.ts`, "one measurement,
 *                           chosen the same way everywhere").
 *   `stale`                 `measurements.node_digest` against the node list
 *                           in hand - the record is shown, and flagged.
 *   `unaccepted`            scene-typed nodes with no derived row: what
 *                           derivation refused, with its reason.
 *
 * Wrapped in `cache()` so the header (count, tabs) and the body share one
 * read per request, the way `loadEpisode` does.
 */

export type SceneCard = {
  readonly derived: SceneBoardRow
  readonly measured: MeasurementScene | null
  readonly cast: readonly { readonly id: CharacterId; readonly name: string }[]
  readonly excerpt: SceneExcerpt
}

export type ScenesLoad =
  | { readonly state: 'empty' }
  | { readonly state: 'unreadable'; readonly document: DocumentRecord; readonly detail: string }
  | {
      readonly state: 'script'
      readonly document: DocumentRecord
      readonly nodeCount: number
      readonly scenes: readonly SceneCard[]
      readonly measurement: Measurement | null
      readonly stale: boolean
      readonly unaccepted: readonly UnacceptedHeading[]
    }

export const loadScenes = cache(
  async (context: EpisodeContext): Promise<ScenesLoad> => {
    const { scope, project, episode } = context
    const document = await readDocumentByKind(scope, episode.id, 'screenplay')
    if (document === null) return { state: 'empty' }

    const read = await readScreenplayNodes(scope, document.id)
    if (!read.ok) {
      return {
        state: 'unreadable',
        document,
        detail: `${read.error.at || 'node'}: ${read.error.reason.kind}`,
      }
    }
    const nodes = read.value.map((entry) => entry.node)

    const [board, labels, measurement] = await Promise.all([
      listSceneBoard(scope, document.id),
      readMentionLabels(scope),
      readMeasurement(scope, document.id, project.format, 'paged'),
    ])
    const measuredScenes =
      measurement === null ? [] : await listSceneMeasurements(scope, measurement.id)
    const measuredById = new Map<NodeId, MeasurementScene>(
      measuredScenes.map((row) => [row.sceneNodeId, row]),
    )
    const names = new Map<string, string>(
      labels.filter((label) => label.entity === 'character').map((label) => [label.id, label.label]),
    )
    const book = labelBook(labels)
    const { excerpts, unaccepted } = cutExcerpts(
      nodes,
      board.map((row) => row.sceneNodeId),
      book,
    )

    const scenes: SceneCard[] = board.map((derived) => ({
      derived,
      measured: measuredById.get(derived.sceneNodeId) ?? null,
      cast: derived.cast.map((id) => ({ id, name: names.get(id) ?? '(record missing)' })),
      excerpt: excerpts.get(derived.sceneNodeId) ?? {
        sceneNodeId: derived.sceneNodeId,
        lines: [],
      },
    }))

    return {
      state: 'script',
      document,
      nodeCount: nodes.length,
      scenes,
      measurement,
      stale: measurement !== null && measurement.nodeDigest !== nodeDigest(nodes),
      unaccepted,
    }
  },
)

/** The route's context and its load, for a page or a header that has only raw params. */
export const enterScenes = async (
  rawProjectId: string,
  segment: string | null,
): Promise<{ readonly context: EpisodeContext; readonly load: ScenesLoad }> => {
  const context = await loadEpisode(rawProjectId, segment)
  return { context, load: await loadScenes(context) }
}
