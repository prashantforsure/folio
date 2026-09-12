import type { EpisodeSlug } from '@folio/contracts'
import { notFound } from 'next/navigation'

import { loadTimeline } from '../../../../../../lib/timeline/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { TimelineWorkspace } from './timeline-workspace'
import type { EpisodeLinks } from './timeline-workspace'

/**
 * The Timeline route, server side: one read, then the client workspace.
 *
 * `?view=` is `story | chrono | continuity` (`params.ts`), parsed as every
 * route's is; a value outside it is a 404. Everything else the route
 * shows - which scene is selected, which threads are dimmed - is state,
 * never a param (`timeline-state.tsx`).
 *
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by the workspace exactly. `jumps` crosses the boundary as a record:
 * a `Map` does not serialise.
 */
export const TimelineRoute = async ({
  context,
  searchParams,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
}) => {
  const parsed = parseSubViews('timeline', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episodes, shape } = context
  const load = await loadTimeline(context)

  const links: Record<EpisodeSlug, EpisodeLinks> = Object.fromEntries(
    episodes.map((episode) => {
      const address = { projectId: project.id, shape, episode: episode.slug }
      const pair: EpisodeLinks = {
        script: episodeRouteHref(address, 'script'),
        scenes: episodeRouteHref(address, 'scenes'),
      }
      return [episode.slug, pair]
    }),
  ) as Record<EpisodeSlug, EpisodeLinks>

  return (
    <TimelineWorkspace
      projectId={project.id}
      view={parsed.params.view}
      baseHref={projectRouteHref(project.id, 'timeline')}
      scenes={load.scenes}
      threads={load.threads}
      episodes={load.episodes}
      findings={load.findings}
      jumps={Object.fromEntries(load.jumps)}
      chronology={load.chronology}
      flashbacks={load.flashbacks}
      links={links}
    />
  )
}
