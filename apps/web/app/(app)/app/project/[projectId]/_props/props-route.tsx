import type { PropRow } from '@folio/contracts'
import type { PropId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import { loadProps, loadSelectedProp } from '../../../../../../lib/props/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { projectRouteHref, propHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { PropsWorkspace } from './props-workspace'

/**
 * The Props route, server side: one read, then the client workspace.
 *
 * The two views are state, not `?view=` (`_props/view-state.tsx`), so the
 * search params are parsed for the empty schema every route parses and
 * nothing else - a stale `?view=list` link opens the overview.
 * `/props/:propId` opens that record's drawer over the view; the id is the
 * record's UUID, so the URL survives every rename. A record merged into
 * another redirects to the survivor - the loser's row is a tombstone that
 * says where it went - and an id that names nothing here is a 404.
 *
 * `loadProps` is `cache()`d on the context; the layout beside this page
 * (`_chrome/props-layout.tsx`) makes the same call for the sidebar, so the
 * two share one read per request. The `<main data-route data-sub-view>`
 * contract the smoke test reads is kept by the workspace exactly.
 */
export const PropsRoute = async ({
  context,
  searchParams,
  selected,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
  readonly selected: PropId | null
}) => {
  const parsed = parseSubViews('props', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episodes, shape } = context
  const load = await loadProps(context)

  let record: PropRow | null = null
  if (selected !== null) {
    const result = await loadSelectedProp(context, selected)
    if (result.state === 'merged') redirect(propHref(project.id, result.into))
    if (result.state === 'missing') notFound()
    record = result.record
  }

  return (
    <PropsWorkspace
      projectId={project.id}
      projectTitle={project.title}
      shape={shape}
      baseHref={projectRouteHref(project.id, 'props')}
      rows={load.rows}
      index={load.index}
      sceneTotal={load.sceneTotal}
      categories={load.categories}
      episodes={episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
      storage={load.storage}
      selected={record}
    />
  )
}
