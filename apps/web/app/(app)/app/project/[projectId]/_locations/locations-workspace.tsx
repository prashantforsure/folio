'use client'

import type { LocationRow, ProjectId, SluglineResolveItem } from '@folio/contracts'
import { useMemo, useState } from 'react'

import type { Derivable } from '../../../../../../lib/locations/server'
import type { StatusFilter } from '../../../../../../lib/locations/view'
import { passesFilter, statusLeft } from '../../../../../../lib/locations/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { EmptyLocations } from './empty-locations'
import { LocationDrawer } from './location-drawer'
import type { LocationsView } from './locations-toolbar'
import { LocationsToolbar } from './locations-toolbar'
import { PlacesView } from './places-view'
import { ScenesView } from './scenes-view'
import { SheetView } from './sheet-view'

/**
 * The Locations route's body inside the main-surface card - `Route -
 * Locations v2.dc.html` on the shell phase 1 built: the toolbar
 * (`locations-toolbar.tsx`), one of the three views or the empty card, the
 * 28px status bar (`_chrome/status-bar.tsx`: `6 locations · 29 scenes ·
 * Kamathi Chawl`, `Hide nav`, the saved dot, `locations/<id>`), and the
 * drawer when the URL names a record.
 *
 * ## `?view=` and `:locationId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the pill's tabs are links.
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The toolbar's filter, the banner's dismissal, a save in
 * flight: component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator
 * (`_chrome/use-run.ts`) is the only client-held state a write touches.
 * Nothing here computes a count that the loader or `lib/locations/view.ts`
 * does not.
 */
export const LocationsWorkspace = ({
  projectId,
  projectTitle,
  view,
  baseHref,
  charactersHref,
  rows,
  resolve,
  sceneTotal,
  episodes,
  derivable,
  storage,
  selected,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly view: LocationsView
  readonly baseHref: ProjectRoutePath
  readonly charactersHref: ProjectRoutePath
  readonly rows: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly sceneTotal: number
  readonly episodes: number
  readonly derivable: Derivable | null
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly selected: LocationRow | null
}) => {
  const { save, run } = useRun()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const shown = useMemo(() => rows.filter((row) => passesFilter(row, filter)), [rows, filter])

  const empty = rows.length === 0 && resolve.length === 0
  const left = empty
    ? `${projectTitle} · ${String(episodes)} ${episodes === 1 ? 'episode' : 'episodes'} · no locations`
    : statusLeft(rows, sceneTotal, selected)

  return (
    <main data-route="locations" data-sub-view={view} data-locations-state={empty ? 'empty' : view} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <LocationsToolbar total={rows.length} view={view} baseHref={baseHref} filter={filter} onFilter={setFilter} />

      {empty ? (
        <EmptyLocations projectId={projectId} derivable={derivable ?? { count: 0, sluglines: 0, top: [] }} run={run} />
      ) : view === 'scenes' ? (
        <ScenesView projectId={projectId} shown={shown} selectedId={selected?.id ?? null} />
      ) : view === 'sheet' ? (
        <SheetView projectId={projectId} shown={shown} selectedId={selected?.id ?? null} />
      ) : (
        <PlacesView projectId={projectId} rows={rows} shown={shown} resolve={resolve} selectedId={selected?.id ?? null} storage={storage} run={run} />
      )}

      <StatusBar left={left} save={save} routeId={selected === null ? 'locations' : `locations/${selected.id}`} />

      {selected === null ? null : (
        <LocationDrawer
          key={selected.id}
          projectId={projectId}
          row={selected}
          rows={rows}
          episodes={episodes}
          storage={storage}
          baseHref={baseHref}
          charactersHref={charactersHref}
          run={run}
        />
      )}
    </main>
  )
}
