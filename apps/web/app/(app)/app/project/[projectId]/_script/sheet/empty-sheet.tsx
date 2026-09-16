'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

import { createBlankScript } from '../../../../../../../lib/script/actions'
import { ImportForm } from './import-form'

/**
 * The empty state: a live caret and "Start typing, or type '/' to add a
 * block", two hints, and the two ways out - as `Route - Script v2.dc.html`
 * draws it (`content: empty`).
 *
 * `empty` is a data state - no screenplay document exists for the episode -
 * decided on the server, never by a URL. The prompt is the primary action:
 * a click, Enter, or any character typed while the page has focus creates
 * the document (a blank script with one empty heading, so the writer lands
 * on the slugline the caret promised) and the route refreshes into the
 * editor. Import (`.fdx` / `.fountain`) is the manual alternative under it.
 * Both are server actions that return a discriminated result.
 *
 * The hint copy is the mockup's, verbatim.
 */

const HINTS: readonly { readonly key: string; readonly text: string }[] = [
  { key: '/', text: 'Add a scene heading, dialogue, transition or note' },
  { key: '@', text: 'Mention a character or location to keep it linked' },
]

export const EmptySheet = ({ projectId, episode }: { readonly projectId: string; readonly episode: string }) => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const start = (): void => {
    if (pending) return
    startTransition(async () => {
      const result = await createBlankScript(projectId, episode)
      if (result.status === 'done') router.refresh()
      else setError(result.message)
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return
      if (event.key === 'Enter' || event.key.length === 1) start()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
    // `start` reads nothing that changes while mounted.
  }, [])

  return (
    <div data-empty-state className="flex flex-col gap-[30px] pt-[26px]">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        data-start-writing
        className="folio-ghost-button -ml-[8px] flex items-center rounded-[10px] px-[8px] py-[2px] text-left text-17 leading-[1.85] text-ink3 hover:!bg-transparent hover:!text-ink2"
      >
        <span className="folio-caret" aria-hidden="true" />
        {pending ? 'Starting…' : "Start typing, or type '/' to add a block"}
      </button>

      <div className="flex flex-col gap-[12px]">
        {HINTS.map((hint) => (
          <div key={hint.key} className="flex items-baseline gap-[14px]">
            <span className="min-w-[34px] flex-none rounded-[8px] border border-line2 bg-s1 px-[9px] py-[4px] text-center font-mono text-11-5 text-ink2">
              {hint.key}
            </span>
            <span className="text-14 leading-[1.6] text-ink3">{hint.text}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-[10px]">
        <ImportForm projectId={projectId} episode={episode}>
          {({ importing, open }) => (
            <div className="flex flex-wrap items-center gap-[8px]">
              <button
                type="button"
                disabled={importing || pending}
                onClick={open}
                className="folio-pill-button flex h-[34px] items-center gap-[8px] rounded-pill px-[14px] text-13"
              >
                {importing ? 'Importing…' : 'Import .fdx or .fountain'}
              </button>
            </div>
          )}
        </ImportForm>
        {error === null ? null : (
          <p className="m-0 text-12 text-live" role="alert">
            {error}
          </p>
        )}
        <p className="m-0 text-12 leading-[1.5] text-ink3">
          Final Draft (MORE) and (CONT&rsquo;D) are stripped on import; authored (V.O.) and (O.S.) are kept.
        </p>
      </div>
    </div>
  )
}
