'use client'

import type {
  EpisodeSlug,
  ProjectId,
  StoryThreadRow,
  TimelineEpisodeColumn,
  TimelineSceneRow,
} from '@folio/contracts'
import type { Chronology, ContinuityFinding, StoryJump } from '@folio/script'
import { formatStoryDay } from '@folio/script'
import type { NodeId } from '@folio/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { placeScenes } from '../../../../../../lib/timeline/actions'
import { useSession } from '../../../../../../lib/state/session'
import type { EpisodeRoutePath, ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { Continuity } from './continuity'
import { EmptyTimeline } from './empty-timeline'
import { plural, sceneRef } from './figures'
import { ScenePanel } from './scene-panel'
import { StoryGrid } from './story-grid'
import { useTimelineState } from './timeline-state'

/**
 * The Timeline route's main column: the 46px header (title, the header
 * note, the `Story order / Chronology / Continuity` segment with the open
 * findings badge, `✦ Assume continuous`), the view, the 272px scene panel
 * beside the grid, and the 28px footer (`N scenes · M threads · K
 * flashbacks`, the view's note, `Hide nav`, the save indicator, the route
 * id). `Route - Timeline.dc.html`, with the tokens in place of its hexes.
 *
 * ## `?view=` is the URL; everything else is state
 *
 * The three views are the sub-view param, so the tabs are links. Which
 * scene is selected and which threads are dimmed are `timeline-state.tsx`,
 * shared with the column the layout draws. "Place by hand" is the same.
 *
 * ## Story order, chronology, continuity
 *
 * `story` is page order: columns are episodes as written. `chrono` is
 * story-time order: columns are days. `continuity` lists the findings -
 * scenes whose story time precedes the scene before them on the page - as
 * the pure core computed them over the same rows. Nothing here computes
 * an order; `@folio/script`'s `timeline.ts` did, on the server.
 *
 * ## Not drawn
 *
 * `＋ Event` and `Anchors · fixed dates`: a third authored thing the brief
 * does not name. The `Series / Episode 1` scope toggle: story order's
 * columns are already the episodes. `Cast report`-style exports: none
 * exists. All flagged in the phase report.
 */

export type TimelineView = 'story' | 'chrono' | 'continuity'

export type EpisodeLinks = {
  readonly script: EpisodeRoutePath
  readonly scenes: EpisodeRoutePath
}

export type TimelineWorkspaceProps = {
  readonly projectId: ProjectId
  readonly view: TimelineView
  readonly baseHref: ProjectRoutePath
  readonly scenes: readonly TimelineSceneRow[]
  readonly threads: readonly StoryThreadRow[]
  readonly episodes: readonly TimelineEpisodeColumn[]
  readonly findings: readonly ContinuityFinding[]
  readonly jumps: Readonly<Record<string, StoryJump>>
  readonly chronology: Chronology
  readonly flashbacks: number
  readonly links: Readonly<Record<EpisodeSlug, EpisodeLinks>>
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'error'; readonly message: string }

/** Run a write, and report. `null` from the job means it succeeded. */
export type Run = (job: () => Promise<string | null>) => void

const TABS: readonly { readonly id: TimelineView; readonly label: string; readonly glyph: string }[] = [
  { id: 'story', label: 'Story order', glyph: '▤' },
  { id: 'chrono', label: 'Chronology', glyph: '◷' },
  { id: 'continuity', label: 'Continuity', glyph: '⚠' },
]

export const TimelineWorkspace = ({
  projectId,
  view,
  baseHref,
  scenes,
  threads,
  episodes,
  findings,
  jumps,
  chronology,
  flashbacks,
  links,
}: TimelineWorkspaceProps) => {
  const router = useRouter()
  const session = useSession()
  const { selected, select, byHand } = useTimelineState()
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
  const run: Run = useCallback(
    (job) => {
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
        else {
          if (pending.current === 0) setSaveState({ kind: 'saved' })
          router.refresh()
        }
      })()
    },
    [router],
  )

  const placed = scenes.filter((scene) => scene.storyTime !== null).length
  const unplaced = scenes.length - placed
  const open = findings.filter((finding) => finding.kind === 'order')
  const empty = placed === 0 && threads.length === 0 && !byHand
  const shown: TimelineView | 'empty' = empty ? 'empty' : view

  const selectedScene = selected === null ? null : (scenes.find((scene) => scene.sceneNodeId === selected) ?? null)
  // A selection the load no longer has - a scene deleted elsewhere - is dropped.
  useEffect(() => {
    if (selected !== null && selectedScene === null) select(null)
  }, [selected, selectedScene, select])

  const previousOf = (scene: TimelineSceneRow): TimelineSceneRow | null => {
    const at = scenes.indexOf(scene)
    for (let index = at - 1; index >= 0; index -= 1) {
      const candidate = scenes[index]
      if (candidate !== undefined && candidate.storyTime !== null && !candidate.flashback) return candidate
    }
    return null
  }
  const findingOf = (id: NodeId): ContinuityFinding | null =>
    findings.find((finding) => finding.sceneId === id) ?? null

  const continueFrom = (day: number): void => {
    run(async () => {
      const result = await placeScenes(projectId, day)
      return result.status === 'placed' ? null : result.message
    })
  }
  const lastDay = chronology.days[chronology.days.length - 1]?.day ?? null

  const headerNote =
    shown === 'story'
      ? 'columns are episodes as written · chips show when each scene happens'
      : shown === 'chrono'
        ? 'columns are story days · chips show where each scene sits on the page'
        : shown === 'continuity'
          ? `${plural(open.length, 'place')} where page order and story time disagree`
          : ''
  const footerNote =
    shown === 'continuity'
      ? `${String(open.length)} open`
      : shown === 'empty'
        ? 'Empty'
        : `${shown === 'chrono' ? 'Chronology' : 'Story order'}${selectedScene === null ? '' : ` · ${sceneRef(selectedScene)} selected`}`

  const tabHref = (tab: TimelineView) => (tab === 'story' ? baseHref : (`${baseHref}?view=${tab}` as const))
  const continuityHref = `${baseHref}?view=continuity` as const

  return (
    <main
      data-route="timeline"
      data-sub-view={view}
      data-timeline-state={shown}
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header
        data-timeline-header
        data-mounted={mounted ? 'true' : 'false'}
        className="flex h-[46px] flex-none items-center gap-[10px] border-b border-line px-[14px]"
      >
        <h1 className="m-0 flex-none font-serif text-21 font-medium leading-none tracking-title">Timeline</h1>
        <span className="min-w-0 flex-1 truncate text-11 text-ink3">{headerNote}</span>
        <nav aria-label="Timeline views" className="flex flex-none gap-[2px] rounded-chrome border border-line2 p-[2px]">
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
                {tab.id === 'continuity' && open.length > 0 ? (
                  <span
                    data-continuity-badge
                    className="tabular grid h-[14px] min-w-[14px] place-items-center rounded-chrome bg-note px-[4px] text-9 font-bold text-rail"
                  >
                    {open.length}
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
        {shown !== 'empty' && unplaced > 0 ? (
          <button
            type="button"
            onClick={() => {
              continueFrom(lastDay ?? 1)
            }}
            data-assume-continuous
            className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border border-line2 bg-transparent px-[9px] py-[4px] text-11 text-ink2 hover:bg-hover hover:text-ink"
          >
            <span aria-hidden="true" className="text-10" style={{ fontFamily: 'var(--font-glyph)' }}>
              ✦
            </span>
            {lastDay === null ? 'Assume continuous' : `Continue from ${formatStoryDay(lastDay)}`}
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {shown === 'empty' ? (
          <EmptyTimeline projectId={projectId} scenes={scenes.length} run={run} />
        ) : shown === 'continuity' ? (
          <Continuity
            projectId={projectId}
            scenes={scenes}
            findings={findings}
            placed={placed}
            baseHref={baseHref}
            links={links}
            run={run}
          />
        ) : (
          <>
            <StoryGrid
              view={shown}
              scenes={scenes}
              threads={threads}
              episodes={episodes}
              chronology={chronology}
              jumps={jumps}
              onContinue={continueFrom}
            />
            {selectedScene === null ? (
              <aside
                data-scene-panel="none"
                className="flex w-[272px] flex-none flex-col items-center justify-center border-l border-line bg-panel px-[20px] text-center text-11-5 leading-[1.5] text-ink3"
              >
                Pick a scene to give it a story time and threads.
              </aside>
            ) : (
              <ScenePanel
                key={selectedScene.sceneNodeId}
                projectId={projectId}
                scene={selectedScene}
                previous={previousOf(selectedScene)}
                finding={findingOf(selectedScene.sceneNodeId)}
                previousOfFinding={((): TimelineSceneRow | null => {
                  const finding = findingOf(selectedScene.sceneNodeId)
                  if (finding === null) return null
                  return scenes.find((scene) => scene.sceneNodeId === finding.previousId) ?? null
                })()}
                threads={threads}
                links={links[selectedScene.episode] ?? null}
                continuityHref={continuityHref}
                run={run}
              />
            )}
          </>
        )}
      </div>

      <footer className="flex h-[28px] flex-none items-center gap-[10px] overflow-hidden border-t border-line bg-panel px-[14px] text-10-5 text-ink2">
        <span className="flex-none whitespace-nowrap">
          <b className="font-semibold text-ink">{scenes.length}</b> {scenes.length === 1 ? 'scene' : 'scenes'} ·{' '}
          {plural(threads.length, 'thread')} · {plural(flashbacks, 'flashback')}
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
                : 'authored'}
        </span>
        <span className="flex-none whitespace-nowrap font-mono text-9-5 text-ink3">/timeline</span>
      </footer>
    </main>
  )
}
