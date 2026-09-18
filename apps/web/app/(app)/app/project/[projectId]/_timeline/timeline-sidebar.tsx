'use client'

import type { ProjectId, StoryThreadEdit, StoryThreadId, StoryThreadRow } from '@folio/contracts'
import { EpisodeBars } from '@folio/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'

import { createThread, deleteThread, orderThreads, saveThread } from '../../../../../../lib/timeline/actions'
import { setNewThreadOpen, useNewThreadOpen } from '../../../../../../lib/timeline/compose'
import type { TimelineCounts } from '../../../../../../lib/timeline/view'
import { placedNote, placedPercent, threadColourVar, threadSpanLine } from '../../../../../../lib/timeline/view'
import { FindField } from '../_chrome/find-field'
import { ProgressWidget, RecordGroup, RecordTitleRow, SidebarNote } from '../_chrome/record-sidebar'
import { ThreadEditor } from './thread-editor'
import { useTimelineState } from './view-state'

const THREAD_DRAG_TYPE = 'application/x-folio-thread'

/**
 * The Timeline sidebar's four slots, on the record routes' shared pieces
 * (`_chrome/record-sidebar.tsx`): the project's name with `+` (`New
 * thread`), the recessed `Find a scene or character` field, the Threads
 * group, and the `Placed in time` widget.
 *
 * ## The group is the threads, and a row is a solo
 *
 * One row per thread in its `position` order: the 3×22 colour bar, the
 * name over its span line (`E1 → E3 · 6 scenes · +2 shared` -
 * `lib/timeline/view.ts`), the episode bars (`@folio/ui`, one bar per
 * episode - "does the B-plot disappear in E3" at a glance) and the row
 * count in mono. A click lights the row and dims every other thread's
 * lane in the grid; a second click clears it. "Dim the other threads" - a
 * way of looking, not a hide: the first pass's eye toggle dimmed rows to
 * 35% and left their cards in the tab order, which was neither a filter
 * nor a view. `⋯` on the row opens the inline editor (`thread-editor.tsx`)
 * - rename, recolour, delete. Rows drag: dropping one on another writes
 * the whole order (`orderThreads`), the threads phase's reorder.
 *
 * ## The find field filters the grid
 *
 * The field narrows the cards below by ref, heading, set or a cast name
 * (`matchesFind`); the workspace reads the same `useFind`. The list of
 * threads is not narrowed - it is four rows, and a filter over four rows
 * hides the solo control.
 *
 * ## One save pipeline
 *
 * Every write here goes through the provider's `run`
 * (`view-state.tsx`), so a rename says `Saving…` in the body's status bar
 * like every other write on the route; the editor keeps its own inline
 * failure so the writer sees it beside the field.
 */

export const TimelineTitleRow = ({ title }: { readonly title: string }) => (
  <RecordTitleRow
    title={title}
    action="New thread"
    attr="data-sidebar-new-thread"
    onAction={() => {
      setNewThreadOpen(true)
    }}
  />
)

export const TimelineFind = () => <FindField placeholder="Find a scene or character" testId="timeline-find" />

