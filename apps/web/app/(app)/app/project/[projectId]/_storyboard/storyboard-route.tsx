import { notFound } from 'next/navigation'

import { loadStoryboard } from '../../../../../../lib/storyboard/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { StoryboardWorkspace } from './storyboard-workspace'

/**
 * The Storyboard route, server side: one read, then the client workspace
 * inside the writing layout's surface card.
 *
 * The route has no sub-view param (`params.ts`, ruled 2026-09-17): the
 * `Boards · Canvas · Shot list` tabs are client state (`view-state.tsx`)
 * and the URL stays `/storyboard`, so a view switch never comes back
 * here. `parseSubViews` is still called so unknown keys are handled as
 * every route handles them - a stale `?view=canvas` is one, and opens the
 * board. The `<main data-route data-sub-view>` contract the smoke test
 * reads is kept by the workspace exactly.
 *
 * `?selected=` is not read. The README writes it as `SCENE_xxx`, which is
 * the open id-shape contradiction (`docs/build-decisions.md`), and the
 * Scenes ruling put selection in component state. Same here.
 */
export const StoryboardRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('storyboard', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episode, address } = context

  const load = await loadStoryboard(context)

  return (
    <StoryboardWorkspace
      projectId={project.id}
      episode={episode.slug}
      scriptHref={episodeRouteHref(address, 'script')}
      state={load.state}
      scenes={load.state === 'script' ? load.scenes : []}
      labels={load.state === 'script' ? load.labels : []}
      available={load.balance.available}
      cost={load.state === 'script' ? load.cost : null}
      storage={load.state === 'script' && load.storage}
      drawOff={load.state === 'script' ? load.drawOff : null}
    />
  )
}
