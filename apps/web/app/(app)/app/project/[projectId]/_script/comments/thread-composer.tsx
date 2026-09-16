'use client'

import { useState, useTransition } from 'react'

import { openThreadOnNode } from '../../../../../../../lib/script/actions'
import type { ThreadNodeKind, ThreadView } from '../../../../../../../lib/script/panel'

/**
 * A new thread, being written. Opened from the block's `+` handle
 * (`Comment`), drawn where the card will be - under the block - so the
 * writer sees exactly what they are annotating. `⌘Enter` sends, Escape
 * cancels; the first turn becomes the card the moment the action returns.
 *
 * `kind` is the anchor the thread is opened with: `script_node` on the
 * Script, `outline_block` on the Outline. Both editors draw this same
 * composer.
 */
export const ThreadComposer = ({
  nodeId,
  kind,
  projectId,
  episode,
  onOpened,
  onCancel,
}: {
  readonly nodeId: string
  readonly kind: ThreadNodeKind
  readonly projectId: string
  readonly episode: string
  readonly onOpened: (thread: ThreadView) => void
  readonly onCancel: () => void
}) => {
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const send = (): void => {
    if (body.trim().length === 0) return
    startTransition(async () => {
      const result = await openThreadOnNode(projectId, episode, nodeId, body, kind)
      if (result.status === 'ok') onOpened(result.thread)
      else setError(result.message)
    })
  }

  return (
    <div data-thread-composer={nodeId} className="folio-thread-card">
      <textarea
        value={body}
        rows={2}
        autoFocus
        placeholder="Comment on this block"
        aria-label="New comment"
        onChange={(event) => {
          setBody(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            send()
          }
          if (event.key === 'Escape') onCancel()
        }}
        className="folio-field resize-none font-sans text-13"
      />
      <div className="mt-[8px] flex items-center gap-[6px]">
        <button type="button" disabled={pending || body.trim().length === 0} onClick={send} className="folio-solid-button h-[28px] rounded-[8px] px-[10px] text-12 font-medium">
          {pending ? 'Posting…' : 'Comment'}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className="folio-ghost-button rounded-[8px] px-[8px] py-[4px] text-12 text-ink2">
          Cancel
        </button>
        <span className="ml-auto text-11 text-ink3">not exported</span>
      </div>
      {error === null ? null : (
        <p role="alert" className="m-0 mt-[6px] text-12 text-live">
          {error}
        </p>
      )}
    </div>
  )
}
