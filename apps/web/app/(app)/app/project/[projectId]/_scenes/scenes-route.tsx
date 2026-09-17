import { notFound } from 'next/navigation'

import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { ScenesBody } from './scenes-body'
import { ScenesMain } from './scenes-main'

/**
 * The Scenes route, server side: the route's `<main>` around the body,
 * inside the writing layout's surface card - the Storyboard's shape
 * (`_storyboard/storyboard-route.tsx`).
 *
 * The route has no sub-view param (`params.ts`, ruled 2026-09-17): the
 * `Cards · Index cards · Scene list` tabs are client state (`view-state.tsx`)
 * and the URL stays `/scenes`, so a view switch never comes back here.
 * `parseSubViews` is still called so unknown keys are handled as every
 * route handles them - a stale `?view=index` is one, and opens the cards.
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by `scenes-main.tsx` exactly.
 *
 * Both `scenes/page.tsx` files render this after `enterEpisodeRoute`, which
 * canonicalises the URL for the project's shape before anything renders.
 * No page header and no status bar since the redesign: the shell header
 * draws the views, the sidebar row carries the count, and the workspace
 * draws its own toolbar row inside the surface.
 */
export const ScenesRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('scenes', await searchParams)
  if (!parsed.ok) notFound()
  return (
    <ScenesMain>
      <ScenesBody context={context} />
    </ScenesMain>
  )
}
