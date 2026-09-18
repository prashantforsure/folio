'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense, useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import type { ShareLinkView } from '../../../../../../lib/share/result'
import { defaultEpisodeTitle, episodeNumber } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { episodeRouteHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { EpisodeRoute, WorkspaceRoute } from '../../../../../../lib/workspace/routes'
import { ROUTE_TITLE, isEpisodeRoute, isProjectRoute, isWritingRoute } from '../../../../../../lib/workspace/routes'
import { ScenesHeaderViews } from '../_scenes/view-state'
import { StoryboardHeaderViews } from '../_storyboard/view-state'
import { EpisodeDeleteConfirm } from './episode-delete-confirm'
import { EpisodeForm } from './episode-form'
import { HeaderViews } from './header-views'
import { Orb } from './orb'
import { SharePopover } from './share-popover'

/**
 * The header. 60px - `docs/ui design/README.md`, "Header": "Breadcrumb on
 * the left, `Share` and the assistant orb on the right." Every rebuilt
 * route's layout renders it: the writing layout for the four writing
 * routes, and Production's, Characters', Locations', Research's and the
 * Timeline's for themselves.
 *
 * Left: `Project / Episode ▾`. The episode is a menu of the project's
 * episodes, each a link to the same route on that episode, with `Rename
 * episode…`, `New episode…` and - while there is more than one - `Delete
 * episode…` at the foot, each opening its form or confirm in the same box;
 * a film has one episode and no menu. The breadcrumb's
 * container is *not* `overflow:hidden` as the mockup's is: the menu is
 * positioned inside it, and the mockup's hidden overflow clipped the whole
 * menu to nothing (found 2026-09-16 - "there is no option to switch"). The
 * project title truncates on its own instead. Right: Share (a popover over
 * share links) and the orb, which opens the assistant and hides while it is
 * open (README: "The header orb hides while the panel is open").
 *
 * ## The centre is the route's views - ruled 2026-09-17
 *
 * The README put a Write / Storyboard mode pill here on the writing routes.
 * The client ruled it out: the sidebar has a Script row, so `Write` named
 * nothing the sidebar did not, and Storyboard became a row under it
 * (`lib/workspace/routes.ts`, `SIDEBAR`). In its place the centre draws the
 * current route's sub-views - `Boards · Canvas · Shot list` on the
 * Storyboard, `Scene · Episode` on Production, and so on
 * (`lib/workspace/views.ts`) - each tab its icon, where the design has
 * one, beside its name, lit by `?view=` (`header-views.tsx`). The routes'
 * toolbars stopped drawing their own pill the same day. A route with no
 * views (Script, Outline) has an empty centre. Three routes' views are
 * state, not the URL: Characters' layout hands its tabs in as `views` and
 * this draws them in the same slot; the Storyboard and Scenes sit under the
 * shared writing layout, which cannot see its child, so this draws
 * `_storyboard/view-state.tsx`'s or `_scenes/view-state.tsx`'s tabs itself
 * when the segment says `storyboard` or `scenes` (both ruled 2026-09-17,
 * the same ruling as Characters').
 *
 * `useSearchParams` in the centre is under a `Suspense` so a render that
 * has no request search params yet (a static prerender, which no route
 * here is) falls back to nothing rather than to an error.
 *
 * The centre is wider than the pill it replaced (three named tabs against
 * two), so the halves give way before it does: the left half truncates
 * the project title and then the episode crumb (`min-w-0` down the chain),
 * and the right half keeps `min-width: fit-content` so Share and the orb
 * are never pushed under the tabs - at the README's narrowest in-flow
 * case (1200px, sidebar and assistant both open) the pill sits a little
 * left of centre rather than over anything.
 *
 * Presence avatars and the Read button are not drawn - ruled 2026-09-16:
 * no presence (no realtime), Read left out.
 *
 * ## The route: told, or read from the segment
 *
 * Production's, Characters', Locations' and Research's layouts render this
 * header with `route` (a layout that *is* the route knows it; the segment
 * hook cannot see it from there), and the breadcrumb grows its third crumb,
 * the route's title (`Route - Production v2.dc.html`: `Project / Episode 1
 * / Production`). The writing layout cannot pass it and the header reads
 * the segment below `(writing)` instead.
 *
 * Characters is project-scoped and passes no `current` episode: the crumb
 * is `Project / Characters` (`Route - Characters v2.dc.html`) and there is
 * no episode menu.
 */
export type EpisodeChoice = {
  readonly slug: EpisodeSlug
  readonly ordinal: number
  readonly title: string
}

export const WritingHeader = ({
  projectId,
  projectTitle,
  shape,
  episodes,
  current,
  share,
  route: given,
  views,
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly episodes: readonly EpisodeChoice[]
  /** The episode in the breadcrumb. Absent on a project-scoped route (Characters): `Project / Characters`, no episode crumb. */
  readonly current?: EpisodeChoice
  readonly share: ShareLinkView
  /** The route, when the layout is the route (Production, Characters). Absent: read from the segment below `(writing)`. */
  readonly route?: WorkspaceRoute
  /** The centre, when the route's views are not `?view=` and the layout is the route (Characters): its own tabs. Absent: the Storyboard's or Scenes' state tabs on their segment, else the route's `ROUTE_VIEWS` over the URL. */
  readonly views?: ReactNode
}) => {
  // The route below the `(writing)` layout: `script`, `outline`, `storyboard`
  // or `scenes`. A layout cannot pass it; the segment hook can see it.
  const segment = useSelectedLayoutSegment()
  const route: WorkspaceRoute = given ?? (segment !== null && isWritingRoute(segment) ? segment : 'script')
  const writing = isWritingRoute(route)
  const session = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const assistantOpen = (mounted ? session.assistantOpen : null) ?? false
  const address = current === undefined ? null : { projectId, shape, episode: current.slug }
  // Where the route's tabs link: the episode's route, or the project's.
  const baseHref = isProjectRoute(route) ? projectRouteHref(projectId, route) : address === null ? null : episodeRouteHref(address, route)

  return (
    <header data-writing-header className="relative flex h-[60px] flex-none items-center gap-[10px] pl-[4px] pr-[14px]">
      <div className="flex min-w-0 flex-1 items-center gap-[8px] text-13">
        <span className="min-w-0 truncate whitespace-nowrap text-ink3">{projectTitle}</span>
        {shape === 'episodic' && current !== undefined && isEpisodeRoute(route) ? (
          <>
            <span className="text-ink3">/</span>
            <EpisodeMenu projectId={projectId} shape={shape} episodes={episodes} current={current} route={route} />
          </>
        ) : null}
        {writing ? null : (
          <>
            <span className="flex-none text-ink3">/</span>
            <span className="min-w-0 truncate whitespace-nowrap" data-route-crumb>
              {ROUTE_TITLE[route]}
            </span>
          </>
        )}
      </div>

      <div data-header-views={route} className="flex flex-none items-center">
        {views !== undefined ? (
          views
        ) : route === 'storyboard' ? (
          <StoryboardHeaderViews />
        ) : route === 'scenes' ? (
          <ScenesHeaderViews />
        ) : baseHref === null ? null : (
          <Suspense fallback={null}>
            <HeaderViews route={route} baseHref={baseHref} />
          </Suspense>
        )}
      </div>

      <div className="flex min-w-fit flex-1 items-center justify-end gap-[8px]">
        <SharePopover projectId={projectId} initial={share} />
        {assistantOpen ? null : (
          <button
            type="button"
            title="Assistant"
            aria-label="Open the assistant"
            data-assistant-orb
            onClick={() => {
              session.setAssistantOpen(true)
            }}
            className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-full border-none bg-transparent p-0"
          >
            <Orb size={26} />
          </button>
        )}
      </div>
    </header>
  )
}

const EpisodeMenu = ({
  projectId,
  shape,
  episodes,
  current,
  route,
}: {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episodes: readonly EpisodeChoice[]
  readonly current: EpisodeChoice
  readonly route: EpisodeRoute
}) => {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'create' | 'rename' | 'delete'>('list')
  const root = useRef<HTMLDivElement>(null)
  const close = (): void => {
    setOpen(false)
    setView('list')
  }
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) {
        setOpen(false)
        setView('list')
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        setView('list')
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const nextOrdinal = (episodes.at(-1)?.ordinal ?? 0) + 1

  return (
    <div ref={root} className="relative min-w-0 shrink">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-episode-menu
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
        className="folio-ghost-button flex max-w-full items-center gap-[6px] rounded-[8px] px-[8px] py-[5px] text-13 text-ink"
      >
        <span className="truncate">{defaultEpisodeTitle(current.ordinal)}</span>
        <Icon name="chevron" size={11} strokeWidth={1.5} className="flex-none opacity-50" />
      </button>
      {open && view === 'list' ? (
        <div role="menu" data-episode-menu-list className="folio-menu absolute left-0 top-[36px] w-[300px]">
          <div className="flex max-h-[min(60vh,480px)] flex-col gap-[2px] overflow-y-auto">
            {episodes.map((episode) => (
              <Link
                key={episode.slug}
                href={episodeRouteHref({ projectId, shape, episode: episode.slug }, route)}
                role="menuitem"
                aria-current={episode.slug === current.slug ? 'true' : undefined}
                data-menu-episode={episode.slug}
                className="folio-menu-item"
                onClick={close}
              >
                <span className="w-[26px] flex-none font-mono text-10-5 text-ink3">{episodeNumber(episode.ordinal)}</span>
                <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                {episode.slug === current.slug ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
              </Link>
            ))}
          </div>
          <div className="mt-[4px] flex flex-col gap-[2px] border-t border-line2 pt-[6px]">
            <button
              type="button"
              role="menuitem"
              data-episode-rename
              onClick={() => {
                setView('rename')
              }}
              className="folio-menu-item"
            >
              <span className="w-[26px] flex-none" aria-hidden="true" />
              Rename {defaultEpisodeTitle(current.ordinal)}…
            </button>
            <button
              type="button"
              role="menuitem"
              data-new-episode
              onClick={() => {
                setView('create')
              }}
              className="folio-menu-item"
            >
              <span className="w-[26px] flex-none text-center text-15 leading-none">+</span>
              New episode…
            </button>
            {episodes.length > 1 ? (
              <button
                type="button"
                role="menuitem"
                data-episode-delete
                onClick={() => {
                  setView('delete')
                }}
                className="folio-menu-item !text-live"
              >
                <span className="w-[26px] flex-none" aria-hidden="true" />
                Delete {defaultEpisodeTitle(current.ordinal)}…
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {open && (view === 'create' || view === 'rename') ? (
        <div role="dialog" aria-label={view === 'create' ? 'New episode' : 'Rename episode'} className="folio-menu absolute left-0 top-[36px] w-[300px]">
          <EpisodeForm
            key={view}
            projectId={projectId}
            mode={
              view === 'create'
                ? { kind: 'create', nextOrdinal }
                : { kind: 'rename', slug: current.slug, ordinal: current.ordinal, title: current.title }
            }
            onDone={close}
            onCancel={() => {
              setView('list')
            }}
          />
        </div>
      ) : null}
      {open && view === 'delete' ? (
        <div role="alertdialog" aria-label="Delete episode" className="folio-menu absolute left-0 top-[36px] w-[320px]">
          <EpisodeDeleteConfirm
            projectId={projectId}
            slug={current.slug}
            ordinal={current.ordinal}
            title={current.title}
            onDone={close}
            onCancel={() => {
              setView('list')
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
