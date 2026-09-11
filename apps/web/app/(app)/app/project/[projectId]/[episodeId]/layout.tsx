import type { ReactNode } from 'react'

import { loadEpisode } from '../../../../../../lib/workspace/context'
import { RememberEpisode } from '../_chrome/remember-episode'

/**
 * The episode segment's gate. Nothing visual.
 *
 * Every URL with an `[episodeId]` passes through here, and `loadEpisode`
 * runs `parseEpisodeSegment` on it **before** any lookup: the nine reserved
 * project names are refused by name, anything outside `ep_NNN` by shape, and
 * an unknown slug by the repository. Each refusal is a 404. AGENTS.md,
 * Routing: "Static-first precedence saves this tree by accident; do not rely
 * on it." `/app/project/:id/characters/script` is the URL precedence does
 * not save - there is no static `characters/script` - and it is a 404 for
 * the first reason, not by luck.
 *
 * The episode nav is not here. It belongs to the seven writing routes, and
 * `production` is episode-scoped without it (open decision 5, ruled), so the
 * nav column is one route group down in `(writing)/layout.tsx`.
 *
 * `RememberEpisode` writes the "last opened" cookie from the browser once the
 * server has accepted the segment - never before, so a rejected URL cannot
 * plant a value the index redirect would later follow.
 */
const EpisodeLayout = async ({
  children,
  params,
}: {
  readonly children: ReactNode
  readonly params: Promise<{ readonly projectId: string; readonly episodeId: string }>
}) => {
  const { projectId, episodeId } = await params
  const context = await loadEpisode(projectId, episodeId)

  return (
    <>
      <RememberEpisode projectId={context.project.id} slug={context.episode.slug} />
      {children}
    </>
  )
}

export default EpisodeLayout
