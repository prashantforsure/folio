'use client'

import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { listRecentProjects, startStoryProject } from '../../../../lib/projects/actions'
import type { RecentProject } from '../../../../lib/projects/actions'
import { asRoute } from '../../../../lib/routes'
import { useSession } from '../../../../lib/state/session'
import { projectHref } from '../../../../lib/workspace/hrefs'
import { Orb } from '../../app/project/[projectId]/_chrome/orb'

/**
 * The assistant outside a project - ADR 0003 **D15**: "Outside a project the
 * panel can list and open projects and start 'new project from a story' ...
 * No chat is stored outside a project."
 *
 * Roadmap task 2.2 drew the first half: the person's recent projects, each a
 * link to its front door (`projectHref`, which lands on the right episode's
 * script). Roadmap task 3.6 draws the second: **Start from a story** - a title,
 * film or series, and the story; a confirmation step that names what will be
 * made; then `startStoryProject` (`createProject`'s logic, returning rather
 * than redirecting), and the story becomes the first message of a chat inside
 * the new project (`assistantPending`, sent once by the panel there). Nothing
 * is created before the writer confirms - `start_story_project` is a confirm
 * tool, and this step is its confirmation.
 *
 * ## No composer, by ruling
 *
 * Ruled 2026-09-23 with Phase 2: the launcher runs **no model turn** yet. A
 * turn is recorded on `agent_runs`, which carries `project_id` like every
 * tenant row, and both the D3 token meter and the D14 rate limit are per
 * project - so a turn here would be unrecorded and unlimited. The list below
 * is the same read `list_projects` wraps; a click is `open_project`. The
 * story form is not a composer: it runs no turn here, and the story is only
 * sent once it has a project to belong to.
 */

type Story = {
  readonly title: string
  readonly projectType: 'film' | 'series'
  readonly story: string
  readonly confirming: boolean
}

const EMPTY_STORY: Story = { title: '', projectType: 'film', story: '', confirming: false }
export const AssistantLauncher = ({
  inFlow,
  onClose,
}: {
  readonly inFlow: boolean
  readonly onClose: () => void
}) => {
  const [projects, setProjects] = useState<readonly RecentProject[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [story, setStory] = useState<Story | null>(null)
  const [busy, setBusy] = useState(false)
  const [storyNotice, setStoryNotice] = useState<string | null>(null)
  const router = useRouter()
  const setPending = useSession((state) => state.setAssistantPending)

  const create = async (draft: Story): Promise<void> => {
    setBusy(true)
    setStoryNotice(null)
    try {
      const result = await startStoryProject({ title: draft.title, projectType: draft.projectType, format: 'hollywood', story: draft.story })
      if (result.status !== 'created') {
        setStoryNotice(result.message)
        setStory({ ...draft, confirming: false })
        return
      }
      // The launcher's conversation continues inside the project it made (D15).
      setPending({ projectId: result.projectId, message: draft.story })
      setStory(null)
      router.push(asRoute(result.href))
    } finally {
      setBusy(false)
    }
  }

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

        {story === null ? null : story.confirming ? (
          <div data-launcher-story-confirm className="flex flex-col gap-[8px] rounded-[12px] border border-line bg-s1 px-[12px] py-[10px] text-12-5 leading-[1.5]">
            <span className="text-ink">
              Create “{story.title.trim()}”, a {story.projectType}, and continue there with your story?
            </span>
            <span className="text-12 text-ink3">The story becomes the first message in its assistant. Nothing is written into the script until you apply a proposal.</span>
            <span className="flex gap-[6px]">
              <button
                type="button"
                data-launcher-story-create
                disabled={busy}
                onClick={() => {
                  void create(story)
                }}
                className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12"
              >
                Create project
              </button>
              <button type="button" disabled={busy} onClick={() => setStory({ ...story, confirming: false })} className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2">
                Back
              </button>
            </span>
          </div>
        ) : (
          <form
            data-launcher-story-form
            className="flex flex-col gap-[8px]"
            onSubmit={(event) => {
              event.preventDefault()
              if (story.title.trim().length > 0 && story.story.trim().length > 0) setStory({ ...story, confirming: true })
            }}
          >
            <label className="flex flex-col gap-[4px] text-12 text-ink3">
              Title
              <input value={story.title} onChange={(event) => setStory({ ...story, title: event.target.value })} maxLength={200} className="folio-field h-[32px] rounded-[10px] border-line bg-s1 text-13" />
            </label>
            <span role="radiogroup" aria-label="Kind" className="flex gap-[6px]">
              {(['film', 'series'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={story.projectType === kind}
                  onClick={() => setStory({ ...story, projectType: kind })}
                  className={`folio-chip-button ${story.projectType === kind ? 'border-accent text-accent' : ''}`}
                >
                  {kind === 'film' ? 'Film' : 'Series'}
                </button>
              ))}
            </span>
            <label className="flex flex-col gap-[4px] text-12 text-ink3">
              The story
              <textarea value={story.story} rows={6} onChange={(event) => setStory({ ...story, story: event.target.value })} className="folio-field resize-y rounded-[10px] border-line bg-s1 py-[6px] text-13 leading-[1.5]" />
            </label>
            <span className="flex gap-[6px]">
              <button type="submit" disabled={story.title.trim().length === 0 || story.story.trim().length === 0} className="folio-solid-button rounded-[8px] px-[10px] py-[4px] text-12">
                Continue
              </button>
              <button type="button" onClick={() => setStory(null)} className="folio-ghost-button rounded-[8px] px-[10px] py-[4px] text-12 text-ink2">
                Cancel
              </button>
            </span>
          </form>
        )}
        {storyNotice === null ? null : (
          <p role="status" className="m-0 text-12 text-live">
            {storyNotice}
          </p>
        )}

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
          data-launcher-story
          disabled={story !== null}
          onClick={() => {
            setStoryNotice(null)
            setStory(EMPTY_STORY)
          }}
          className="folio-chip-button justify-center"
        >
          <span className="h-[7px] w-[7px] flex-none rounded-[2px] bg-accent" />
          Start from a story
        </button>
        <p className="m-0 text-12 leading-[1.5] text-ink3">Open a project to ask about it.</p>
      </div>
    </aside>
  )
}
