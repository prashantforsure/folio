'use client'

import type { TitlePage, TitlePageField, TitlePageInput } from '@folio/contracts'
import { TITLE_PAGE_FIELDS } from '@folio/contracts'
import { memo, useEffect, useRef, useState, useTransition } from 'react'

import { saveTitlePage } from '../../../../../../../lib/script/actions'

/**
 * The title page, reached from the toolbar's document menu.
 *
 * AGENTS.md, Export: "a separate document on the same sheet geometry,
 * exported with the script." The geometry is the export's, so the fields
 * are still laid out the way a title page prints - title, credit and
 * author centred in the upper third; source, draft date, contact,
 * copyright and notes at the foot, left - and still set in Courier, the
 * measured face. What changed with the redesign is the ground: no paper,
 * the same dark canvas as the script, one hairline card at the script's
 * column width.
 *
 * Every field is editable in place and saved whole through `saveTitlePage`,
 * debounced, with the outcome shown in the corner. An empty cover is a valid
 * cover. A field with nothing in it shows its key in `--ink3` as a
 * placeholder and exports as nothing.
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
  Object.fromEntries(TITLE_PAGE_FIELDS.map((field) => [field, titlePage?.[field] ?? ''])) as Record<TitlePageField, string>

const CoverSheetBody = ({
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
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
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
      className={`folio-cover-field ${className}`}
    />
  )

  return (
    <div className="folio-cover" data-cover>
      <div className="flex flex-col gap-[32px] pt-[120px] text-center">
        {CENTRED.map((field) => input(field, field === 'title' ? 'uppercase' : ''))}
      </div>
      <div className="mt-[200px] flex flex-col gap-[14px] pr-[200px]">{FOOT.map((field) => input(field, 'text-left'))}</div>
      <span className="mt-[24px] block text-right font-sans text-11 text-ink3" data-cover-status={status}>
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
  )
}

/** Memoised: the workspace re-renders on every keystroke and this does not need to. */
export const CoverSheet = memo(CoverSheetBody)
