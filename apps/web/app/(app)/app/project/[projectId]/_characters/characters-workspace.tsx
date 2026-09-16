'use client'

import type { CastRow, CharacterMap, CharacterProfile, ProjectId, ResolveItem, SceneRef } from '@folio/contracts'
import { useCallback, useMemo, useRef, useState } from 'react'

import { figuresOf, initialsOf, shortName } from '../../../../../../lib/characters/cast'
import type { Derivable } from '../../../../../../lib/characters/server'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { StatusBar } from '../_chrome/status-bar'
import type { SaveIndicator } from '../_chrome/status-bar'
import { CastView } from './cast-view'
import type { Relation } from './character-drawer'
import { CharacterDrawer } from './character-drawer'
import type { CastFilter } from './characters-toolbar'
import { CharactersToolbar } from './characters-toolbar'
import { EmptyCharacters } from './empty-characters'
import { RelationshipsView } from './relationships-view'
import { SheetView } from './sheet-view'
import { useCharactersView } from './view-state'

/**
 * The Characters route's body inside the main-surface card - `Route -
 * Characters v2.dc.html` on the shell phase 1 built: the toolbar
 * (`characters-toolbar.tsx`), one of the three views or the empty card,
 * the 28px status bar (`_chrome/status-bar.tsx`: `6 characters · 3
 * episodes · Meera Pawar`, `Hide nav`, the saved dot, `characters/<id>`),
 * and the drawer when the URL names a record.
 *
 * ## `:characterId` is the URL; everything else is state
 *
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The three views are state the layout holds
 * (`view-state.tsx`, ruled 2026-09-16 - the URL stays `/characters`), so
 * the pill's tabs are buttons; `data-sub-view` keeps its name for the
 * smoke test that reads it. The toolbar's filter, the banner's dismissal,
 * a save in flight: component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator is the only
 * client-held state a write touches. Nothing here computes a count that
 * the loader or `lib/characters/cast.ts` does not.
 */

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

export const CharactersWorkspace = ({
  projectId,
  projectTitle,
  baseHref,
  cast,
  index,
  episodeOrdinals,
  resolve,
  map,
  derivable,
  storage,
  profile,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly baseHref: ProjectRoutePath
  readonly cast: readonly CastRow[]
  readonly index: readonly SceneRef[]
  readonly episodeOrdinals: readonly number[]
  readonly resolve: readonly ResolveItem[]
  readonly map: CharacterMap
  readonly derivable: Derivable | null
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly profile: CharacterProfile | null
}) => {
  const { view } = useCharactersView()
  const [save, setSave] = useState<SaveIndicator>('saved')
  const pending = useRef(0)
  const run: Run = useCallback((job) => {
    pending.current += 1
    setSave('saving')
    void (async () => {
      let failure: string | null
      try {
        failure = await job()
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
      } finally {
        pending.current -= 1
      }
      if (failure !== null) setSave('error')
      else if (pending.current === 0) setSave('saved')
    })()
  }, [])

  const figures = useMemo(() => figuresOf(cast, index, episodeOrdinals, resolve), [cast, episodeOrdinals, index, resolve])
  const [filter, setFilter] = useState<CastFilter>('all')
  const shown = useMemo(
    () =>
      figures.filter((figure) =>
        filter === 'all' ? true : filter.startsWith('group:') ? `group:${figure.group}` === filter : `status:${figure.status}` === filter,
      ),
    [figures, filter],
  )

  const selected = profile === null ? null : (figures.find((figure) => figure.id === profile.id) ?? null)
  const relations = useMemo<readonly Relation[]>(() => {
    if (selected === null) return []
    const row = map.columns.findIndex((column) => column.id === selected.id)
    if (row < 0) return []
    return map.columns
      .map((column, i) => ({ column, shared: map.cells[row]?.[i] ?? 0 }))
      .filter((entry) => entry.column.id !== selected.id && entry.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .map((entry) => ({
        id: entry.column.id,
        short: shortName(entry.column.name),
        initial: initialsOf(entry.column.name),
        hue: entry.column.hue,
        shared: entry.shared,
      }))
  }, [map, selected])

  const empty = figures.length === 0 && resolve.length === 0
  const episodes = episodeOrdinals.length
  const left = empty
    ? `${projectTitle} · ${String(episodes)} ${episodes === 1 ? 'episode' : 'episodes'} · no characters`
    : `${String(figures.length)} ${figures.length === 1 ? 'character' : 'characters'} · ${String(episodes)} ${episodes === 1 ? 'episode' : 'episodes'}${selected === null ? '' : ` · ${selected.name}`}`

  return (
    <main
      data-route="characters"
      data-sub-view={view}
      data-characters-state={empty ? 'empty' : view}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <CharactersToolbar total={figures.length} filter={filter} onFilter={setFilter} />

      {empty ? (
        <EmptyCharacters projectId={projectId} derivable={derivable ?? { count: 0, top: [] }} run={run} />
      ) : view === 'relationships' ? (
        <RelationshipsView projectId={projectId} figures={figures} map={map} episodes={episodes} selectedId={selected?.id ?? null} />
      ) : view === 'sheet' ? (
        <SheetView projectId={projectId} shown={shown} selectedId={selected?.id ?? null} />
      ) : (
        <CastView projectId={projectId} figures={figures} shown={shown} resolve={resolve} selectedId={selected?.id ?? null} storage={storage} run={run} />
      )}

      <StatusBar left={left} save={save} routeId={selected === null ? 'characters' : `characters/${selected.id}`} />

      {profile === null || selected === null ? null : (
        <CharacterDrawer key={profile.id} projectId={projectId} figure={selected} profile={profile} relations={relations} storage={storage} baseHref={baseHref} run={run} />
      )}
    </main>
  )
}
