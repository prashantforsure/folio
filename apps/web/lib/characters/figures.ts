import type { ProjectId, SceneRef } from '@folio/contracts'
import type { SceneIndexRow } from '@folio/db'

import type { ScenePath, WorkspaceShape } from '../workspace/hrefs'
import { sceneHref } from '../workspace/hrefs'

/**
 * A scene as the Characters route names it, and as a link into the
 * script. Tested in `tests/characters-figures.test.ts`. The assistant
 * panel, Locations, Research and the chrome construct refs and citations
 * through here too, so `E1 Sc 4` reads the same everywhere.
 *
 * The presence map and the scene facts the third pass read (`buildMap`,
 * `sceneFactsOf`, the strips) went with the fourth pass (2026-09-20).
 */

export const sceneRefOf = (row: SceneIndexRow): SceneRef => ({
  sceneNodeId: row.sceneNodeId,
  episode: row.episode,
  episodeOrdinal: row.episodeOrdinal,
  number: row.ordinalInEpisode,
  heading: row.heading,
})

/** `E1 Sc 4`, as every scene reference on the route reads. */
export const formatSceneRef = (ref: SceneRef): string => `E${String(ref.episodeOrdinal)} Sc ${String(ref.number)}`

/** A citation chip's two halves: the label the route prints and the script href it opens. */
export type Citation = { readonly label: string; readonly href: ScenePath }

/**
 * A scene ref as a link into the script - the chip's label and the episode
 * script's `#n-<node id>` fragment (`sceneHref`). Every citation chip on the
 * route goes through here, so a claim that comes from the script opens the
 * scene that proves it.
 */
export const citeOf = (projectId: ProjectId, shape: WorkspaceShape, ref: SceneRef): Citation => ({
  label: formatSceneRef(ref),
  href: sceneHref({ projectId, shape, episode: ref.episode }, ref.sceneNodeId),
})
