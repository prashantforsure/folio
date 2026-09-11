'use client'

import type { Project } from '@folio/contracts'
import type { ScriptFormat } from '@folio/script'
import Link from 'next/link'
import { useState, useTransition } from 'react'

import { replyThread, resolveThread, setFormat, setPagination } from '../../../../../../../lib/script/actions'
import type { RevisionRow, ThreadCard } from '../../../../../../../lib/script/panel'
import type { ScriptStats } from '../../../../../../../lib/script/stats'
import {
  PAGINATION_CONTROLS,
  PAGINATION_CONTROL_COPY,
  controlFromPagination,
} from '../../../../../../../lib/state/project-preferences'
import type { PaginationControl } from '../../../../../../../lib/state/project-preferences'
import type { SubViewHref } from '../script-workspace'

/**
 * The right panel. 296px, `--panel`, 1px left border. Transcribed from
 * `Route - Script.dc.html`: a 46px header (Newsreader 15px "Writing", `⤒`
 * import/export, `▤` report), the Info / Collaboration segment, the tab
 * body, and the footer button `◎ Open composer ⌘J`.
 *
 * ## Info
 *
 * Pagination is the bundle's three-way control drawn over the model's pair -
 * `controlFromPagination` / `setPagination` are the boundary, in
 * `lib/state/project-preferences.ts`. Format writes `projects.format`, an
 * engine input. **Project type is shown, not switchable**: film <-> series
 * changes the URL shape of every route and is not a panel toggle; flagged.
 * The statistics are real (`lib/script/stats.ts`), and the bundle's line
 * under them is kept verbatim.
 *
 * ## Collaboration
 *
 * Open comments with `Reply` / `Resolve`, and the revision list. No
 * Collaborators section - ruled 2026-09-11, no presence.
 *
 * ## The footer
 *
 * The composer is a floating window (AGENTS.md; ruled again 2026-09-11) and
 * is not built this phase. The button is drawn as the bundle draws it and is
 * disabled, with its title saying so, rather than omitted: it is the
 * window's entry point and the bundle specifies it here.
 */

export type RightPanelProps = {
  readonly projectId: string
  readonly episode: string
  readonly project: Project
  readonly tab: 'info' | 'collab'
  readonly infoHref: SubViewHref
  readonly collabHref: SubViewHref
  readonly stats: ScriptStats
  readonly threads: readonly ThreadCard[]
  readonly revisions: readonly RevisionRow[]
  readonly onImport: () => void
}

const FORMATS: readonly { readonly id: ScriptFormat; readonly label: string; readonly page: string }[] = [
  { id: 'hollywood', label: 'Hollywood', page: 'US Letter · Courier 12pt' },
  { id: 'asian', label: 'Asian', page: 'A4 · Courier 12pt' },
]

const PROJECT_TYPE_NOTE: Readonly<Record<Project['projectType'], string>> = {
  series: 'Episodes are first-class: this route is scoped to one episode. Entities stay project-wide.',
  film: 'One document. The episode board is hidden and routes collapse to /project/{uuid}/script.',
}

