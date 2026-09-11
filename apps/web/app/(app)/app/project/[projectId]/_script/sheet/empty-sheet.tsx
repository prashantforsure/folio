'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'

import { createBlankScript, importScript } from '../../../../../../../lib/script/actions'
import { IMPORT_IDLE } from '../../../../../../../lib/script/result'

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
  autoOpenImport,
}: {
  readonly projectId: string
  readonly episode: string
  readonly autoOpenImport: boolean
}) => {
  const router = useRouter()
  const [imported, importAction, importing] = useActionState(importScript, IMPORT_IDLE)
  const [pending, startTransition] = useTransition()
  const [blankError, setBlankError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (imported.status === 'imported') router.refresh()
  }, [imported.status, router])

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

          <form
            ref={form}
            action={importAction}
            className="mt-[24px] flex flex-col gap-[10px] font-sans"
            data-import-form
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="episode" value={episode} />
            <input
              ref={fileInput}
              type="file"
              name="file"
              accept=".fdx,.fountain,.txt"
              className="sr-only"
              onChange={() => {
                form.current?.requestSubmit()
              }}
            />
            <div className="flex flex-wrap items-center gap-[8px]">
              <button
                type="button"
                disabled={importing || pending}
                autoFocus={autoOpenImport}
                onClick={() => {
                  fileInput.current?.click()
                }}
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
            {imported.status === 'error' || imported.status === 'refused' ? (
              <p className="m-0 text-11 text-del" role="alert">
                {imported.message}
              </p>
            ) : null}
            {blankError === null ? null : (
              <p className="m-0 text-11 text-del" role="alert">
                {blankError}
              </p>
            )}
            <p className="m-0 text-10-5 leading-[1.5] text-ink3">
              Final Draft (MORE) and (CONT&rsquo;D) are stripped on import; authored (V.O.) and (O.S.) are kept.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
