'use client'

import type {
  CastRow,
  CharacterMap,
  CharacterProfile,
  ProjectId,
  ResolveItem,
  SceneRef,
} from '@folio/contracts'
import type { CharacterId } from '@folio/script'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { NewCharacterButton } from './cast-nav'
import { EmptyCharacters } from './empty-characters'
import { Profile } from './profile'
import { ResolveQueue } from './resolve-queue'
import { WhoMeetsWhom } from './who-meets-whom'

/**
 * The Characters route's main column: the 46px header (title, live count,
 * the header note, the `Profile / Who meets whom / Resolve` segment with
 * the pending badge, `＋ New character`), the view, and the 28px footer
 * (`N characters · M cues · K episodes`, the view's note, `Hide nav`, the
 * save indicator, the route id). `Route - Characters.dc.html`, with the
 * tokens in place of its hexes.
 *
 * ## `?view=` and `:characterId` are the URL; everything else is state
 *
 * The three views are the sub-view param, so the tabs are links, and the
 * profile's record is the path. The find filter, an open picker, a pending
 * rename's confirmation: component state, none of it worth a link.
 *
 * ## Every write returns a result, and the page re-reads
 *
 * The actions revalidate the workspace path, so the router refreshes the
 * server-rendered read after each write; the save indicator here is the
 * only client-held state a write touches. Nothing here computes a count.
 *
 * ## Not drawn
 *
 * `Cast report · PDF`: export is a queued job that does not exist yet, and
 * a button that does nothing is a placeholder (the Scenes precedent). The
 * portrait's "Drop a reference" is drawn as the bundle's dashed box with
 * the chip, and says so in its title: there is no file storage to drop
 * into. Both flagged in the phase report.
 */

export type CharactersView = 'profile' | 'map' | 'resolve'

export type ElsewhereLinks = {
  readonly locations: ProjectRoutePath
  readonly bible: ProjectRoutePath
  readonly timeline: ProjectRoutePath
  readonly insights: ProjectRoutePath
  readonly production: EpisodeRoutePath | null
}

export type CharactersWorkspaceProps = {
  readonly projectId: ProjectId
  readonly view: CharactersView
  readonly selected: CharacterId | null
  readonly baseHref: ProjectRoutePath
  readonly cast: readonly CastRow[]
  readonly resolve: readonly ResolveItem[]
  readonly map: CharacterMap
  readonly cueCount: number
  readonly episodes: number
  readonly derivable: number | null
  readonly profile: CharacterProfile | null
  readonly sceneRefs: readonly SceneRef[]
  readonly links: ElsewhereLinks
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

const TABS: readonly { readonly id: CharactersView; readonly label: string; readonly glyph: string }[] = [
  { id: 'profile', label: 'Profile', glyph: '▤' },
  { id: 'map', label: 'Who meets whom', glyph: '▦' },
  { id: 'resolve', label: 'Resolve', glyph: '⇄' },
]

export const CharactersWorkspace = ({
  projectId,
  view,
  selected,
  baseHref,
  cast,
  resolve,
  map,
  cueCount,
  episodes,
  derivable,
  profile,
  sceneRefs,
  links,
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

  const unresolved = resolve.filter((row) => row.proposal !== null).length
  const empty = cast.length === 0
  const shown: CharactersView | 'empty' = empty ? 'empty' : view

  const headerNote =
    shown === 'profile'
      ? 'project-wide · counts come from character cues in the script'
      : shown === 'map'
        ? `shared scenes across ${String(episodes)} ${episodes === 1 ? 'episode' : 'episodes'}`
        : shown === 'resolve'
          ? `${String(unresolved)} ${unresolved === 1 ? 'cue' : 'cues'} to match`
          : ''
  const footerNote =
    shown === 'profile' && profile !== null
      ? `${profile.name} · ${String(profile.appearances)} scenes · ${String(profile.lines)} lines`
      : shown === 'map'
        ? 'Who meets whom'
        : shown === 'resolve'
          ? 'Resolve'
          : shown === 'empty'
            ? 'Empty'
            : ''
  const routeId =
    shown === 'profile' && profile !== null ? `/characters/${profile.id}` : '/characters'

  const tabHref = (tab: CharactersView) =>
    tab === 'profile'
      ? selected === null
        ? baseHref
        : characterHref(projectId, selected)
      : (`${baseHref}?view=${tab}` as const)

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
        <span className="min-w-0 flex-1 truncate text-11 text-ink3">{headerNote}</span>
        <nav aria-label="Character views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
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
                {tab.id === 'resolve' && unresolved > 0 ? (
                  <span
                    data-resolve-badge
                    className="tabular grid h-[14px] min-w-[14px] place-items-center rounded-chrome bg-note px-[4px] text-9 font-bold text-rail"
                  >
                    {unresolved}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        <NewCharacterButton projectId={projectId} variant="accent" />
      </header>

      <div className="flex min-h-0 flex-1">
        {shown === 'empty' ? (
          <EmptyCharacters projectId={projectId} derivable={derivable ?? 0} run={run} />
        ) : shown === 'profile' ? (
          profile === null ? (
            <div className="flex flex-1 items-center justify-center text-12 text-ink3">Pick a character from the list.</div>
          ) : (
            <Profile
              key={profile.id}
              projectId={projectId}
              profile={profile}
              cast={cast}
              sceneRefs={sceneRefs}
              baseHref={baseHref}
              links={links}
              run={run}
            />
          )
        ) : shown === 'map' ? (
          <WhoMeetsWhom projectId={projectId} map={map} episodes={episodes} timelineHref={links.timeline} />
        ) : (
          <ResolveQueue projectId={projectId} rows={resolve} cast={cast} run={run} />
        )}
      </div>

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap">
          <b className="font-semibold text-ink">{cast.length}</b> characters · {cueCount} cues · {episodes}{' '}
          {episodes === 1 ? 'episode' : 'episodes'}
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
                : 'from cues'}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">{routeId}</span>
      </footer>
    </main>
  )
}