export const RightPanel = ({
  projectId,
  episode,
  project,
  tab,
  infoHref,
  collabHref,
  stats,
  threads,
  revisions,
  onImport,
}: RightPanelProps) => {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)

  const control = controlFromPagination(project)
  const choosePagination = (next: PaginationControl): void => {
    startTransition(async () => {
      const result = await setPagination(projectId, episode, next)
      setNotice(result.status === 'done' ? null : result.message)
    })
  }
  const chooseFormat = (next: ScriptFormat): void => {
    startTransition(async () => {
      const result = await setFormat(projectId, episode, next)
      setNotice(result.status === 'done' ? null : result.message)
    })
  }

  return (
    <aside
      data-right-panel
      data-panel-tab={tab}
      className="flex min-h-0 w-[296px] flex-none flex-col border-l border-line bg-panel"
    >
      <div className="flex h-[46px] flex-none items-center gap-[8px] border-b border-line2 px-[12px]">
        <span className="flex-1 font-serif text-15 font-medium tracking-title">Writing</span>
        <button
          type="button"
          title="Import / export"
          onClick={onImport}
          className="folio-focus grid h-[24px] w-[24px] place-items-center rounded-chrome font-glyph text-12 text-ink3 hover:bg-hover"
        >
          ⤒
        </button>
        <button
          type="button"
          title="Report — not built this phase"
          disabled
          className="grid h-[24px] w-[24px] cursor-default place-items-center rounded-chrome font-glyph text-12 text-ink3 opacity-60"
        >
          ▤
        </button>
      </div>

      <div className="flex-none px-[12px] pt-[10px]">
        <div className="folio-segment" role="tablist" aria-label="Panel">
          <Link href={infoHref} role="tab" aria-current={tab === 'info' ? 'true' : undefined} className="folio-focus">
            Info
          </Link>
          <Link href={collabHref} role="tab" aria-current={tab === 'collab' ? 'true' : undefined} className="folio-focus">
            Collaboration
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[12px] pb-[24px] pt-[14px]">
        {notice === null ? null : (
          <p className="m-0 rounded-chrome border border-del bg-del-bg px-[8px] py-[5px] text-10-5 text-del">{notice}</p>
        )}

        {tab === 'info' ? (
          <>
            <section className="flex flex-col gap-[8px]">
              <span className="folio-panel-label">Pagination</span>
              <div className="folio-segment" role="radiogroup" aria-label="Pagination">
                {PAGINATION_CONTROLS.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={control === entry}
                    aria-pressed={control === entry}
                    disabled={pending}
                    title={PAGINATION_CONTROL_COPY[entry].note}
                    className="!px-[6px] !text-11"
                    onClick={() => {
                      choosePagination(entry)
                    }}
                  >
                    {PAGINATION_CONTROL_COPY[entry].label}
                  </button>
                ))}
              </div>
              <span className="text-10 leading-[1.45] text-ink3">{PAGINATION_CONTROL_COPY[control].note}</span>
            </section>

            <section className="flex flex-col gap-[8px]">
              <span className="folio-panel-label">Format</span>
              <div className="folio-segment" role="radiogroup" aria-label="Format">
                {FORMATS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={project.format === entry.id}
                    aria-pressed={project.format === entry.id}
                    disabled={pending}
                    onClick={() => {
                      chooseFormat(entry.id)
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-[5px] text-11-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink2">Page</span>
                  <span>{FORMATS.find((entry) => entry.id === project.format)?.page}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-ink2">Dialogue</span>
                  <span className="text-ink3">—</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-ink2">Subtitle</span>
                  <span className="text-ink3">—</span>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-[8px]">
              <span className="folio-panel-label">Project type</span>
              <div className="folio-segment" role="radiogroup" aria-label="Project type">
                {(['film', 'series'] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={project.projectType === entry}
                    aria-pressed={project.projectType === entry}
                    disabled
                    title="Set at creation. Changing it reshapes every URL in the project."
                  >
                    {entry === 'film' ? 'Film' : 'Series'}
                  </button>
                ))}
              </div>
              <span className="text-10 leading-[1.45] text-ink3">{PROJECT_TYPE_NOTE[project.projectType]}</span>
            </section>

            <section className="flex flex-col gap-[4px]">
              <span className="folio-panel-label mb-[2px]">Statistics</span>
              {(
                [
                  ['Scenes', stats.scenes],
                  ['Words', stats.words],
                  ['Characters', stats.characters],
                  ['Locations', stats.locations],
                  ['Beats', stats.beats],
                  ['Shots', stats.shots],
                  ['Relations', stats.relations],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between border-b border-line2 py-[5px]">
                  <span className="text-11-5 text-ink2">{label}</span>
                  <span className="text-11-5 font-medium tabular-nums" data-stat={label.toLowerCase()}>
                    {value.toLocaleString('en-US')}
                  </span>
                </div>
              ))}
              <span className="mt-[4px] text-10 leading-[1.45] text-ink3">
                Counted from the document, not estimated. Comments are excluded.
              </span>
            </section>
          </>
        ) : (
          <>
            <section className="flex flex-col gap-[8px]">
              <span className="folio-panel-label">Open comments</span>
              {threads.length === 0 ? (
                <p className="m-0 text-10-5 leading-[1.5] text-ink3">
                  No open comments on this script. Comments anchor to a node and follow it through every edit.
                </p>
              ) : null}
              {threads.map((thread) => (
                <ThreadCardView key={thread.id} thread={thread} projectId={projectId} episode={episode} />
              ))}
            </section>

            <section className="flex flex-col gap-[8px]">
              <span className="folio-panel-label">Revision</span>
              {revisions.length === 0 ? (
                <p className="m-0 text-10-5 leading-[1.5] text-ink3">
                  No revision has been cut. The draft is on white paper until one is.
                </p>
              ) : (
                <div className="flex flex-col gap-[9px] border-l border-line pl-[9px]">
                  {revisions.map((revision) => (
                    <div key={revision.id} className="flex flex-col">
                      <span className="text-11">{revision.name}</span>
                      <span className="text-10 text-ink3">{revision.meta}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="flex-none border-t border-line2 px-[12px] pb-[12px] pt-[10px]">
        <button
          type="button"
          disabled
          title="The composer is a floating window, reachable everywhere with ⌘J. Not built this phase."
          className="flex w-full cursor-default items-center justify-center gap-[8px] rounded-chrome bg-ink px-[12px] py-[9px] text-12 font-medium text-desk opacity-60"
        >
          <span className="font-glyph text-11 opacity-70">◎</span>Open composer
          <span className="text-10-5 opacity-60">⌘J</span>
        </button>
      </div>
    </aside>
  )
}

const ThreadCardView = ({
  thread,
  projectId,
  episode,
}: {
  readonly thread: ThreadCard
  readonly projectId: string
  readonly episode: string
}) => {
  const [pending, startTransition] = useTransition()
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-[4px] rounded-chrome border border-line2 px-[10px] py-[9px]">
      <div className="flex items-center gap-[7px]">
        <span className="text-11 font-medium">{thread.who}</span>
        <span className="text-10 text-ink3">{thread.when}</span>
        <span className="ml-auto font-mono text-9-5 text-ink3">{thread.at}</span>
      </div>
      <p className="m-0 text-11-5 leading-[1.45] text-ink2">{thread.body}</p>
      {replying ? (
        <textarea
          value={body}
          rows={2}
          placeholder="Reply"
          onChange={(event) => {
            setBody(event.target.value)
          }}
          className="folio-focus mt-[4px] resize-none rounded-chrome border border-line bg-sheet px-[8px] py-[5px] font-sans text-11-5 text-ink"
        />
      ) : null}
      {error === null ? null : <span className="text-10 text-del">{error}</span>}
      <div className="mt-[2px] flex gap-[6px]">
        <button
          type="button"
          disabled={pending}
          className="folio-small-button"
          onClick={() => {
            if (!replying) {
              setReplying(true)
              return
            }
            startTransition(async () => {
              const result = await replyThread(projectId, episode, thread.id, body)
              if (result.status === 'done') {
                setBody('')
                setReplying(false)
                setError(null)
              } else setError(result.message)
            })
          }}
        >
          {replying ? 'Send' : 'Reply'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="folio-small-button"
          onClick={() => {
            startTransition(async () => {
              const result = await resolveThread(projectId, episode, thread.id)
              if (result.status !== 'done') setError(result.message)
            })
          }}
        >
          Resolve
        </button>
      </div>
    </div>
  )
}
