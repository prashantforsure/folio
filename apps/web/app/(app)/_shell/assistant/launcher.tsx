'use client'

import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { listRecentProjects } from '../../../../lib/projects/actions'
import type { RecentProject } from '../../../../lib/projects/actions'
import { projectHref } from '../../../../lib/workspace/hrefs'
import { Orb } from '../../app/project/[projectId]/_chrome/orb'

/**
 * The assistant outside a project - ADR 0003 **D15**: "Outside a project the
 * panel can list and open projects and start 'new project from a story' ...
 * No chat is stored outside a project."
 *
 * Roadmap task 2.2 draws the first half: the person's recent projects, each a
 * link to its front door (`projectHref`, which lands on the right episode's
 * script), and `Start from a story` drawn disabled with its reason, because
 * creating a project from the panel is a confirm-mode write (roadmap Phase 3).
 *
 * ## No composer, by ruling
 *
 * Ruled 2026-09-23 with Phase 2: the launcher runs **no model turn** yet. A
 * turn is recorded on `agent_runs`, which carries `project_id` like every
 * tenant row, and both the D3 token meter and the D14 rate limit are per
 * project - so a turn here would be unrecorded and unlimited. The list below
 * is the same read `list_projects` wraps; a click is `open_project`. The
 * composer arrives when that recording question is ruled.
 */
export const AssistantLauncher = ({
  inFlow,
  onClose,
}: {
  readonly inFlow: boolean
  readonly onClose: () => void
}) => {
  const [projects, setProjects] = useState<readonly RecentProject[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listRecentProjects().then((result) => {
      if (cancelled) return
      if (result.status === 'ok') setProjects(result.projects)
      else setNotice(result.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside
      data-assistant-panel
      data-assistant-launcher
      data-in-flow={inFlow ? 'true' : 'false'}
      aria-label="Assistant"
      className={`folio-assistant-panel ${inFlow ? 'relative' : 'absolute inset-y-0 right-0'} z-[3] flex flex-none flex-col`}
    >
      <div className="flex h-[60px] flex-none items-center gap-[8px] pl-[16px] pr-[12px]">
        <Orb size={20} />
        <span className="text-13-5 font-medium text-ink">Assistant</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close the assistant"
          className="folio-ghost-button grid h-[28px] w-[28px] place-items-center rounded-[8px] text-ink3"
        >
          <Icon name="close" size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[20px] py-[20px]">
        <div className="flex flex-col items-center gap-[14px] pt-[12px] text-center">
          <Orb size={96} drift />
          <span className="text-17 font-medium tracking-title">How can I help?</span>
          <span className="text-13-5 leading-[1.55] text-ink2">Open a project and I can read it with you - the script, the cast, the places and the timeline.</span>
        </div>

        <div className="flex flex-col gap-[6px]">
          <span className="text-11 uppercase tracking-[0.08em] text-ink3">Recent projects</span>
          {notice !== null ? (
            <p role="status" className="m-0 text-12 text-live">
              {notice}
            </p>
          ) : projects === null ? (
            <span className="folio-thinking text-12 text-ink3">Reading your projects</span>
          ) : projects.length === 0 ? (
            <p data-launcher-empty className="m-0 text-12-5 leading-[1.5] text-ink3">
              No projects yet.{' '}
              <Link href="/app/new" className="text-accent">
                Start one
              </Link>{' '}
              and I can read it with you.
            </p>
          ) : (
            <ul data-launcher-projects className="m-0 flex list-none flex-col gap-[2px] p-0">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={projectHref(project.id)}
                    data-launcher-project={project.id}
                    className="flex flex-col gap-[2px] rounded-[10px] px-[10px] py-[8px] no-underline hover:bg-s1 hover:no-underline"
                  >
                    <span className="truncate text-13-5 text-ink">{project.title}</span>
                    <span className="truncate text-11-5 text-ink3">
                      {project.kind} · {project.stats}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-none flex-col gap-[8px] px-[16px] pb-[16px]">
        <button
          type="button"
          disabled
          data-launcher-story
          title="Starting a project from a story is not built yet - it arrives with the assistant's writes"
          className="folio-chip-button justify-center opacity-60"
        >
          <span className="h-[7px] w-[7px] flex-none rounded-[2px] bg-accent" />
          Start from a story
        </button>
        <p className="m-0 text-12 leading-[1.5] text-ink3">Open a project to ask about it.</p>
      </div>
    </aside>
  )
}
