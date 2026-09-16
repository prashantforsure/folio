import { FRAME_GENERATION_COST, REEL_RENDER_COST } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { loadProduction } from '../../../../../../lib/production/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { ProductionWorkspace } from './production-workspace'

/**
 * The Production route, server side: one read, then the client workspace.
 *
 * `loadProduction` is `cache()`d on the context, and the layout beside
 * this page (`_chrome/production-layout.tsx`) makes the same call to seed
 * the sidebar's rows, so the two share one read per request. `?view=` is
 * parsed as every route's is (`scene | episode`); a value outside it is a
 * 404. The `<main data-route data-sub-view>` contract the smoke test reads
 * is kept exactly.
 */
export const ProductionRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('production', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episode, address, shape } = context

  const load = await loadProduction(context)

  return (
    <ProductionWorkspace
      projectId={project.id}
      episode={episode.slug}
      episodeOrdinal={episode.ordinal}
      routeId={shape === 'collapsed' ? 'production' : `${episode.slug}/production`}
      view={parsed.params.view}
      baseHref={episodeRouteHref(address, 'production')}
      scriptHref={episodeRouteHref(address, 'script')}
      state={load.state}
      scenes={load.state === 'script' ? load.scenes : []}
      labels={load.state === 'script' ? load.labels : []}
      cast={load.state === 'script' ? load.cast : []}
      locations={load.state === 'script' ? [...load.locations.values()] : []}
      available={load.balance.available}
      costs={load.state === 'script' ? load.costs : { frame: FRAME_GENERATION_COST, render: REEL_RENDER_COST }}
      resolution={load.resolution}
    />
  )
}
