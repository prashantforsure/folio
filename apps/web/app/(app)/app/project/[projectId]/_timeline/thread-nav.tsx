'use client'

import type { ProjectId, StoryThreadEdit, StoryThreadId, StoryThreadRow } from '@folio/contracts'
import type { StorySpan } from '@folio/script'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { createThread, deleteThread, saveThread } from '../../../../../../lib/timeline/actions'
import { plural, threadColourVar } from './figures'
import { ThreadEditor } from './thread-editor'
import { useTimelineState } from './timeline-state'

/**
 * The thread column: the filter list beside the Timeline route.
 *
 * `Route - Timeline.dc.html`, the `<aside>`: the `THREADS` label with
 * `＋ thread` on its right, then one row per thread - an 8px colour square,
 * the name (12px), the scene count (10.5px tabular `--ink3`), and the eye
 * (`◉` shown / `○` hidden). A hidden thread's row and its grid row dim;
 * clicking a row toggles it. The bundle's drag handle `⠿` and the `Anchors ·
 * fixed dates` group are not drawn: reorder is not built, and an anchor is
 * a third authored thing the brief does not name.
 *
 * Clicking a thread's name opens it for editing - rename, recolour, delete
 * - in place; the bundle's threads are fixture and have no such form, so
 * this is the smallest one that makes a thread authored. The footer
 * (`ThreadNavFooter`) is the bundle's two rows: `Story spans` and `Scenes
 * without a time`.
 *
 * The column is drawn by the route's layout, outside the workspace's save
 * indicator, so each write here reports its own failure inline and
 * refreshes the router on success.
 */
export const ThreadNav = ({
  projectId,
  threads,
}: {
  readonly projectId: ProjectId
  readonly threads: readonly StoryThreadRow[]
}) => {
  const router = useRouter()
  const { hidden, toggleHidden } = useTimelineState()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StoryThreadId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attempt = (job: () => Promise<string | null>): void => {
    setBusy(true)
    setError(null)
    void (async () => {
      let failure: string | null
      try {
        failure = await job()
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'The save did not reach the server.'
      } finally {
        setBusy(false)
      }
      if (failure !== null) setError(failure)
      else {
        setAdding(false)
        setEditing(null)
        router.refresh()
      }
    })()
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

  return (
    <div className="flex flex-col gap-[2px]" data-thread-nav>
      <div className="flex items-center pb-[4px] pl-[8px] pr-[8px]">
        <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">Threads</span>
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            setError(null)
            setAdding(true)
          }}
          data-new-thread
          className="border-none bg-transparent p-0 text-10 text-ink3 hover:text-ink"
        >
          ＋ thread
        </button>
      </div>

      {adding ? (
        <ThreadEditor
          initial={{ name: '', colour: 'terracotta' }}
          submitLabel="Create"
          onSubmit={create}
          onCancel={() => {
            setAdding(false)
            setError(null)
          }}
          error={error}
          busy={busy}
        />
      ) : null}

      {threads.length === 0 && !adding ? (
        <span className="px-[8px] py-[6px] text-10-5 leading-[1.5] text-ink3">
          No threads yet. A thread is a storyline you name and link scenes to; nothing derives one.
        </span>
      ) : null}

      {threads.map((thread) => {
        const off = hidden.has(thread.id)
        if (editing === thread.id) {
          return (
            <ThreadEditor
              key={thread.id}
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
          )
        }
        return (
          <div
            key={thread.id}
            data-thread-row={thread.id}
            data-hidden={off ? 'true' : 'false'}
            className="flex items-center gap-[8px] rounded-chrome px-[8px] py-[7px] hover:bg-hover"
            style={{ opacity: off ? 0.45 : 1 }}
          >
            <span
              aria-hidden="true"
              className="h-[8px] w-[8px] flex-none rounded-[2px]"
              style={{ background: threadColourVar(thread.colour) }}
            />
            <button
              type="button"
              title="Rename, recolour or delete"
              onClick={() => {
                setAdding(false)
                setError(null)
                setEditing(thread.id)
              }}
              className="min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-12 text-ink"
            >
              {thread.name}
            </button>
            <span className="tabular flex-none text-10-5 text-ink3">{thread.scenes}</span>
            <button
              type="button"
              aria-pressed={!off}
              aria-label={off ? `Show ${thread.name}` : `Hide ${thread.name}`}
              title={off ? 'Show this thread' : 'Hide this thread'}
              onClick={() => {
                toggleHidden(thread.id)
              }}
              className="w-[14px] flex-none border-none bg-transparent p-0 text-center text-11 text-ink3 hover:text-ink"
              style={{ fontFamily: 'var(--font-glyph)' }}
            >
              {off ? '○' : '◉'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** The column's foot: the bundle's two rows. `—` where nothing is placed. */
export const ThreadNavFooter = ({
  span,
  flashbacks,
  unplaced,
}: {
  readonly span: StorySpan | null
  readonly flashbacks: number
  readonly unplaced: number
}) => (
  <div className="flex flex-col gap-[6px] border-t border-line2 p-[10px]">
    <div className="flex justify-between text-10-5 text-ink2">
      <span>Story spans</span>
      <span className="font-medium text-ink" data-story-span>
        {span === null ? '—' : plural(span.days, 'day')}
        {flashbacks > 0 ? ` + ${plural(flashbacks, 'flashback')}` : ''}
      </span>
    </div>
    <div className="flex justify-between text-10-5 text-ink2">
      <span>Scenes without a time</span>
      <span className={`font-medium ${unplaced > 0 ? 'text-note' : 'text-ink'}`} data-unplaced-count>
        {unplaced}
      </span>
    </div>
  </div>
)
