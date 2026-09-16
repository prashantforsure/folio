'use client'

import type { EpisodeSlug, ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { deleteEpisode } from '../../../../../../lib/workspace/actions'
import { episodeLabel } from '../../../../../../lib/workspace/format'

/**
 * `Delete Episode N…` - the confirm the header's episode menu opens in its
 * own box. A hard delete, ruled 2026-09-16 (AGENTS.md, When to ask first:
 * deleting user data was asked, and answered "hard delete, confirmed").
 *
 * The text names what goes - the script, its comments, shots, reels and
 * assistant chats - and that it cannot be undone, before the button. The
 * menu never offers this for the last episode (the item is not drawn); the
 * action refuses it anyway, and a refusal draws here.
 *
 * On `done` the router goes to the neighbour the action chose, since the
 * URL we are on no longer names anything.
 */
export const EpisodeDeleteConfirm = ({
  projectId,
  slug,
  ordinal,
  title,
  onDone,
  onCancel,
}: {
  readonly projectId: ProjectId
  readonly slug: EpisodeSlug
  readonly ordinal: number
  readonly title: string
  readonly onDone: () => void
  readonly onCancel: () => void
}) => {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancel.current?.focus()
  }, [])

  const confirm = (): void => {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const result = await deleteEpisode(projectId, slug)
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      onDone()
      router.push(result.href)
      router.refresh()
    })
  }

  return (
    <div data-episode-delete-confirm className="flex flex-col gap-[10px] p-[6px]">
      <span className="text-13-5 font-medium">Delete {episodeLabel(ordinal, title)}?</span>
      <p className="m-0 text-12 leading-[1.55] text-ink2">
        Its script goes with it - every scene, comment, shot, reel and assistant chat. This cannot be undone.
      </p>
      {error === null ? null : (
        <p role="alert" className="m-0 text-12 text-live">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-[6px]">
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="folio-ghost-button rounded-[8px] px-[10px] py-[6px] text-12-5 text-ink2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          data-episode-delete-confirm-button
          className="folio-pill-button h-[32px] rounded-[9px] px-[12px] text-12-5 font-medium !text-live"
        >
          {pending ? 'Deleting…' : 'Delete episode'}
        </button>
      </div>
    </div>
  )
}
