import type { LocationRow } from '@folio/contracts'
import type { LocationId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import { loadLocations, loadSelectedLocation } from '../../../../../../lib/locations/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { locationHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { LocationsWorkspace } from './locations-workspace'

/**
 * The Locations route, server side: one read, then the client workspace.
 *
 * The three views are state, not `?view=` (ruled 2026-09-18,
 * `_locations/view-state.tsx`), so the search params are parsed for the
 * empty schema every route parses and nothing else - a stale `?view=sheet`
 * link opens the places. `/locations/:locationId` opens that record's
 * drawer over the view - the id is the record's UUID, so the URL survives
 * every rename. A record merged into another redirects to the survivor -
 * the loser's row is a tombstone that says where it went - and an id that
 * names nothing here is a 404.
 *
 * `loadLocations` is `cache()`d on the context; the layout beside this
 * page (`_chrome/locations-layout.tsx`) makes the same call for the
 * sidebar, so the two share one read per request. The `<main data-route
 * data-sub-view>` contract the smoke test reads is kept by the workspace
 * exactly.
 */
export const LocationsRoute = async ({
  context,
  searchParams,
  selected,
}: {
  readonly context: ProjectContext
  readonly searchParams: Promise<RawSearchParams>
  readonly selected: LocationId | null
}) => {
  const parsed = parseSubViews('locations', await searchParams)
  if (!parsed.ok) notFound()
  const { project, episodes, shape } = context
  const load = await loadLocations(context)

  let record: LocationRow | null = null
  if (selected !== null) {
    const result = await loadSelectedLocation(context, selected)
    if (result.state === 'merged') redirect(locationHref(project.id, result.into))
    if (result.state === 'missing') notFound()
    record = result.record
  }

  return (
    <LocationsWorkspace
      projectId={project.id}
      projectTitle={project.title}
      shape={shape}
      baseHref={projectRouteHref(project.id, 'locations')}
      charactersHref={projectRouteHref(project.id, 'characters')}
      researchHref={projectRouteHref(project.id, 'research')}
      rows={load.rows}
      resolve={load.resolve}
      index={load.index}
      sceneTotal={load.sceneTotal}
      episodes={episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
      derivable={load.derivable}
      storage={load.storage}
      selected={record}
    />
  )
}
