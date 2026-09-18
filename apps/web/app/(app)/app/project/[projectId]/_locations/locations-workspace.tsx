'use client'

import type { EpisodeSlug, LocationRow, ProjectId, SceneRef, SluglineResolveItem } from '@folio/contracts'
import { useEffect, useMemo, useState } from 'react'

import { publishLocationFacts } from '../../../../../../lib/locations/facts'
import type { Derivable } from '../../../../../../lib/locations/server'
import type { StatusFilter } from '../../../../../../lib/locations/view'
import { matchesFind, passesFilter, routeIdOf, statusLeft } from '../../../../../../lib/locations/view'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { useToast } from '../_characters/use-toast'
import { useFind } from '../_chrome/find-field'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { EmptyLocations } from './empty-locations'
import { LocationDrawer } from './location-drawer'
import { LocationsToolbar } from './locations-toolbar'
import { PlacesView } from './places-view'
import { ScenesView } from './scenes-view'
import { SheetView } from './sheet-view'
import { useLocationsView } from './view-state'

/**
 * The Locations route's body inside the main-surface card: the toolbar
 * (`locations-toolbar.tsx`), one of the three views or the empty card, the
 * 28px status bar (`_chrome/status-bar.tsx`: `6 locations · 29 scenes ·
 * Kamathi Chawl`, the toast after an act that can be taken back, `Hide
 * nav`, the saved dot, `locations/3f2a9c1e`), and the drawer when the URL
 * names a record.
 *
 * ## `:locationId` is the URL; everything else is state
 *
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The three views are state the layout holds
 * (`view-state.tsx`, ruled 2026-09-18 - the URL stays `/locations`), so the
 * pill's tabs are buttons; `data-sub-view` keeps its name for the smoke
 * test that reads it. The toolbar's filter, the sidebar's find, a save in
 * flight, the toast: component state, none of it worth a link.
 *
 * ## One filter, every view
 *
 * `shown` is the rows after the toolbar's status filter and the sidebar's
 * find field, and it is what every view draws. The count chip says `3 of
 * 8` while it narrows. The queue is never filtered: it is a list of
 * decisions, not of records.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator and the toast
 * are the only client-held state a write touches. Nothing here computes a
 * count that the loader or `lib/locations/view.ts` does not.
 *
 * ## What the assistant panel is told
 *
 * The workspace publishes `lib/locations/facts.ts` after every render - the
 * open record, the one-off places, the night exteriors, the scene index -
 * so the panel's report chips answer without a model and its `Scene N`
 * chips can link. Cleared on unmount.
 */
export type EpisodeRow = { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }

export const LocationsWorkspace = ({
  projectId,
  projectTitle,
  shape,
  baseHref,
  charactersHref,
  researchHref,
  rows,
  resolve,
  index,
  sceneTotal,
  episodes,
  derivable,
  storage,
  selected,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly baseHref: ProjectRoutePath
  readonly charactersHref: ProjectRoutePath
  readonly researchHref: ProjectRoutePath
  readonly rows: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly index: readonly SceneRef[]
  readonly sceneTotal: number
  readonly episodes: readonly EpisodeRow[]
  readonly derivable: Derivable | null
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly selected: LocationRow | null
}) => {
  const { view } = useLocationsView()
  const { save, run } = useRun('saved')
  const { toast, show } = useToast()
  const { query } = useFind()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const shown = useMemo(() => rows.filter((row) => passesFilter(row, filter) && matchesFind(row, query)), [rows, filter, query])

  const empty = rows.length === 0 && resolve.length === 0
  const left = empty
    ? `${projectTitle} · ${String(episodes.length)} ${episodes.length === 1 ? 'episode' : 'episodes'} · no locations`
    : statusLeft(rows, sceneTotal, selected)
  const countChip = shown.length === rows.length ? String(rows.length) : `${String(shown.length)} of ${String(rows.length)}`
  const showAll = (): void => {
    setFilter('all')
  }

  useEffect(() => {
    publishLocationFacts({
      projectId,
      shape,
      episodes,
      index,
      open: selected === null ? null : { id: selected.id, name: selected.name },
      oneOffs: rows
        .filter((row) => row.kind === 'one-off')
        .map((row) => ({ id: row.id, name: row.name, scenes: row.rollup.scenes, first: row.firstSeen })),
      nightExteriors: rows
        .filter((row) => row.parentId === null && row.rollupQuadrant.extNight > 0)
        .sort((a, b) => b.rollupQuadrant.extNight - a.rollupQuadrant.extNight)
        .map((row) => ({ id: row.id, name: row.name, scenes: row.rollup.scenes, first: row.firstSeen, nights: row.rollupQuadrant.extNight })),
    })
  }, [episodes, index, projectId, rows, selected, shape])
  useEffect(
    () => () => {
      publishLocationFacts(null)
    },
    [],
  )

  return (
    <main data-route="locations" data-sub-view={view} data-locations-state={empty ? 'empty' : view} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {empty ? null : <LocationsToolbar count={countChip} filter={filter} onFilter={setFilter} />}

      {empty ? (
        <EmptyLocations projectId={projectId} derivable={derivable ?? { count: 0, sluglines: 0, top: [] }} run={run} />
      ) : view === 'scenes' ? (
        <ScenesView projectId={projectId} shape={shape} shown={shown} episodes={episodes} selectedId={selected?.id ?? null} onShowAll={showAll} />
      ) : view === 'sheet' ? (
        <SheetView projectId={projectId} shape={shape} shown={shown} episodes={episodes} selectedId={selected?.id ?? null} onShowAll={showAll} />
      ) : (
        <PlacesView
          projectId={projectId}
          shape={shape}
          rows={rows}
          shown={shown}
          resolve={resolve}
          index={index}
          episodes={episodes}
          selectedId={selected?.id ?? null}
          storage={storage}
          run={run}
          toast={show}
          onShowAll={showAll}
        />
      )}

      <StatusBar left={left} save={save} routeId={routeIdOf(selected)} toast={toast} />

      {selected === null ? null : (
        <LocationDrawer
          key={selected.id}
          projectId={projectId}
          shape={shape}
          row={selected}
          rows={rows}
          index={index}
          episodes={episodes}
          storage={storage}
          baseHref={baseHref}
          charactersHref={charactersHref}
          researchHref={researchHref}
          run={run}
          toast={show}
        />
      )}
    </main>
  )
}