export const ThreadGroup = ({
  projectId,
  threads,
  presence,
}: {
  readonly projectId: ProjectId
  readonly threads: readonly StoryThreadRow[]
  /** Thread id → its scene count per episode, in episode order. */
  readonly presence: Readonly<Record<string, readonly number[]>>
}) => {
  const router = useRouter()
  const { solo, toggleSolo, run } = useTimelineState()
  const adding = useNewThreadOpen()
  const [editing, setEditing] = useState<StoryThreadId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<StoryThreadId | null>(null)
  const [over, setOver] = useState<StoryThreadId | null>(null)

  // The editor for a thread that is gone closes with it.
  useEffect(() => {
    if (editing !== null && !threads.some((thread) => thread.id === editing)) setEditing(null)
  }, [editing, threads])

  const attempt = (job: () => Promise<string | null>): void => {
    setBusy(true)
    setError(null)
    run(async () => {
      let failure: string | null
      try {
        failure = await job()
      } finally {
        setBusy(false)
      }
      if (failure !== null) {
        setError(failure)
        return failure
      }
      setNewThreadOpen(false)
      setEditing(null)
      router.refresh()
      return null
    })
  }

  const create = (edit: StoryThreadEdit): void => {
    attempt(async () => {
      const result = await createThread(projectId, edit)
      return result.status === 'created' ? null : result.message
    })
  }
  const save = (id: StoryThreadId, edit: StoryThreadEdit): void => {
    attempt(async () => {
      const result = await saveThread(projectId, id, edit)
      return result.status === 'saved' ? null : result.message
    })
  }
  const remove = (id: StoryThreadId): void => {
    attempt(async () => {
      const result = await deleteThread(projectId, id)
      return result.status === 'deleted' ? null : result.message
    })
  }
  const reorder = (moved: StoryThreadId, before: StoryThreadId): void => {
    if (moved === before) return
    const rest = threads.map((thread) => thread.id).filter((id) => id !== moved)
    const at = rest.indexOf(before)
    const ids = [...rest.slice(0, at), moved, ...rest.slice(at)]
    run(async () => {
      const result = await orderThreads(projectId, ids)
      if (result.status !== 'saved') return result.message
      router.refresh()
      return null
    })
  }

  const onDragStart = (id: StoryThreadId) => (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(THREAD_DRAG_TYPE, id)
    event.dataTransfer.effectAllowed = 'move'
    setDragging(id)
  }
  const onDragOver = (id: StoryThreadId) => (event: DragEvent<HTMLLIElement>) => {
    if (!event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (over !== id) setOver(id)
  }
  const onDrop = (id: StoryThreadId) => (event: DragEvent<HTMLLIElement>) => {
    const moved = event.dataTransfer.getData(THREAD_DRAG_TYPE)
    setOver(null)
    setDragging(null)
    if (moved === '') return
    event.preventDefault()
    reorder(moved as StoryThreadId, id)
  }

  return (
    <RecordGroup
      label="Threads"
      total={threads.length}
      attr={{ 'data-thread-group': '' }}
      countAttr="data-thread-count"
      empty={
        threads.length === 0 && !adding ? (
          <SidebarNote attr="data-threads-empty">
            No threads yet. A thread is a storyline you name and link scenes to; nothing derives one.{' '}
            <button
              type="button"
              data-threads-empty-new
              onClick={() => {
                setNewThreadOpen(true)
              }}
              className="border-none bg-transparent p-0 text-12 text-accent hover:underline"
            >
              New thread
            </button>
          </SidebarNote>
        ) : undefined
      }
    >
      {adding ? (
        <li>
          <ThreadEditor
            initial={{ name: '', colour: 'terracotta' }}
            submitLabel="Create"
            onSubmit={create}
            onCancel={() => {
              setNewThreadOpen(false)
              setError(null)
            }}
            error={error}
            busy={busy}
          />
        </li>
      ) : null}
      {threads.map((thread) => {
        if (editing === thread.id) {
          return (
            <li key={thread.id}>
              <ThreadEditor
                initial={{ name: thread.name, colour: thread.colour }}
                submitLabel="Save"
                onSubmit={(edit) => {
                  save(thread.id, edit)
                }}
                onCancel={() => {
                  setEditing(null)
                  setError(null)
                }}
                onDelete={() => {
                  remove(thread.id)
                }}
                error={error}
                busy={busy}
              />
            </li>
          )
        }
        const lit = solo === thread.id
        const dimmed = solo !== null && !lit
        const counts = presence[thread.id] ?? []
        return (
          <li
            key={thread.id}
            className="group/thread relative"
            draggable={threads.length > 1}
            data-thread-drop={over === thread.id ? 'over' : undefined}
            data-thread-dragging={dragging === thread.id ? 'true' : undefined}
            onDragStart={onDragStart(thread.id)}
            onDragOver={onDragOver(thread.id)}
            onDragLeave={() => {
              if (over === thread.id) setOver(null)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
            onDrop={onDrop(thread.id)}
          >
            <button
              type="button"
              data-thread-row={thread.id}
              data-solo={lit ? 'true' : 'false'}
              aria-pressed={lit}
              title={lit ? 'Show every thread' : 'Dim the other threads'}
              onClick={() => {
                toggleSolo(thread.id)
              }}
              className="folio-record-row pr-[30px]"
              style={dimmed ? { opacity: 0.5 } : undefined}
            >
              <span aria-hidden="true" className="h-[22px] w-[3px] flex-none rounded-[2px]" style={{ background: threadColourVar(thread.colour) }} />
              <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-13">{thread.name}</span>
                <span className="truncate text-10-5 text-ink3" data-thread-span>
                  {threadSpanLine(thread)}
                </span>
                {counts.length > 1 ? <EpisodeBars counts={counts} className="mt-[1px]" /> : null}
              </span>
              <span className="tabular flex-none font-mono text-11 text-ink3" data-thread-lanes>
                {thread.lanes}
              </span>
            </button>
            <button
              type="button"
              title="Rename, recolour or delete"
              aria-label={`Edit ${thread.name}`}
              data-thread-edit={thread.id}
              onClick={() => {
                setNewThreadOpen(false)
                setError(null)
                setEditing(thread.id)
              }}
              className="folio-ghost-button absolute right-[6px] top-1/2 grid h-[22px] w-[22px] -translate-y-1/2 place-items-center rounded-[6px] text-13 leading-none text-ink3 opacity-0 focus-visible:opacity-100 group-hover/thread:opacity-100"
            >
              ⋯
            </button>
          </li>
        )
      })}
    </RecordGroup>
  )
}

/** The foot widget: `Placed in time · 17 / 24`, the accent bar, and how many have no time yet. */
export const PlacedWidget = ({ counts }: { readonly counts: TimelineCounts }) => (
  <ProgressWidget label="Placed in time" done={counts.placed} total={counts.scenes} percent={placedPercent(counts)} note={placedNote(counts)} attr="placed" />
)
