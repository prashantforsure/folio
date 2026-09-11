'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { createBlankOutline } from '../../../../../../lib/outline/actions'

/**
 * The Outline's empty state: the prose sheet with its title block, the
 * caret line's promise, the bundle's three hints, and the one way in.
 *
 * `empty` is a data state - no outline document exists for the episode -
 * decided on the server, never by a URL. There is no import: nothing in
 * Fountain or FDX is an outline. "Start the outline" creates the document
 * with one empty body block so the writer lands on the caret line the ghost
 * promised; the nav's Outline row moves from `—` to `0 acts` on the refresh.
 */
export const EmptyOutline = ({
  projectId,
  episode,
  title,
}: {
  readonly projectId: string
  readonly episode: string
  readonly title: string
}) => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="folio-prose-sheet" data-empty-state>
      <div className="relative flex flex-col gap-[6px] px-[96px]">
        <span className="folio-prose-dot" style={{ left: 74, top: 9 }} />
        <span className="font-serif text-34 leading-[1.1] tracking-[-.015em]">{title}</span>
        <span className="text-14 text-ink3">no outline yet</span>
      </div>
      <div className="h-[34px]" />
      <div className="relative px-[96px] pt-[12px]">
        <span className="folio-prose-dot" data-caret="true" style={{ left: 74, top: 21 }} />
        <span className="text-16 leading-[1.95] text-ink3">
          Type, or press <b className="text-ink2">/</b> for a block<span className="text-accent">|</span>
        </span>
      </div>
      <div className="mt-[28px] flex flex-col gap-[10px] px-[96px] font-sans">
        <div className="flex flex-wrap items-center gap-[8px]">
          <button
            type="button"
            disabled={pending}
            data-start-outline
            onClick={() => {
              startTransition(async () => {
                const result = await createBlankOutline(projectId, episode)
                if (result.status === 'done') router.refresh()
                else setError(result.message)
              })
            }}
            className="folio-focus flex items-center gap-[8px] rounded-chrome bg-ink px-[12px] py-[7px] text-12 font-medium text-desk disabled:opacity-60"
          >
            <span className="font-glyph text-11 opacity-70">✎</span>
            {pending ? 'Starting…' : 'Start the outline'}
          </button>
        </div>
        {error === null ? null : (
          <p className="m-0 text-11 text-del" role="alert">
            {error}
          </p>
        )}
        <p className="m-0 text-10-5 leading-[1.5] text-ink3">
          The prose plan for the episode — logline, synopsis, story beats. Its own document, on the same sheet; the
          script is never rewritten from this page.
        </p>
      </div>
    </div>
  )
}
