import { redirect } from 'next/navigation'

import { loadEpisode } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'

/**
 * `/app/project/:projectId/:episodeId` → `./script`.
 *
 * The segment is validated by `loadEpisode` before anything is looked up. A
 * film reaching this page through an episode segment is sent to the collapsed
 * shape directly, rather than to `./script` and then on again.
 */
const EpisodeIndex = async ({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string; readonly episodeId: string }>
}) => {
  const { projectId, episodeId } = await params
  const context = await loadEpisode(projectId, episodeId)
  redirect(episodeRouteHref(context.address, 'script'))
}

export default EpisodeIndex
