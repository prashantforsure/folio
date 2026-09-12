import type { LocationRecordView } from '@folio/contracts'
import type { LocationId } from '@folio/script'
import { notFound, redirect } from 'next/navigation'

import { loadLocationRecord, loadLocations } from '../../../../../../lib/locations/server'
import type { ProjectContext } from '../../../../../../lib/workspace/context'
import { episodeRouteHref, locationHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { RawSearchParams } from '../../../../../../lib/workspace/params'
import { parseSubViews } from '../../../../../../lib/workspace/params'
import { LocationsWorkspace } from './locations-workspace'

/**
 * The Locations route, server side: one read, then the client workspace.
 *
 * `?view=` is `record | breakdown | resolve` (`params.ts`), parsed as every
 * route's is; a value outside it is a 404. Which record the record view
 * shows is the URL: `/locations/:locationId`, or the first in tree order at
 * `/locations`. A record merged into another redirects to the survivor -
 * the loser's row is a tombstone that says where it went - and an id that
 * names nothing here is a 404. The same shape as the Characters route,
 * because the spec gives the two the same identity model.
 *
 * The `<main data-route data-sub-view>` contract the smoke test reads is
 * kept by the workspace exactly.
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
  const view = parsed.params.view
  const { project, episodes, shape } = context
  const load = await loadLocations(context)

  let record: LocationRecordView | null = null
  const target = selected ?? (view === 'record' ? (load.rows[0]?.id ?? null) : null)
  if (target !== null) {
    const result = await loadLocationRecord(context, target)
    if (result.state === 'merged') redirect(locationHref(project.id, result.into))
    if (result.state === 'missing') {
      if (selected !== null) notFound()
    } else {
      record = result.record
    }
  }

  const first = episodes[0]
  const address = first === undefined ? null : { projectId: project.id, shape, episode: first.slug }

  return (
    <LocationsWorkspace
      projectId={project.id}
      view={view}
      selected={selected}
      baseHref={projectRouteHref(project.id, 'locations')}
      rows={load.rows}
      resolve={load.resolve}
      structure={load.structure}
      breakdown={load.breakdown}
      episodes={episodes.map((episode) => ({ slug: episode.slug, ordinal: episode.ordinal, title: episode.title }))}
      sceneTotal={load.sceneTotal}
      sluglineTotal={load.sluglineTotal}
      derivable={load.derivable}
      record={record}
      links={{
        characters: projectRouteHref(project.id, 'characters'),
        storyboard: address === null ? null : episodeRouteHref(address, 'storyboard'),
        production: address === null ? null : episodeRouteHref(address, 'production'),
      }}
    />
  )
}
