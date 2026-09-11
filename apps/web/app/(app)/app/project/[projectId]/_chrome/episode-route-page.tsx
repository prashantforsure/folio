import type { ReactNode } from 'react'

import { enterEpisodeRoute } from '../../../../../../lib/workspace/context'
import type { RawSearchParams, SubViews } from '../../../../../../lib/workspace/params'
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
export const EpisodeRoutePage = async <R extends EpisodeRoute>({
  route,
  params,
  searchParams,
  render,
  header,
}: {
  readonly route: R
  readonly params: Promise<{ readonly projectId: string; readonly episodeId?: string }>
  readonly searchParams: Promise<RawSearchParams>
  /** The body. Receives the parsed sub-views and the raw params, for a `cache()`d loader. */
  readonly render?: (subViews: SubViews<R>, address: RouteAddress) => ReactNode
  readonly header?: (subViews: SubViews<R>, address: RouteAddress) => ReactNode
}) => {
  const { projectId, episodeId } = await params
  await enterEpisodeRoute(projectId, episodeId ?? null, route)
  const address: RouteAddress = { projectId, segment: episodeId ?? null }
  return (
    <RouteShell<R>
      route={route}
      searchParams={searchParams}
      {...(render === undefined
        ? {}
        : { render: (subViews: SubViews<R>) => render(subViews, address) })}
      {...(header === undefined
        ? {}
        : { header: (subViews: SubViews<R>) => header(subViews, address) })}
    />
  )
}

/** The raw params a body needs to call a `cache()`d loader and get the page's own read back. */
export type RouteAddress = {
  readonly projectId: string
  /** The raw `[episodeId]` segment, or `null` for the collapsed (film) shape. */
  readonly segment: string | null
}
