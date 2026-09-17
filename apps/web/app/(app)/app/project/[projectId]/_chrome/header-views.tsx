'use client'

import { useSearchParams } from 'next/navigation'

import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { AnySubView } from '../../../../../../lib/workspace/params'
import type { WorkspaceRoute } from '../../../../../../lib/workspace/routes'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import type { ViewTab } from '../../../../../../lib/workspace/views'
import { ROUTE_VIEWS, currentView, viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from './view-pill'

/**
 * The header's centre: the current route's views, from `ROUTE_VIEWS`
 * (`lib/workspace/views.ts`), lit by the URL.
 *
 * A layout renders the header and cannot see the page's parsed sub-views,
 * so this reads `?view=` itself through `useSearchParams` - the same string
 * the page parsed, so the lit tab is the view the body drew. No value, or
 * one not in the table, lights the first tab: the param's default, and the
 * only case an unknown value can be here is none, since the page 404s on
 * one (`parseSubViews`). A route with no views renders nothing, and the
 * header keeps its two halves balanced with an empty centre.
 *
 * Four routes do not come through here. Characters', the Storyboard's and
 * Scenes' views are state, not the URL: Characters' layout hands the header
 * `_characters/view-state.tsx`'s tabs in place of this, and the header
 * draws `_storyboard/view-state.tsx`'s and `_scenes/view-state.tsx`'s
 * itself on those segments. Research's source page is the `source` view
 * with no `?view=` in its address (`/research/:sourceId`), which this
 * cannot see, so its layout hands `_research/research-header-views.tsx`
 * instead.
 */
export const HeaderViews = ({ route, baseHref }: { readonly route: WorkspaceRoute; readonly baseHref: EpisodeRoutePath | ProjectRoutePath }) => {
  const params = useSearchParams()
  const current = currentView(route, params.get('view'))
  if (current === null) return null
  const items: readonly ViewTab<AnySubView>[] = ROUTE_VIEWS[route]
  return <ViewPill label={viewsLabel(ROUTE_TITLE[route])} items={items} current={current.id} baseHref={baseHref} />
}
