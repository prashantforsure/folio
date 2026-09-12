import { notFound } from 'next/navigation'

import { loadBeats } from '../../../../../../lib/beats/server'
import type { EpisodeContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { BeatsWorkspace } from './beats-workspace'

/**
 * The Beats route, server side: one read, then the client workspace.
 *
 * Replaces `RouteShell` for this route: the header carries the count, the
 * view segment and `Add beat`, and the route has a footer. The `<main
 * data-route data-sub-view>` contract the smoke test reads is kept exactly;
 * `?view=` is parsed as every route's is and a value outside `beats |
 * arrangement` is a 404.
 */
export const BeatsRoute = async ({
  context,
  searchParams,
}: {
  readonly context: EpisodeContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('beats', await searchParams)
  if (!parsed.ok) notFound()
  const { scope, project, episode, address, shape } = context

  const load = await loadBeats(scope, project, episode)
  const base = episodeRouteHref(address, 'beats')
  const created = load.state === 'no-outline' ? new Date() : new Date(load.document.createdAt)

  return (
    <BeatsWorkspace
      projectId={project.id}
      episode={episode.slug}
      project={{ title: project.title }}
      routeId={shape === 'collapsed' ? 'beats' : `${episode.slug}/beats`}
      view={parsed.params.view}
      sheetHref={base}
      beatsState={load.state}
      beats={load.state === 'beats' ? load.beats : []}
      scenes={load.state === 'unreadable' ? [] : load.scenes}
      sheetTitle="Beat Editing"
      sheetDate={created.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
      unreadable={load.state === 'unreadable' ? load.detail : null}
    />
  )
}
