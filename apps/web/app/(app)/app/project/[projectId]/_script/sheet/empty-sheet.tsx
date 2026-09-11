'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { createBlankScript } from '../../../../../../../lib/script/actions'
import { ImportForm } from './import-form'

/**
 * The empty state: a sheet with the hints on it and a ghost slugline with a
 * live caret, as `Route - Script.dc.html` draws it, plus the two ways out.
 *
 * `empty` is a data state - no screenplay document exists for the episode -
 * decided on the server, never by a URL. The primary action is **import**,
 * through the FDX importer (`fast-xml-parser` -> `importFinalDraft`) or the
 * Fountain parser; the secondary is a blank script, which creates the
 * document with one empty heading so the writer lands on the slugline the
 * ghost promised. Both are server actions that return a discriminated result
 * and refresh the route on success.
 *
 * The hint copy is the bundle's, verbatim.
 */

const HINTS: readonly { readonly key: string; readonly text: string }[] = [
  { key: 'Enter', text: 'Create characters and locations from the element selectors' },
  { key: '@', text: 'Mention a character to keep the script readable and linked' },
  { key: 'Tab', text: 'Cycle the element type without leaving the keyboard' },
]

export const EmptySheet = ({
  projectId,
  episode,
}: {
  readonly projectId: string
  readonly episode: string
}) => {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [blankError, setBlankError] = useState<string | null>(null)

  return (
    <div className="folio-desk" data-empty-state style={{ height: 1056 }}>
      <div className="folio-page" style={{ top: 0, pointerEvents: 'auto' }}>
        <div className="flex flex-col gap-[20px] pl-[144px] pr-[96px] pt-[96px]">
          <div className="flex flex-col gap-[12px] font-sans">
            {HINTS.map((hint) => (
              <div key={hint.key} className="flex items-baseline gap-[14px]">
                <span className="min-w-[52px] flex-none rounded-chrome border border-sheet-line px-[7px] py-[2px] text-center font-mono text-11 text-ink2">
                  {hint.key}
                </span>
                <span className="text-14 leading-[1.5] text-ink3">{hint.text}</span>
              </div>
            ))}
          </div>
          <div className="folio-ghost font-mono text-[16px] leading-[16px]">
            INT/EXT. LOCATION - DAY/NIGHT<span className="animate-pulse text-accent">|</span>
          </div>

          <div className="mt-[24px] flex flex-col gap-[10px] font-sans">
            <ImportForm projectId={projectId} episode={episode}>
              {({ importing, open }) => (
                <div className="flex flex-wrap items-center gap-[8px]">
                  <button
                    type="button"
                    disabled={importing || pending}
                    onClick={open}
                    className="folio-focus flex items-center gap-[8px] rounded-chrome bg-ink px-[12px] py-[7px] text-12 font-medium text-desk disabled:opacity-60"
                  >
                    <span className="font-glyph text-11 opacity-70">⤒</span>
                    {importing ? 'Importing…' : 'Import .fdx or .fountain'}
                  </button>
                  <button
                    type="button"
                    disabled={importing || pending}
                    onClick={() => {
                      startTransition(async () => {
                        const result = await createBlankScript(projectId, episode)
                        if (result.status === 'done') router.refresh()
                        else setBlankError(result.message)
                      })
                    }}
                    className="folio-small-button !py-[6px] !text-11-5"
                  >
                    {pending ? 'Starting…' : 'Start a blank script'}
                  </button>
                </div>
              )}
            </ImportForm>
            {blankError === null ? null : (
              <p className="m-0 text-11 text-del" role="alert">
                {blankError}
              </p>
            )}
            <p className="m-0 text-10-5 leading-[1.5] text-ink3">
              Final Draft (MORE) and (CONT&rsquo;D) are stripped on import; authored (V.O.) and (O.S.) are kept.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
