import { notFound } from 'next/navigation'

import { loadTimeline } from '../../../../../../lib/timeline/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { TimelineWorkspace } from './timeline-workspace'

/**
 * The Timeline route, server side: one read, then the client workspace.
 *
 * The three views are state, not `?view=` (ruled 2026-09-18,
 * `_timeline/view-state.tsx`), so the search params are parsed for the
 * empty schema every route parses and nothing else - a stale
 * `?view=chrono` link opens story order. Which scene is selected and
 * which thread is solo are state too.
 *
 * `loadTimeline` is `cache()`d on the context; the layout beside this
 * page (`_chrome/timeline-layout.tsx`) makes the same call for the
 * sidebar, so the two share one read per request. The `<main data-route
 * data-sub-view>` contract the smoke test reads is kept by the workspace
 * exactly. The order, the findings and the proposals are not loaded: the
 * workspace runs the pure core over these rows, so an edit re-orders the
 * grid before the refresh lands.
 */
export const TimelineRoute = async ({ context, searchParams }: { readonly context: ProjectContext; readonly searchParams: Promise<RawSearchParams> }) => {
  const parsed = parseSubViews('timeline', await searchParams)
  if (!parsed.ok) notFound()
  const { project, shape } = context
  const load = await loadTimeline(context)

  return (
    <TimelineWorkspace
      projectId={project.id}
      projectTitle={project.title}
      shape={shape}
      charactersHref={projectRouteHref(project.id, 'characters')}
      scenes={load.scenes}
      threads={load.threads}
      episodes={load.episodes}
      introductions={load.introductions}
      deliberate={load.deliberate}
    />
  )
}
