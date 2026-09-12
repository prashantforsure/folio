import { notFound } from 'next/navigation'

import { loadStoryboard } from '../../../../../../lib/storyboard/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { StoryboardWorkspace } from './storyboard-workspace'

/**
 * The Storyboard route, server side: one read, then the client workspace.
 *
 * Replaces `RouteShell` for this route the way Scenes does: the header
 * carries the live count, the view segment and the credit balance, and the
 * route has a subheader and a footer. The `<main data-route data-sub-view>`
 * contract the smoke test reads is kept exactly; `?view=` is parsed as every
 * route's is and a value outside `board | canvas | list` is a 404.
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
  const { project, episode, address, shape } = context

  const load = await loadStoryboard(context)

  return (
    <StoryboardWorkspace
      projectId={project.id}
      episode={episode.slug}
      routeId={shape === 'collapsed' ? 'storyboard' : `${episode.slug}/storyboard`}
      view={parsed.params.view}
      baseHref={episodeRouteHref(address, 'storyboard')}
      scriptHref={episodeRouteHref(address, 'script')}
      productionHref={episodeRouteHref(address, 'production')}
      state={load.state}
      scenes={load.state === 'script' ? load.scenes : []}
      labels={load.state === 'script' ? load.labels : []}
      available={load.balance.available}
      cost={load.state === 'script' ? load.cost : null}
    />
  )
}
