'use client'

import { useState, useTransition } from 'react'

import { replyThread, resolveThread } from '../../../../../../../lib/script/actions'
import type { ThreadView } from '../../../../../../../lib/script/panel'

/**
 * A comment thread, drawn in the document under the block it anchors to -
 * `docs/ui design/Route - Script v2.dc.html`: a `--s1` card with a name
 * chip, `Rukmini · 14:02 · not exported`, and the comment. Every turn is
 * drawn; a reply is a smaller row under the first.
 *
 * Reply and Resolve live on the card. Each returns the whole thread and
 * the workspace replaces it in its list; nothing re-renders the route.
 * "not exported" is a constant - AGENTS.md, Export - drawn on every card so
 * a reviewer's note is never mistaken for a line of the script.
 *
 * The card lives inside the editor's DOM (a widget host the decorations
 * plugin creates) and the widget's `stopEvent` keeps ProseMirror out of
 * the textarea; nothing here needs to stop propagation itself.
 */
export const ThreadCardView = ({
  thread,
  projectId,
  episode,
  onChange,
  onResolved,
}: {
  readonly thread: ThreadView
  readonly projectId: string
  readonly episode: string
  readonly onChange: (thread: ThreadView) => void
  readonly onResolved: (threadId: string) => void
}) => {
  const [pending, startTransition] = useTransition()
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const send = (): void => {
    startTransition(async () => {
      const result = await replyThread(projectId, episode, thread.id, thread.nodeId, body)
      if (result.status === 'ok') {
        setBody('')
        setReplying(false)
        setError(null)
        onChange(result.thread)
      } else setError(result.message)
    })
  }

  return (
    <div data-thread-card={thread.id} data-thread-state={thread.state} className="folio-thread-card">
      {thread.turns.map((turn, index) => (
        <div key={turn.id} className={`flex gap-[12px] ${index === 0 ? '' : 'mt-[10px] border-t border-line2 pt-[10px]'}`}>
          <span className="folio-thread-chip">{turn.initials}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex items-center gap-[8px] text-12 text-ink3">
              {turn.who}
              <span className="folio-dot" />
              {turn.when}
              {index === 0 ? (
                <>
                  <span className="folio-dot" />
                  not exported
                </>
              ) : null}
            </span>
            <p className="m-0 whitespace-pre-wrap text-14 leading-[1.55] text-ink2">{turn.body}</p>
          </div>
        </div>
      ))}

      {replying ? (
        <div className="mt-[10px] flex flex-col gap-[8px]">
          <textarea
            value={body}
            rows={2}
            autoFocus
            placeholder="Reply"
            aria-label="Reply"
            onChange={(event) => {
              setBody(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                send()
              }
              if (event.key === 'Escape') setReplying(false)
            }}
            className="folio-field resize-none font-sans text-13"
          />
          <div className="flex items-center gap-[6px]">
            <button type="button" disabled={pending || body.trim().length === 0} onClick={send} className="folio-solid-button h-[28px] rounded-[8px] px-[10px] text-12 font-medium">
              {pending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setReplying(false)
                setBody('')
              }}
              className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ink2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-[8px] flex items-center gap-[4px]">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setReplying(true)
            }}
            className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ink2"
          >
            Reply
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await resolveThread(projectId, episode, thread.id)
                if (result.status === 'done') onResolved(thread.id)
                else setError(result.message)
              })
            }}
            className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ok"
          >
            Resolve
          </button>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="m-0 mt-[6px] text-12 text-live">
          {error}
        </p>
      )}
    </div>
  )
}
