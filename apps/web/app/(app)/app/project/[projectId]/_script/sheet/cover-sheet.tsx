'use client'

import type { TitlePage, TitlePageField, TitlePageInput } from '@folio/contracts'
import { TITLE_PAGE_FIELDS } from '@folio/contracts'
import { useEffect, useRef, useState, useTransition } from 'react'

import { saveTitlePage } from '../../../../../../../lib/script/actions'

/**
 * The title page, under `?doc=cover`.
 *
 * AGENTS.md, Export: "a separate document on the same sheet geometry,
 * exported with the script." So it is the same 816 x 1056 sheet, the same
 * Courier at 16px/16px, and the same tokens - and its fields are Fountain's
 * title-page keys laid out the way a title page is: title, credit and author
 * centred in the upper third; source, draft date, contact, copyright and
 * notes at the foot, left. Every field is editable in place and saved whole
 * through `saveTitlePage`, debounced, with the outcome shown in the corner.
 *
 * An empty cover is a valid cover. A field with nothing in it shows its key
 * in `--ink3` as a placeholder and exports as nothing.
 */

const CENTRED: readonly TitlePageField[] = ['title', 'credit', 'author']
const FOOT: readonly TitlePageField[] = ['source', 'draftDate', 'contact', 'copyright', 'notes']

const PLACEHOLDER: Readonly<Record<TitlePageField, string>> = {
  title: 'TITLE',
  credit: 'Written by',
  author: 'Author',
  source: 'Source',
  draftDate: 'Draft date',
  contact: 'Contact',
  copyright: 'Copyright',
  notes: 'Notes',
}

const fromRecord = (titlePage: TitlePage | null): Record<TitlePageField, string> =>
  Object.fromEntries(
    TITLE_PAGE_FIELDS.map((field) => [field, titlePage?.[field] ?? '']),
  ) as Record<TitlePageField, string>

export const CoverSheet = ({
  projectId,
  episode,
  titlePage,
  episodeTitle,
}: {
  readonly projectId: string
  readonly episode: string
  readonly titlePage: TitlePage | null
  readonly episodeTitle: string
}) => {
  const [fields, setFields] = useState(() => fromRecord(titlePage))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const dirty = useRef(false)
  const timer = useRef<number | null>(null)

  const persist = (next: Record<TitlePageField, string>): void => {
    setStatus('saving')
    startTransition(async () => {
      const input: TitlePageInput = next
      const result = await saveTitlePage(projectId, episode, input)
      if (result.status === 'saved') {
        setStatus('saved')
        setMessage(null)
      } else {
        setStatus('error')
        setMessage(result.message)
      }
    })
  }

  const edit = (field: TitlePageField, value: string): void => {
    const next = { ...fields, [field]: value }
    setFields(next)
    dirty.current = true
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      dirty.current = false
      persist(next)
    }, 800)
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const input = (field: TitlePageField, className: string) => (
    <textarea
      key={field}
      aria-label={PLACEHOLDER[field]}
      data-cover-field={field}
      value={fields[field]}
      placeholder={field === 'title' ? episodeTitle.toUpperCase() : PLACEHOLDER[field]}
      rows={field === 'notes' ? 3 : 1}
      spellCheck={false}
      onChange={(event) => {
        edit(field, event.target.value.replace(/\r/gu, ''))
      }}
      className={`folio-focus block w-full resize-none border-0 bg-transparent p-0 font-mono text-[16px] leading-[16px] text-sheet-ink placeholder:text-ink3 ${className}`}
    />
  )

  return (
    <div className="folio-desk" data-cover style={{ height: 1056 }}>
      <div className="folio-page" style={{ top: 0, pointerEvents: 'auto' }}>
        <div className="absolute inset-x-[144px] top-[336px] flex flex-col gap-[32px] text-center">
          {CENTRED.map((field) =>
            input(field, field === 'title' ? 'text-center uppercase' : 'text-center'),
          )}
        </div>
        <div className="absolute bottom-[96px] left-[144px] right-[336px] flex flex-col gap-[16px]">
          {FOOT.map((field) => input(field, ''))}
        </div>
        <span className="absolute bottom-[48px] right-[96px] font-sans text-9-5 text-ink3" data-cover-status={status}>
          {status === 'saving'
            ? 'saving…'
            : status === 'saved'
              ? 'saved'
              : status === 'error'
                ? (message ?? 'not saved')
                : titlePage === null
                  ? 'New cover'
                  : ''}
        </span>
      </div>
    </div>
  )
}
