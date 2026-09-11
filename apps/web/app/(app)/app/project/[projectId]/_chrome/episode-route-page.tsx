import type { ReactNode } from 'react'

import { enterEpisodeRoute } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import type { EpisodeRoute } from '../../../../../../lib/workspace/routes'
import { RouteShell } from './route-shell'

/**
 * What every episode page is, in both URL shapes.
 *
 * The sixteen `page.tsx` files under `[episodeId]/` and `(film)/` are each
 * one line that names a route and hands its props here. The film pages have
 * no `episodeId` param; `enterEpisodeRoute` treats its absence as the
 * collapsed shape and redirects to the canonical URL for the project's type
 * before anything renders.
 */
export const EpisodeRoutePage = async ({
  route,
  params,
  searchParams,
  render,
}: {
  readonly route: EpisodeRoute
  readonly params: Promise<{ readonly projectId: string; readonly episodeId?: string }>
  readonly searchParams: Promise<RawSearchParams>
  readonly render?: () => ReactNode
}) => {
  const { projectId, episodeId } = await params
  await enterEpisodeRoute(projectId, episodeId ?? null, route)
  return (
    <RouteShell
      route={route}
      searchParams={searchParams}
      {...(render === undefined ? {} : { render })}
    />
  )
}
