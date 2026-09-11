import type { ReactNode } from 'react'

import { loadEpisode } from '../../../../../../lib/workspace/context'
import { ContextColumn } from './context-column'

/**
 * Production's 250px column, in both URL shapes.
 *
 * `/production` is **episode-scoped** - AGENTS.md open decision 5, ruled by
 * the client for this phase and recorded in `docs/build-decisions.md`. Reels
 * and frames were always episode-scoped; the ruling put the route beside
 * them. It is not one of the seven writing routes, so it does not get the
 * episode nav; it gets the README's 250px context column, empty this phase.
 */
export const ProductionLayout = async ({
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
      <ContextColumn route="production" title={context.project.title} />
      {children}
    </>
  )
}
