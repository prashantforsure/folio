'use client'

import type { CastRow, CharacterMap, CharacterProfile, EpisodeSlug, PairItem, ProjectId, ResolveItem, SceneFacts } from '@folio/contracts'
import { useEffect, useMemo, useState } from 'react'

import { figuresOf, initialsOf, neverShare, routeIdOf } from '../../../../../../lib/characters/cast'
import { publishCharacterFacts } from '../../../../../../lib/characters/facts'
import type { Derivable } from '../../../../../../lib/characters/server'
import { useNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { offerUndo } from '../../../../../../lib/characters/undo'
import type { ProjectRoutePath, WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { StatusBar } from '../_chrome/status-bar'
import { useRun } from '../_chrome/use-run'
import { CastView } from './cast-view'
import type { Relation } from './character-drawer'
import { CharacterDrawer } from './character-drawer'
import type { CastFilter } from './characters-toolbar'
import { CharactersToolbar, passesFilter } from './characters-toolbar'
import { EmptyCharacters } from './empty-characters'
import { NewCharacterDrawer } from './new-character-drawer'
import { PresenceView } from './presence-view'
import { SheetView } from './sheet-view'
import { useToast } from './use-toast'
import { useCharactersView } from './view-state'

/**
 * The Characters route's body inside the main-surface card: the toolbar
 * (`characters-toolbar.tsx`), one of the three views or the empty card,
 * the 28px status bar (`_chrome/status-bar.tsx`: `6 characters · 3
 * episodes · Meera Pawar`, the toast after an act that can be taken back,
 * `Hide nav`, the saved dot, `characters/3f2a9c1e`), and one drawer -
 * `New character`, or the record the URL names.
 *
 * ## `:characterId` is the URL; everything else is state
 *
 * The selected record is the path, and the drawer is what the path renders
 * over the view. The three views are state the layout holds
 * (`view-state.tsx`, ruled 2026-09-16 - the URL stays `/characters`), so
 * the pill's tabs are buttons; `data-sub-view` keeps its name for the
 * smoke test that reads it. The toolbar's filter, a save in flight, the
 * toast, the rename's undo offer: component state, none of it worth a link.
 *
 * ## One filter, every view
 *
 * `shown` is the cast after the toolbar's filter, and it is what every
 * view draws - the cast, the sheet, and the Presence grid narrowed to it.
 * The count chip says `3 of 8` while it narrows. The queue is never
 * filtered: it is a list of decisions, not of records.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator and the toast
 * are the only client-held state a write touches. Nothing here computes a
 * count that the loader or `lib/characters/cast.ts` does not.
 *
 * ## What the assistant panel is told
 *
 * The workspace publishes `lib/characters/facts.ts` after every render of
 * its figures - the open record, the never-share pair, the records with no
 * description, the scene index - so the panel's report chips can answer
 * without a model and its `Scene N` chips can link. Cleared on unmount,
 * as is the rename's undo offer.
 */
export type { Run } from '../_chrome/use-run'

export type EpisodeRow = { readonly slug: EpisodeSlug; readonly ordinal: number; readonly title: string }

export const CharactersWorkspace = ({
  projectId,
  projectTitle,
  shape,
  baseHref,
  cast,
  index,
  episodes,
  resolve,
  pairs,
  walkOns,
  map,
  derivable,
  storage,
  assistant,
  profile,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly baseHref: ProjectRoutePath
  readonly cast: readonly CastRow[]
  readonly index: readonly SceneFacts[]
  readonly episodes: readonly EpisodeRow[]
  readonly resolve: readonly ResolveItem[]
  readonly pairs: readonly PairItem[]
  readonly walkOns: readonly ResolveItem[]
  readonly map: CharacterMap
  readonly derivable: Derivable | null
  readonly storage: boolean
  /** Whether `ANTHROPIC_API_KEY` is set - the drawer's model actions. */
  readonly assistant: boolean
  /** The record the drawer shows, when the path names one. */
  readonly profile: CharacterProfile | null
}) => {
  const { view } = useCharactersView()
  const { save, run } = useRun('saved')
  const { toast, show } = useToast()
  const newOpen = useNewCharacterOpen()

  const episodeOrdinals = useMemo(() => episodes.map((episode) => episode.ordinal), [episodes])
  const figures = useMemo(() => figuresOf(cast, index, episodeOrdinals, resolve), [cast, episodeOrdinals, index, resolve])
  const [filter, setFilter] = useState<CastFilter>('all')
  const shown = useMemo(() => figures.filter((figure) => passesFilter(figure, filter)), [figures, filter])

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
        short: entry.column.name,
        initial: initialsOf(entry.column.name),
        hue: entry.column.hue,
        shared: entry.shared,
      }))
  }, [map, selected])

  const empty = figures.length === 0 && resolve.length === 0
  const episodeCount = episodes.length
  const left = empty
    ? `${projectTitle} · ${String(episodeCount)} ${episodeCount === 1 ? 'episode' : 'episodes'} · no characters`
    : `${String(figures.length)} ${figures.length === 1 ? 'character' : 'characters'} · ${String(episodeCount)} ${episodeCount === 1 ? 'episode' : 'episodes'}${selected === null ? '' : ` · ${selected.name}`}`
  const countChip = shown.length === figures.length ? String(figures.length) : `${String(shown.length)} of ${String(figures.length)}`

  useEffect(() => {
    const groups = map.columns.map((column) => figures.find((figure) => figure.id === column.id)?.group ?? 'supporting')
    const pair = neverShare(map, groups)
    const person = (i: number) => {
      const column = map.columns[i]
      const figure = column === undefined ? undefined : figures.find((entry) => entry.id === column.id)
      return column === undefined || figure === undefined
        ? null
        : { id: column.id, name: column.name, scenes: column.scenes, first: figure.first }
    }
    const a = pair === null ? null : person(pair[0])
    const b = pair === null ? null : person(pair[1])
    publishCharacterFacts({
      projectId,
      shape,
      episodes,
      index,
      open: selected === null ? null : { id: selected.id, name: selected.name },
      neverShare: a === null || b === null ? null : { a, b, episodes: episodeCount },
      noDescription: figures.filter((figure) => figure.bio === null).map((figure) => ({ id: figure.id, name: figure.name })),
    })
  }, [episodeCount, episodes, figures, index, map, projectId, selected, shape])
  useEffect(
    () => () => {
      publishCharacterFacts(null)
      offerUndo(null)
    },
    [],
  )

  return (
    <main
      data-route="characters"
      data-sub-view={view}
      data-characters-state={empty ? 'empty' : view}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {empty ? null : <CharactersToolbar count={countChip} filter={filter} onFilter={setFilter} />}

      {empty ? (
        <EmptyCharacters projectId={projectId} derivable={derivable ?? { count: 0, top: [] }} run={run} />
      ) : view === 'presence' ? (
        <PresenceView
          projectId={projectId}
          shape={shape}
          figures={shown}
          index={index}
          map={map}
          episodes={episodeCount}
          selectedId={selected?.id ?? null}
          onShowAll={() => {
            setFilter('all')
          }}
        />
      ) : view === 'sheet' ? (
        <SheetView
          projectId={projectId}
          shape={shape}
          shown={shown}
          index={index}
          episodes={episodes}
          selectedId={selected?.id ?? null}
          onShowAll={() => {
            setFilter('all')
          }}
        />
      ) : (
        <CastView
          projectId={projectId}
          shape={shape}
          figures={figures}
          shown={shown}
          index={index}
          resolve={resolve}
          pairs={pairs}
          walkOns={walkOns}
          selectedId={selected?.id ?? null}
          storage={storage}
          run={run}
          toast={show}
          onShowAll={() => {
            setFilter('all')
          }}
        />
      )}

      <StatusBar left={left} save={save} routeId={routeIdOf(selected)} toast={toast} />

      {newOpen ? (
        <NewCharacterDrawer projectId={projectId} usedHues={cast.map((row) => row.hue)} run={run} />
      ) : profile === null || selected === null ? null : (
        <CharacterDrawer
          key={profile.id}
          projectId={projectId}
          shape={shape}
          figure={selected}
          profile={profile}
          cast={figures}
          index={index}
          relations={relations}
          storage={storage}
          assistant={assistant}
          baseHref={baseHref}
          run={run}
          toast={show}
        />
      )}
    </main>
  )
}
