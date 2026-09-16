'use client'

import type { EpisodeSlug, ProjectId, RailBadges } from '@folio/contracts'
import { parseEpisodeSegment } from '@folio/contracts'
import { useSelectedLayoutSegments } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCallback, useEffect } from 'react'

import type { ShellUser } from '../../../../../../lib/auth/session'
import { useEphemeral } from '../../../../../../lib/state/ephemeral'
import { useSession } from '../../../../../../lib/state/session'
import { useViewport } from '../../../../../../lib/state/viewport'
import type { WorkspaceShape } from '../../../../../../lib/workspace/hrefs'
import { PANEL_IN_FLOW_MIN, SIDEBAR_OPEN_MIN } from '../../../../../../lib/workspace/routes'
import {
  episodeSegmentFromSegments,
  railSectionFromSegments,
  workspaceRouteFromSegments,
} from '../../../../../../lib/workspace/segments'
import { AssistantPanel } from './assistant-panel'
import { CharactersOverlay } from './characters-overlay'
import { Rail } from './rail'

/**
 * The project workspace's frame: ambient glows, the rail, the route below,
 * and the two things that float over every route - the assistant panel and
 * the Characters overlay. `docs/ui design/README.md`, "Shell": "Every route
 * is the same three-part shell. Implement it once."
 *
 * ## The breakpoints live here and nowhere else
 *
 * README, "Breakpoints": panels are in flow at 1200px and above and overlay
 * the content below it; the sidebar opens by default at 1040px and above;
 * and "below 1200px an open panel also **forces the sidebar closed** ...
 * Solve it at the shell, not in the children." So:
 *
 *   navOpen    the session flag when someone has pressed the toggle, else
 *              width >= 1040 - and false regardless while the assistant is
 *              open under 1200. Written to `html[data-nav-open]`, which is
 *              what hides the server-rendered sidebar (`globals.css`).
 *   assistant  the session flag, else closed. `⌘J` toggles it anywhere.
 *   overlay    ephemeral: which peek the rail opened, if any.
 *
 * The route bodies read `useSession().navOpen` for their own geometry and no
 * longer write the attribute; five of them used to, and the last effect to
 * run won.
 *
 * ## The episode the shell links to
 *
 * The rail, the panel and the overlay all need an episode when the URL has
 * none (a record route): the one the server chose, last opened else first,
 * handed in by the layout. With one in the URL it is re-validated rather
 * than trusted - a brand is not a cast.
 */
export const ProjectShell = ({
  projectId,
  title,
  shape,
  fallbackEpisode,
  badges,
  user,
  assistantConnected,
  children,
}: {
  readonly projectId: ProjectId
  readonly title: string
  readonly shape: WorkspaceShape
  readonly fallbackEpisode: EpisodeSlug
  readonly badges: RailBadges
  readonly user: ShellUser
  readonly assistantConnected: boolean
  readonly children: ReactNode
}) => {
  const segments = useSelectedLayoutSegments()
  const active = railSectionFromSegments(segments)
  const route = workspaceRouteFromSegments(segments)
  const current = episodeSegmentFromSegments(segments)
  const checked = current === null ? null : parseEpisodeSegment(current)
  const episode = checked !== null && checked.ok ? checked.slug : fallbackEpisode

  const session = useSession()
  const { mounted, width } = useViewport()
  const { contextOverlay, setContextOverlay } = useEphemeral()

  const assistantOpen = (mounted ? session.assistantOpen : null) ?? false
  const panelInFlow = width >= PANEL_IN_FLOW_MIN
  const forcedClosed = assistantOpen && !panelInFlow
  const navOpen = !forcedClosed && ((mounted ? session.navOpen : null) ?? width >= SIDEBAR_OPEN_MIN)

  useEffect(() => {
    const root = document.documentElement
    root.dataset['navOpen'] = navOpen ? 'true' : 'false'
    return () => {
      delete root.dataset['navOpen']
    }
  }, [navOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        session.setAssistantOpen(!assistantOpen)
      }
      if (event.key === 'Escape' && contextOverlay !== null) setContextOverlay(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [assistantOpen, contextOverlay, session, setContextOverlay])

  const onToggleNav = useCallback(() => {
    session.setNavOpen(!navOpen)
  }, [navOpen, session])
  const onToggleCharacters = useCallback(() => {
    setContextOverlay(contextOverlay === 'characters' ? null : 'characters')
  }, [contextOverlay, setContextOverlay])

  return (
    <div
      data-project-shell
      data-assistant-open={assistantOpen ? 'true' : 'false'}
      className="relative flex h-full min-w-0 flex-1 overflow-hidden bg-bg text-ink"
    >
      <div aria-hidden="true" className="folio-ambient" />

      <Rail
        projectId={projectId}
        shape={shape}
        episode={episode}
        active={active}
        badges={badges}
        user={user}
        navOpen={navOpen}
        onToggleNav={onToggleNav}
        overlayOpen={contextOverlay === 'characters'}
        onToggleCharacters={active === 'writing' || active === 'production' ? onToggleCharacters : null}
      />

      <div className="relative z-[2] flex min-w-0 flex-1 overflow-hidden">{children}</div>

      {assistantOpen ? (
        <AssistantPanel
          projectId={projectId}
          episode={episode}
          section={active}
          route={route}
          connected={assistantConnected}
          inFlow={panelInFlow}
          onClose={() => {
            session.setAssistantOpen(false)
          }}
        />
      ) : null}

      {contextOverlay === 'characters' ? (
        <CharactersOverlay
          projectId={projectId}
          projectTitle={title}
          onClose={() => {
            setContextOverlay(null)
          }}
        />
      ) : null}
    </div>
  )
}
