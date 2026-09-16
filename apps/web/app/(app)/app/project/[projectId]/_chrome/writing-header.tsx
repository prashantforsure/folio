'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { useSession } from '../../../../../../lib/state/session'
import type { ShareLinkView } from '../../../../../../lib/share/result'
import { defaultEpisodeTitle, episodeNumber } from '../../../../../../lib/workspace/format'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { episodeRouteHref } from '../../../../../../lib/workspace/hrefs'
import type { WritingRoute } from '../../../../../../lib/workspace/routes'
import { WRITING_MODE_TARGET, isWritingRoute, writingModeOf } from '../../../../../../lib/workspace/routes'
import { EpisodeDeleteConfirm } from './episode-delete-confirm'
import { EpisodeForm } from './episode-form'
import { Orb } from './orb'
import { SharePopover } from './share-popover'

/**
 * The writing header. 60px - `docs/ui design/README.md`, "Header":
 * "Breadcrumb on the left, `Share` and the assistant orb on the right. The
 * Write / Storyboard mode pill lives here **only in the writing routes**."
 *
 * Left: `Project / Episode ▾`. The episode is a menu of the project's
 * episodes, each a link to the same route on that episode, with `Rename
 * episode…`, `New episode…` and - while there is more than one - `Delete
 * episode…` at the foot, each opening its form or confirm in the same box;
 * a film has one episode and no menu. The breadcrumb's
 * container is *not* `overflow:hidden` as the mockup's is: the menu is
 * positioned inside it, and the mockup's hidden overflow clipped the whole
 * menu to nothing (found 2026-09-16 - "there is no option to switch"). The
 * project title truncates on its own instead. Centre: the
 * pill - Write lit on Script, Outline and Scenes; Storyboard on Storyboard;
 * each half links to its home. Right: Share (a popover over share links)
 * and the orb, which opens the assistant and hides while it is open
 * (README: "The header orb hides while the panel is open").
 *
 * Presence avatars and the Read button are not drawn - ruled 2026-09-16:
 * no presence (no realtime), Read left out.
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
}: {
  readonly projectId: ProjectId
  readonly projectTitle: string
  readonly shape: WorkspaceShape
  readonly episodes: readonly EpisodeChoice[]
  readonly current: EpisodeChoice
  readonly share: ShareLinkView
}) => {
  // The route below the `(writing)` layout: `script`, `outline`, `storyboard`
  // or `scenes`. A layout cannot pass it; the segment hook can see it.
  const segment = useSelectedLayoutSegment()
  const route: WritingRoute = segment !== null && isWritingRoute(segment) ? segment : 'script'
  const session = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const assistantOpen = (mounted ? session.assistantOpen : null) ?? false
  const mode = writingModeOf(route)
  const address = { projectId, shape, episode: current.slug }

  return (
    <header data-writing-header className="relative flex h-[60px] flex-none items-center gap-[10px] pl-[4px] pr-[14px]">
      <div className="flex min-w-0 flex-1 items-center gap-[8px] text-13">
        <span className="min-w-0 truncate whitespace-nowrap text-ink3">{projectTitle}</span>
        {shape === 'episodic' ? (
          <>
            <span className="text-ink3">/</span>
            <EpisodeMenu projectId={projectId} shape={shape} episodes={episodes} current={current} route={route} />
          </>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-[10px]">
        <div role="tablist" aria-label="Mode" data-mode-pill className="flex items-center gap-[3px] rounded-pill border border-line2 bg-s1 p-[4px]">
          <Link
            href={episodeRouteHref(address, WRITING_MODE_TARGET.write)}
            role="tab"
            aria-selected={mode === 'write'}
            aria-current={mode === 'write' ? 'page' : undefined}
            data-mode="write"
            className="folio-pill-tab"
          >
            <Icon name="write" size={15} className="opacity-75" />
            Write
          </Link>
          <Link
            href={episodeRouteHref(address, WRITING_MODE_TARGET.storyboard)}
            role="tab"
            aria-selected={mode === 'storyboard'}
            aria-current={mode === 'storyboard' ? 'page' : undefined}
            data-mode="storyboard"
            className="folio-pill-tab"
          >
            <Icon name="storyboard" size={15} className="opacity-75" />
            Storyboard
          </Link>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-[8px]">
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
  readonly route: WritingRoute
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
    <div ref={root} className="relative min-w-0 flex-none">
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
