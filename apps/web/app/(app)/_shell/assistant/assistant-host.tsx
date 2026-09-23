'use client'

import { useEffect, useState } from 'react'

import type { AssistantProject } from '../../../../lib/assistant/project-cell'
import { useAssistantProject } from '../../../../lib/assistant/project-cell'
import { useSession } from '../../../../lib/state/session'
import { useViewport } from '../../../../lib/state/viewport'
import { PANEL_IN_FLOW_MIN } from '../../../../lib/workspace/routes'
import { AssistantPanel } from './assistant-panel'
import { AssistantLauncher } from './launcher'

/**
 * The assistant, app-wide (roadmap task 2.2, ADR 0003 **D15**).
 *
 * Mounted once by `app/(app)/layout.tsx`, above the account shell and the
 * project shell alike, so it is never re-mounted by a navigation - a layout is
 * not re-rendered from scratch when a route below it changes. Until 2026-09-23
 * the panel was mounted by `project-shell.tsx` and only while open, so closing
 * it or leaving the project threw the conversation away.
 *
 * ## What it draws
 *
 * Inside a project - the project shell publishes one into
 * `lib/assistant/project-cell.ts` - the chat panel for that project's episode.
 * Outside one, the launcher. Once opened the chat panel stays mounted and is
 * **hidden with CSS** when closed, and while the launcher shows: a running
 * answer finishes, and the turns are still there on the way back. It follows
 * the last project it was given, so leaving for `/app/projects` and returning
 * is a hide and a show, not a reload.
 *
 * ## What moved here from the project shell, and what did not
 *
 * The `⌘J` / `Ctrl+J` toggle (it must work on the account routes too) and the
 * in-flow rule: at `PANEL_IN_FLOW_MIN` (1200px, `lib/workspace/routes.ts`) and
 * above the panel is a flex sibling of the page, below it an overlay. The
 * width is `PANEL_WIDTH`, drawn by `.folio-assistant-panel`. **The nav-collapse
 * rule stays in `project-shell.tsx`**, which still reads `assistantOpen` from
 * the session store: forcing the sidebar closed is the workspace's geometry,
 * and the account shell has no sidebar to force.
 */
export const AssistantHost = ({ connected }: { readonly connected: boolean }) => {
  const session = useSession()
  const { mounted, width } = useViewport()
  const project = useAssistantProject()
  const open = (mounted ? session.assistantOpen : null) ?? false
  const inFlow = width >= PANEL_IN_FLOW_MIN

  // The last project the panel was given, kept while the launcher shows so
  // the chat panel is hidden rather than unmounted on the way out.
  const [last, setLast] = useState<AssistantProject | null>(null)
  useEffect(() => {
    if (project !== null) setLast(project)
  }, [project])

  // Mounted from the first open onward, never before: a panel nobody opened
  // should not be reading chats on every project visited.
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (open) setOpened(true)
  }, [open])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        session.setAssistantOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, session])

  const close = (): void => {
    session.setAssistantOpen(false)
  }
  const chat = project ?? last

  return (
    <>
      {chat === null || !(open || opened) ? null : (
        <AssistantPanel
          key="assistant-panel"
          projectId={chat.projectId}
          episode={chat.episode}
          episodeCount={chat.episodeCount}
          reading={chat.reading}
          section={chat.section}
          route={project === null ? null : chat.route}
          connected={connected}
          inFlow={inFlow}
          hidden={!open || project === null}
          onClose={close}
        />
      )}
      {open && project === null ? <AssistantLauncher inFlow={inFlow} onClose={close} /> : null}
    </>
  )
}
