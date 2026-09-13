'use client'

import type { CastRow, CharacterMap, CharacterProfile, ProjectId, ResolveItem } from '@folio/contracts'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { CastingTable } from './casting-table'
import { CharacterDrawer } from './character-drawer'
import { EmptyCharacters } from './empty-characters'
import { NewCharacterModal } from './new-character-modal'
import { OverviewGrid } from './overview-grid'
import { Relationships } from './relationships'

/**
 * The Characters route: the 46px header (title, live count, the find box,
 * the `Overview · Relationships · Casting` segment, `＋ New Character`),
 * the view, and the 28px footer (`N characters · M cues · K episodes`,
 * `Hide nav`, the save indicator, the route id). Built to the client's
 * reference in the route's second pass (2026-09-14) - the repo's
 * Characters bundle is not this route's design any more
 * (`docs/build-decisions.md`, "Characters route, second pass").
 *
 * ## `?view=` and `:characterId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the tabs are links. A
 * selected record is the path, and the drawer is what the path renders
 * over the grid. The find filter, an open modal, a graph's mode, a table's
 * sort: component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator here is the
 * only client-held state a write touches. Nothing here computes a count.
 */

export type CharactersView = 'overview' | 'relationships' | 'casting'

export type CharactersWorkspaceProps = {
  readonly projectId: ProjectId
  readonly view: CharactersView
  readonly baseHref: ProjectRoutePath
  readonly cast: readonly CastRow[]
  readonly resolve: readonly ResolveItem[]
  readonly map: CharacterMap
  readonly cueCount: number
  readonly episodes: number
  readonly derivable: number | null
  readonly storage: boolean
  /** The record the drawer shows, when the path names one. */
  readonly profile: CharacterProfile | null
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

const TABS: readonly { readonly id: CharactersView; readonly label: string; readonly glyph: string }[] = [
  { id: 'overview', label: 'Overview', glyph: '◍' },
  { id: 'relationships', label: 'Relationships', glyph: '◎' },
  { id: 'casting', label: 'Casting', glyph: '▤' },
]

export const CharactersWorkspace = ({
  projectId,
  view,
  baseHref,
  cast,
  resolve,
  map,
  cueCount,
  episodes,
  derivable,
  storage,
  profile,
}: CharactersWorkspaceProps) => {
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

  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const closeModal = useCallback(() => {
    setCreating(false)
  }, [])

  const empty = cast.length === 0 && resolve.length === 0
  const shown: CharactersView | 'empty' = empty ? 'empty' : view
  const routeId = profile === null ? '/characters' : `/characters/${profile.id}`

  return (
    <main
      data-route="characters"
      data-sub-view={view}
      data-characters-state={shown}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        data-characters-header
        data-mounted={mounted ? 'true' : 'false'}
        className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]"
      >
        <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Characters</h1>
        <span className="tabular flex-none rounded-chrome bg-sel px-[6px] py-[1px] text-10 font-semibold text-ink2" data-cast-count>
          {cast.length}
        </span>
        {empty ? (
          <div className="flex-1" />
        ) : (
          <label className="ml-[6px] flex min-w-0 max-w-[240px] flex-1 items-center gap-[7px] rounded-chrome border border-line2 bg-sheet px-[9px] py-[4px]">
            <span aria-hidden="true" className="text-11 text-ink3" style={{ fontFamily: 'var(--font-glyph)' }}>
              ⌕
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              placeholder="Find a character"
              aria-label="Find a character"
              className="min-w-0 flex-1 border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
            />
          </label>
        )}
        <div className="min-w-0 flex-1" />
        <nav aria-label="Character views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
          {TABS.map((tab) => {
            const active = tab.id === view
            return (
              <Link
                key={tab.id}
                href={tab.id === 'overview' ? baseHref : (`${baseHref}?view=${tab.id}` as const)}
                aria-current={active ? 'page' : undefined}
                data-view-tab={tab.id}
                className={`flex items-center gap-[6px] whitespace-nowrap rounded-chrome px-[12px] py-[4px] text-11-5 no-underline hover:text-ink hover:no-underline ${
                  active ? 'bg-accent-bg text-accent' : 'text-ink2'
                }`}
              >
                <span aria-hidden="true" className="text-10 opacity-70" style={{ fontFamily: 'var(--font-glyph)' }}>
                  {tab.glyph}
                </span>
                {tab.label}
              </Link>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          data-new-character
          onClick={() => {
            setCreating(true)
          }}
          className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border-none bg-accent px-[12px] py-[6px] text-11-5 font-semibold text-accent-ink hover:opacity-90"
        >
          <span aria-hidden="true" className="text-11 opacity-75" style={{ fontFamily: 'var(--font-glyph)' }}>
            ＋
          </span>
          New Character
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {shown === 'empty' ? (
          <EmptyCharacters
            projectId={projectId}
            derivable={derivable ?? 0}
            onCreate={() => {
              setCreating(true)
            }}
            run={run}
          />
        ) : shown === 'relationships' ? (
          <Relationships projectId={projectId} map={map} />
        ) : shown === 'casting' ? (
          <CastingTable projectId={projectId} cast={cast} query={query} />
        ) : (
          <OverviewGrid projectId={projectId} cast={cast} resolve={resolve} query={query} storage={storage} run={run} />
        )}
      </div>

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap">
          <b className="font-semibold text-ink">{cast.length}</b> characters · {cueCount} cues · {episodes}{' '}
          {episodes === 1 ? 'episode' : 'episodes'}
        </span>
        {resolve.length > 0 ? (
          <>
            <span className="flex-none text-ink3">·</span>
            <span className="flex-none whitespace-nowrap text-note" data-unmatched-count>
              {resolve.length} unmatched {resolve.length === 1 ? 'name' : 'names'} in the script
            </span>
          </>
        ) : null}
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
                : 'from cues'}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>

      {creating ? (
        <NewCharacterModal projectId={projectId} usedColors={cast.map((row) => row.color)} onClose={closeModal} />
      ) : null}
      {profile === null ? null : (
        <CharacterDrawer
          key={profile.id}
          projectId={projectId}
          profile={profile}
          cast={cast}
          storage={storage}
          baseHref={baseHref}
          run={run}
        />
      )}
    </main>
  )
}
