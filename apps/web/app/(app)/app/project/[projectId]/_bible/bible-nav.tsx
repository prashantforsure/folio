'use client'

import type { BibleCounts, BibleNavEntry, ProjectId } from '@folio/contracts'
import type { BibleSection } from '@folio/script'
import { BIBLE_ENTRY_STATUS_LABEL, BIBLE_SECTIONS, BIBLE_SECTION_LABEL } from '@folio/script'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { createEntry, createPitchEntry } from '../../../../../../lib/bible/actions'
import { bibleEntryHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'

/**
 * The bible column: the entry list beside the Bible route.
 *
 * `Route - Bible.dc.html`, the `<aside>`: a find input on `--sheet` with a
 * `⌕`, then the four sections - `PREMISE 2`, `HOW THINGS WORK 2`,
 * `HISTORY 2`, `THEMES 2` - each row the title (12px), an amber dot when
 * the draft contradicts it, and the status in 9.5px (`Canon` in `--add`,
 * `Draft` in `--ink3`, `Retired` in `--del`; the Pitch's row reads
 * `Pitch` in `--accent` where the bundle wrote `Export` - export is a job
 * that does not exist, and a row must not name one). Then `REFERENCE` with
 * the one `Glossary` row and its term count. The footer - `Canon facts` ·
 * `Contradicted in script` · `Readable by Insights` - is `BibleNavFooter`,
 * drawn by the column outside the list.
 *
 * Which row is selected is the URL: `/bible/:entryId` names one, `/bible`
 * alone names the first in nav order, `?view=glossary` names the Glossary
 * row. The find filter is component state - a filter is not a sub-view.
 *
 * A section with no entry is still drawn, at `0`: the sections are the
 * brief's, not the writer's, and an empty one is where the next entry goes.
 */
export const BibleNav = ({
  projectId,
  entries,
  terms,
}: {
  readonly projectId: ProjectId
  readonly entries: readonly BibleNavEntry[]
  readonly terms: number
}) => {
  const params = useParams<{ entryId?: string }>()
  const search = useSearchParams()
  const view = search.get('view') ?? 'entry'
  const [query, setQuery] = useState('')

  const first = entries[0]?.id ?? null
  const selected = view === 'entry' ? (params.entryId ?? first) : (params.entryId ?? null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return entries
    return entries.filter((row) => row.title.toLowerCase().includes(needle))
  }, [entries, query])

  const glossaryHref = `${projectRouteHref(projectId, 'bible')}?view=glossary` as const
  const glossaryActive = view === 'glossary'

  return (
    <>
      <div className="pb-[10px] pl-[4px] pr-[4px]">
        <label className="flex items-center gap-[7px] rounded-chrome border border-line2 bg-sheet pb-[5px] pl-[9px] pr-[9px] pt-[5px]">
          <span aria-hidden="true" className="text-11 text-ink3" style={{ fontFamily: 'var(--font-glyph)' }}>
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Search the bible"
            aria-label="Search the bible"
            className="min-w-0 flex-1 border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
          />
        </label>
      </div>

      {BIBLE_SECTIONS.map((section) => {
        const rows = shown.filter((row) => row.section === section)
        if (rows.length === 0 && query !== '') return null
        return (
          <div key={section} className="flex flex-col gap-[1px]" data-bible-section={section}>
            <div className="flex items-center pb-[3px] pl-[8px] pr-[8px]">
              <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">
                {BIBLE_SECTION_LABEL[section]}
              </span>
              <span className="tabular text-9-5 text-ink3">{rows.length}</span>
            </div>
            {rows.map((row) => {
              const active = row.id === selected && view === 'entry'
              const pitch = row.kind === 'pitch'
              return (
                <Link
                  key={row.id}
                  href={bibleEntryHref(projectId, row.id)}
                  aria-current={active ? 'page' : undefined}
                  data-bible-row={row.id}
                  data-bible-row-status={row.status}
                  className={`flex items-center gap-[8px] rounded-chrome border px-[8px] py-[6px] no-underline hover:bg-hover hover:no-underline ${
                    active ? 'border-accent-line bg-accent-bg text-ink' : 'border-transparent text-ink2'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-12">{row.title}</span>
                  {row.contradicted ? (
                    <span
                      title="Contradicted in the script"
                      data-contradicted
                      className="h-[6px] w-[6px] flex-none rounded-full bg-note"
                    />
                  ) : null}
                  <span
                    className={`flex-none text-9-5 ${
                      pitch
                        ? 'text-accent'
                        : row.status === 'canon'
                          ? 'text-add'
                          : row.status === 'retired'
                            ? 'text-del'
                            : 'text-ink3'
                    }`}
                  >
                    {pitch ? 'Pitch' : BIBLE_ENTRY_STATUS_LABEL[row.status]}
                  </span>
                </Link>
              )
            })}
          </div>
        )
      })}

      {query === '' ? (
        <div className="flex flex-col gap-[1px]" data-bible-section="reference">
          <div className="flex items-center pb-[3px] pl-[8px] pr-[8px]">
            <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">Reference</span>
            <span className="tabular text-9-5 text-ink3">1</span>
          </div>
          <Link
            href={glossaryHref}
            aria-current={glossaryActive ? 'page' : undefined}
            data-bible-glossary-row
            className={`flex items-center gap-[8px] rounded-chrome border px-[8px] py-[6px] no-underline hover:bg-hover hover:no-underline ${
              glossaryActive ? 'border-accent-line bg-accent-bg text-ink' : 'border-transparent text-ink2'
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-12">Glossary</span>
            <span className="flex-none text-9-5 text-ink3">
              {terms} {terms === 1 ? 'term' : 'terms'}
            </span>
          </Link>
        </div>
      ) : null}
    </>
  )
}

/**
 * The strip under the list: `Canon facts N` · `Contradicted in script N`
 * · `Readable by Insights`. The third is the status gate's consequence,
 * not a switch: `on` while there is a canon entry for a lens to read,
 * `—` while there is none - things that either exist or don't show `—`.
 */
export const BibleNavFooter = ({ counts }: { readonly counts: BibleCounts }) => (
  <div className="flex flex-col gap-[5px] border-t border-line2 px-[10px] pb-[10px] pt-[10px] text-10-5 text-ink2">
    <div className="flex justify-between">
      <span>Canon facts</span>
      <span className="tabular font-medium text-ink" data-nav-canon-facts>
        {counts.canonFacts}
      </span>
    </div>
    <div className="flex justify-between">
      <span>Contradicted in script</span>
      <span className="tabular font-medium text-note" data-nav-conflicts>
        {counts.conflicts}
      </span>
    </div>
    <div className="flex justify-between">
      <span>Readable by Insights</span>
      <span className="font-medium text-ink" data-nav-readable>
        {counts.canonFacts > 0 ? 'on' : '—'}
      </span>
    </div>
  </div>
)

/**
 * The header's `＋` and the page header's `＋ Entry`: a title and a section,
 * and the entry opens as a draft. When the project has no Pitch the section
 * list offers it too, so the one-per-project entry is never out of reach.
 */
export const NewEntryButton = ({
  projectId,
  hasPitch,
  variant = 'icon',
}: {
  readonly projectId: ProjectId
  readonly hasPitch: boolean
  readonly variant?: 'icon' | 'accent'
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [section, setSection] = useState<BibleSection | 'pitch'>('premise')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (busy) return
    if (section !== 'pitch' && title.trim() === '') return
    setBusy(true)
    setError(null)
    const result =
      section === 'pitch' ? await createPitchEntry(projectId) : await createEntry(projectId, { title, section })
    setBusy(false)
    if (result.status !== 'created') {
      setError(result.message)
      return
    }
    setOpen(false)
    setTitle('')
    router.push(bibleEntryHref(projectId, result.id))
  }

  return (
    <span className="relative flex-none">
      {variant === 'icon' ? (
        <button
          type="button"
          title="New entry"
          aria-label="New entry"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="grid h-[22px] w-[22px] place-items-center rounded-chrome border-none bg-transparent text-14 text-ink3 hover:bg-hover"
          style={{ fontFamily: 'var(--font-glyph)' }}
        >
          ＋
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          data-new-entry
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border-none bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink hover:opacity-90"
        >
          <span aria-hidden="true" className="text-11 opacity-75" style={{ fontFamily: 'var(--font-glyph)' }}>
            ＋
          </span>
          Entry
        </button>
      )}
      {open ? (
        <form
          data-new-entry-form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="absolute right-0 top-[26px] z-10 flex w-[240px] flex-col gap-[6px] rounded-chrome border border-line bg-panel p-[8px] shadow-[0_6px_18px_var(--scrim)]"
        >
          <select
            value={section}
            onChange={(event) => {
              const next = event.target.value
              setSection(next === 'pitch' ? 'pitch' : (next as BibleSection))
            }}
            aria-label="Section"
            className="w-full rounded-chrome border border-line2 bg-sheet px-[6px] py-[5px] text-11-5 text-ink outline-none"
          >
            {BIBLE_SECTIONS.map((value) => (
              <option key={value} value={value}>
                {BIBLE_SECTION_LABEL[value]}
              </option>
            ))}
            {hasPitch ? null : <option value="pitch">Pitch · one page</option>}
          </select>
          {section === 'pitch' ? (
            <span className="text-10-5 text-ink3">Logline, genre, format, audience, comparables, positioning, status.</span>
          ) : (
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
              }}
              placeholder="Entry title"
              aria-label="Entry title"
              className="w-full rounded-chrome border border-line2 bg-sheet px-[8px] py-[5px] text-11-5 text-ink outline-none placeholder:text-ink3"
            />
          )}
          {error === null ? null : <span className="text-10-5 text-del">{error}</span>}
          <span className="flex gap-[6px]">
            <button
              type="submit"
              disabled={busy || (section !== 'pitch' && title.trim() === '')}
              className="flex-1 rounded-chrome border-none bg-accent px-[9px] py-[4px] text-11 font-semibold text-accent-ink disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              className="rounded-chrome border border-line2 bg-transparent px-[9px] py-[4px] text-11 text-ink2 hover:bg-hover"
            >
              Cancel
            </button>
          </span>
        </form>
      ) : null}
    </span>
  )
}
