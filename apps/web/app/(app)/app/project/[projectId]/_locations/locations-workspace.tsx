'use client'

import type {
  BreakdownRow,
  EpisodeSlug,
  LocationRecordView,
  LocationRow,
  ProjectId,
  SluglineResolveItem,
  StructureResolveItem,
} from '@folio/contracts'
import type { LocationId } from '@folio/script'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import { locationHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { Breakdown } from './breakdown'
import { EmptyLocations } from './empty-locations'
import { NewLocationButton } from './location-nav'
import { Record } from './record'
import { ResolveQueue } from './resolve-queue'

/**
 * The Locations route's main column: the 46px header (title, live count,
 * `project-wide · derived from N sluglines`, the `Record / Breakdown /
 * Resolve` segment with the pending badge, `＋ New location`), the view,
 * and the 28px footer (`N locations · M scenes · K sluglines`, the view's
 * note, `Hide nav`, the save indicator, the route id).
 * `Route - Locations.dc.html`, with the tokens in place of its hexes.
 *
 * ## `?view=` and `:locationId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the tabs are links, and the
 * record's id is the path. The find filter, the scene-list filter, a
 * pending rename's confirmation: component state, none of it worth a link.
 *
 * ## The count is primary sets
 *
 * The header pill and the footer's `N locations` count primary sets, as the
 * bundle's `locCount` does (`parentIds.length`): a sub-location is "counted
 * in the parent total", and the number a production office wants is the
 * number of sets. The nav's own header says the same.
 *
 * ## Not drawn
 *
 * `Location report · PDF`: export is a queued job that does not exist yet,
 * the Cast report precedent. The reference box is drawn as the bundle's
 * dashed drop zone and says in its title that there is no file storage to
 * drop into. Both flagged in the phase report.
 */

export type LocationsView = 'record' | 'breakdown' | 'resolve'

export type ElsewhereLinks = {
  readonly characters: ProjectRoutePath
  readonly storyboard: EpisodeRoutePath | null
  readonly production: EpisodeRoutePath | null
}

export type EpisodeHead = {
  readonly slug: EpisodeSlug
  readonly ordinal: number
  readonly title: string
}

export type LocationsWorkspaceProps = {
  readonly projectId: ProjectId
  readonly view: LocationsView
  readonly selected: LocationId | null
  readonly baseHref: ProjectRoutePath
  readonly rows: readonly LocationRow[]
  readonly resolve: readonly SluglineResolveItem[]
  readonly structure: readonly StructureResolveItem[]
  readonly breakdown: readonly BreakdownRow[]
  readonly episodes: readonly EpisodeHead[]
  readonly sceneTotal: number
  readonly sluglineTotal: number
  readonly derivable: { readonly count: number; readonly top: readonly { readonly set: string; readonly n: number }[] } | null
  readonly record: LocationRecordView | null
  readonly links: ElsewhereLinks
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

const TABS: readonly { readonly id: LocationsView; readonly label: string; readonly glyph: string }[] = [
  { id: 'record', label: 'Record', glyph: '▤' },
  { id: 'breakdown', label: 'Breakdown', glyph: '▦' },
  { id: 'resolve', label: 'Resolve', glyph: '⇄' },
]

export const LocationsWorkspace = ({
  projectId,
  view,
  selected,
  baseHref,
  rows,
  resolve,
  structure,
  breakdown,
  episodes,
  sceneTotal,
  sluglineTotal,
  derivable,
  record,
  links,
}: LocationsWorkspaceProps) => {
  const session = useSession()
  const [mounted, setMounted] = useState(false)
  const [viewport, setViewport] = useState(1440)
  useEffect(() => {
    setMounted(true)
    const read = (): void => {
      setViewport(window.innerWidth)
    }
    read()
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
    }
  }, [])
  const navOpen = (mounted ? session.navOpen : null) ?? viewport >= 1000
  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const pending = useRef(0)
  const run: Run = useCallback((job) => {
    pending.current += 1
    setSaveState({ kind: 'saving' })
    void (async () => {
      let failure: string | null
      try {
        failure = await job()
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
      } finally {
        pending.current -= 1
      }
      if (failure !== null) setSaveState({ kind: 'error', message: failure })
      else if (pending.current === 0) setSaveState({ kind: 'saved' })
    })()
  }, [])

  const unmatched = resolve.filter((row) => row.proposal !== null).length
  const primary = rows.filter((row) => row.parentId === null).length
  const empty = rows.length === 0
  const shown: LocationsView | 'empty' = empty ? 'empty' : view

  const headerNote =
    shown === 'empty'
      ? ''
      : `project-wide · derived from ${String(sluglineTotal)} ${sluglineTotal === 1 ? 'slugline' : 'sluglines'}`
  const footerNote =
    shown === 'record' && record !== null
      ? `${record.name} · ${String(record.rollup.scenes)} ${record.rollup.scenes === 1 ? 'scene' : 'scenes'} · ${String(
          record.rollup.dayScenes,
        )} day / ${String(record.rollup.nightScenes)} night`
      : shown === 'breakdown'
        ? 'Breakdown · all episodes'
        : shown === 'resolve'
          ? `${String(unmatched)} ${unmatched === 1 ? 'slugline' : 'sluglines'} to match`
          : shown === 'empty'
            ? 'No locations'
            : ''
  const routeId = shown === 'record' && record !== null ? `/locations/${record.id}` : '/locations'

  const tabHref = (tab: LocationsView) =>
    tab === 'record'
      ? selected === null
        ? baseHref
        : locationHref(projectId, selected)
      : (`${baseHref}?view=${tab}` as const)

  return (
    <main
      data-route="locations"
      data-sub-view={view}
      data-locations-state={shown}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        data-locations-header
        data-mounted={mounted ? 'true' : 'false'}
        className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]"
      >
        <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Locations</h1>
        <span className="tabular flex-none rounded-chrome bg-sel px-[6px] py-[1px] text-10 font-semibold text-ink2" data-location-count>
          {primary}
        </span>
        <span className="min-w-0 flex-1 truncate text-11 text-ink3">{headerNote}</span>
        <nav aria-label="Location views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
          {TABS.map((tab) => {
            const active = tab.id === view
            return (
              <Link
                key={tab.id}
                href={tabHref(tab.id)}
                aria-current={active ? 'page' : undefined}
                data-view-tab={tab.id}
                className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[10px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                  active ? 'bg-accent-bg text-accent' : 'text-ink2'
                }`}
              >
                <span aria-hidden="true" className="text-10 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
                  {tab.glyph}
                </span>
                {tab.label}
                {tab.id === 'resolve' && unmatched > 0 ? (
                  <span
                    data-resolve-badge
                    className="tabular grid h-[14px] min-w-[14px] place-items-center rounded-chrome bg-note px-[4px] text-9 font-bold text-rail"
                  >
                    {unmatched}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        <NewLocationButton projectId={projectId} variant="accent" />
      </header>

      <div className="flex min-h-0 flex-1">
        {shown === 'empty' ? (
          <EmptyLocations projectId={projectId} derivable={derivable ?? { count: 0, top: [] }} run={run} />
        ) : shown === 'record' ? (
          record === null ? (
            <div className="flex flex-1 items-center justify-center text-12 text-ink3">Pick a location from the list.</div>
          ) : (
            <Record
              key={record.id}
              projectId={projectId}
              record={record}
              rows={rows}
              episodes={episodes}
              baseHref={baseHref}
              links={links}
              run={run}
            />
          )
        ) : shown === 'breakdown' ? (
          <Breakdown projectId={projectId} rows={breakdown} episodes={episodes} />
        ) : (
          <ResolveQueue projectId={projectId} rows={resolve} structure={structure} locations={rows} run={run} />
        )}
      </div>

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap">
          <b className="font-semibold text-ink">{primary}</b> {primary === 1 ? 'location' : 'locations'} · {sceneTotal}{' '}
          {sceneTotal === 1 ? 'scene' : 'scenes'} · {sluglineTotal} {sluglineTotal === 1 ? 'slugline' : 'sluglines'}
        </span>
        <span className="flex-none text-ink3">·</span>
        <span className="min-w-0 truncate">{footerNote}</span>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => {
            session.setNavOpen(!navOpen)
          }}
          className="flex-none whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[7px] py-[2px] text-10 text-ink2 hover:bg-hover"
        >
          {navOpen ? 'Hide nav' : 'Show nav'}
        </button>
        <span className="flex flex-none items-center gap-[5px] whitespace-nowrap" data-save-state={saveState.kind}>
          <span
            className={`h-[6px] w-[6px] rounded-full ${
              saveState.kind === 'error' ? 'bg-del' : saveState.kind === 'saving' ? 'bg-note' : 'bg-add'
            }`}
          />
          {saveState.kind === 'saving'
            ? 'saving…'
            : saveState.kind === 'error'
              ? saveState.message
              : saveState.kind === 'saved'
                ? 'saved'
                : 'from sluglines'}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>
    </main>
  )
}
