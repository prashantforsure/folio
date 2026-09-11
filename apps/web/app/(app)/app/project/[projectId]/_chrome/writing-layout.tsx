import type { ReactNode } from 'react'

import { loadEpisode } from '../../../../../../lib/workspace/context'
import { EpisodeNav } from './episode-nav'

/**
 * The episode nav beside the seven writing routes. Both `(writing)` layouts
 * - the episodic one under `[episodeId]/` and the collapsed one under
 * `(film)/` - render this with the segment they have, and the nav is built
 * once from the same `EpisodeContext` the page uses.
 */
export const WritingLayout = async ({
  projectId,
  episodeId,
  children,
}: {
  readonly projectId: string
  readonly episodeId: string | null
  readonly children: ReactNode
}) => {
  const context = await loadEpisode(projectId, episodeId)
  return (
    <>
      <EpisodeNav context={context} />
      {children}
    </>
  )
}
