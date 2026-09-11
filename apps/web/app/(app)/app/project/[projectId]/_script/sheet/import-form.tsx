'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { importScript } from '../../../../../../../lib/script/actions'
import { IMPORT_IDLE } from '../../../../../../../lib/script/result'

/** The one file input on the route. The panel's `⤒` button clicks it by id. */
export const IMPORT_INPUT_ID = 'folio-script-import'

/**
 * The import form: a hidden file input that submits itself on change, the
 * server action's result, and a refresh on success. Rendered by the empty
 * state with its visible buttons, and by the draft state without them so the
 * right panel's `⤒ Import / export` reaches the same action. Importing over
 * an existing script snapshots it `before_import` and replaces it whole -
 * the action's business, said here so the button's title can say it too.
 */
export const ImportForm = ({
  projectId,
  episode,
  children,
}: {
  readonly projectId: string
  readonly episode: string
  /** Rendered inside the form, with `{ importing, message }` available through `ImportForm.Status`. */
  readonly children?: (state: { readonly importing: boolean; readonly open: () => void }) => ReactNode
}) => {
  const router = useRouter()
  const [result, action, importing] = useActionState(importScript, IMPORT_IDLE)
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (result.status === 'imported') router.refresh()
  }, [result.status, router])

  const message = result.status === 'error' || result.status === 'refused' ? result.message : null

  return (
    <form ref={form} action={action} className="contents" data-import-form>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="episode" value={episode} />
      <input
        ref={input}
        id={IMPORT_INPUT_ID}
        type="file"
        name="file"
        accept=".fdx,.fountain,.txt"
        className="sr-only"
        tabIndex={-1}
        onChange={() => {
          form.current?.requestSubmit()
        }}
      />
      {children?.({
        importing,
        open: () => {
          input.current?.click()
        },
      })}
      {message === null ? null : (
        <p className="m-0 text-11 text-del" role="alert">
          {message}
        </p>
      )}
    </form>
  )
}
