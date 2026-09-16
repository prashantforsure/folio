import type { ResearchSourceId } from '@folio/contracts'
import { notFound, redirect } from 'next/navigation'

import { loadResearch } from '../../../../../../lib/research/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { projectRouteHref, researchSourceHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { ResearchWorkspace } from './research-workspace'

/**
 * The Research route, server side: one read, then the client workspace.
 *
 * `?view=` is `library | source | clips` (`params.ts`), parsed as every
 * route's is; a value outside it is a 404. Which source the source view
 * shows is the URL - `/research/:sourceId`, the path the mockup's status
 * bar writes - so `?view=source` on the bare path names no source and
 * goes to the first one (the library's order, newest first), or back to
 * the library when there is none. On a source's own path the view is the
 * source, whatever the param says: the path is the more specific address.
 * An id that names nothing here is a 404, as `/characters/:id` is.
 *
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by the workspace exactly.
 */
export const ResearchRoute = async ({
  context,
  searchParams,
  selected,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
  readonly selected: ResearchSourceId | null
}) => {
  const parsed = parseSubViews('research', await searchParams)
  if (!parsed.ok) notFound()
  const { project } = context
  const load = await loadResearch(context)
  const baseHref = projectRouteHref(project.id, 'research')

  let view = parsed.params.view
  let source = null
  if (selected !== null) {
    source = load.sources.find((row) => row.id === selected) ?? null
    if (source === null) notFound()
    view = 'source'
  } else if (view === 'source') {
    const first = load.sources[0]
    redirect(first === undefined ? baseHref : researchSourceHref(project.id, first.id))
  }

  return (
    <ResearchWorkspace
      projectId={project.id}
      projectTitle={project.title}
      view={view}
      baseHref={baseHref}
      sources={load.sources}
      collections={load.collections}
      clips={load.clips}
      targets={load.targets}
      source={source}
    />
  )
}
