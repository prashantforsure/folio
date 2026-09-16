'use client'

import { useSearchParams, useSelectedLayoutSegment } from 'next/navigation'

import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import type { AnySubView } from '../../../../../../lib/workspace/params'
import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import type { ViewTab } from '../../../../../../lib/workspace/views'
import { ROUTE_VIEWS, currentView, viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'

/**
 * The header's centre on this route - `_chrome/header-views.tsx` with one
 * difference: a source page is the `source` view whatever `?view=` says.
 *
 * `research-route.tsx` forces `view = 'source'` when the path names a
 * source (`/research/:sourceId` - "the path is the more specific address"),
 * and `researchSourceHref` carries no query, so on every source page the
 * URL has no `?view=` and the shared component would light `Library` under
 * a source body. This reads the segment below `research/layout.tsx` - the
 * source id on a source page, `null` on `/research` - and lights `source`
 * there; elsewhere it is the shared rule, the tab the query names, else
 * the first. The layout hands it to the header as `views`.
 */
export const ResearchHeaderViews = ({ baseHref }: { readonly baseHref: ProjectRoutePath }) => {
  const params = useSearchParams()
  const segment = useSelectedLayoutSegment()
  const items: readonly ViewTab<AnySubView>[] = ROUTE_VIEWS.research
  const current = segment !== null ? 'source' : (currentView('research', params.get('view'))?.id ?? 'library')
  return <ViewPill label={viewsLabel(ROUTE_TITLE.research)} items={items} current={current} baseHref={baseHref} />
}
