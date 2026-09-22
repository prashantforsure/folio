'use client'

import type { EpisodeSlug, ProjectId, PropRow, SceneRef } from '@folio/contracts'
import { useEffect, useMemo, useState } from 'react'

import { publishPropFacts } from '../../../../../../lib/props/facts'
import type { Sort, StatusFilter } from '../../../../../../lib/props/view'
import { DEFAULT_SORT, matchesFind, passesFilter, routeIdOf, statusLeft } from '../../../../../../lib/props/view'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { useFind } from '../_chrome/find-field'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { useToast } from '../_chrome/use-toast'
import { EmptyProps } from './empty-props'
import { ListView } from './list-view'
import { OverviewView } from './overview-view'
import { PropDrawer } from './prop-drawer'
import { PropsToolbar } from './props-toolbar'
import { usePropsView } from './view-state'

/**
 * The Props route's body inside the main-surface card: the toolbar
 * (`props-toolbar.tsx`), one of the two views or the empty card, the 28px
 * status bar (`6 props · 29 scenes · Game Ball`, the toast, the saved dot,
 * `props/3f2a9c1e`), and the drawer when the URL names a record.
 *
 * ## `:propId` is the URL; everything else is state
 *
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The two views are state the layout holds
 * (`view-state.tsx`); `data-sub-view` keeps its name for the smoke test
 * that reads it. The toolbar's filter, the sidebar's find, the List's sort,
 * a save in flight, the toast: component state, none of it worth a link.
 *
 * ## One filter, both views
 *
 * `shown` is the rows after the toolbar's status filter and the sidebar's
 * find field, and it is what both views draw. The count chip says `3 of 8`
 * while it narrows.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write - which on this route also
 * re-reads the script, so a newly bound spelling shows its lines on the
 * next paint without anything being stored. Nothing here computes a count
 * that the loader or `lib/props/view.ts` does not.
 */
export type EpisodeRow = { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }

export const PropsWorkspace = ({
  projectId,
  projectTitle,
  shape,
  baseHref,
  rows,
  index,
  sceneTotal,
  categories,
  episodes,
  storage,
  selected,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly baseHref: ProjectRoutePath
  readonly rows: readonly PropRow[]
  readonly index: readonly SceneRef[]
  readonly sceneTotal: number
  readonly categories: readonly string[]
  readonly episodes: readonly EpisodeRow[]
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly selected: PropRow | null
}) => {
  const { view } = usePropsView()
  const { save, run } = useRun('saved')
  const { toast, show } = useToast()
  const { query } = useFind()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const shown = useMemo(() => rows.filter((row) => passesFilter(row, filter) && matchesFind(row, query)), [rows, filter, query])

  const empty = rows.length === 0
  const left = empty
    ? `${projectTitle} · ${String(episodes.length)} ${episodes.length === 1 ? 'episode' : 'episodes'} · no props`
    : statusLeft(rows, sceneTotal, selected)
  const countChip = shown.length === rows.length ? String(rows.length) : `${String(shown.length)} of ${String(rows.length)}`
  const showAll = (): void => {
    setFilter('all')
  }

  useEffect(() => {
    publishPropFacts({
      projectId,
      shape,
      episodes,
      index,
      open: selected === null ? null : { id: selected.id, name: selected.name },
      unsourced: rows
        .filter((row) => row.status === 'needed')
        .map((row) => ({ id: row.id, name: row.name, scenes: row.scenes.length, first: row.firstSeen })),
      unwritten: rows
        .filter((row) => row.lines === 0)
        .map((row) => ({ id: row.id, name: row.name, scenes: 0, first: null })),
    })
  }, [episodes, index, projectId, rows, selected, shape])
  useEffect(
    () => () => {
      publishPropFacts(null)
    },
    [],
  )

  return (
    <main
      data-route="props"
      data-sub-view={view}
      data-props-state={empty ? 'empty' : view}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {empty ? null : <PropsToolbar count={countChip} filter={filter} onFilter={setFilter} />}

      {empty ? (
        <EmptyProps />
      ) : view === 'list' ? (
        <ListView projectId={projectId} shown={shown} sort={sort} onSort={setSort} selectedId={selected?.id ?? null} onShowAll={showAll} total={rows.length} />
      ) : (
        <OverviewView projectId={projectId} shown={shown} selectedId={selected?.id ?? null} storage={storage} run={run} onShowAll={showAll} total={rows.length} />
      )}

      <StatusBar left={left} save={save} routeId={routeIdOf(selected)} toast={toast} />

      {selected === null ? null : (
        <PropDrawer
          key={selected.id}
          projectId={projectId}
          shape={shape}
          row={selected}
          rows={rows}
          categories={categories}
          storage={storage}
          baseHref={baseHref}
          run={run}
          toast={show}
        />
      )}
    </main>
  )
}
