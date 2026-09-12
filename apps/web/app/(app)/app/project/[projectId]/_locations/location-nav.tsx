'use client'

import type { LocationRow, ProjectId } from '@folio/contracts'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { createLocation } from '../../../../../../lib/locations/actions'
import { ABSENT } from '../../../../../../lib/workspace/format'
import { locationHref, projectRouteHref } from '../../../../../../lib/workspace/hrefs'
import { DayNightBar } from './day-night-bar'

/**
 * The location column: the tree beside the Locations route.
 *
 * `Route - Locations.dc.html`, the `<aside>`: a find input on `--sheet`
 * with a `⌕`, the `LOCATIONS  N · M scenes` label, then one row per record
 * in tree order - the I/E label in a 30px column (the bundle's 26px clips
 * `INT/EXT` at 8.5px; four pixels wider, flagged), the name (12px/500 for
 * a primary set, 11.5px `--ink2` indented 14px per level for a sub-set), a
 * 26×6px day-against-night bar, and the roll-up scene count right-aligned
 * in tabular 10.5px. Then the standing `Unmatched sluglines` row with an amber
 * dot and the pending count, which opens the resolve view; on that view it
 * sits on `--note-bg` with a `--note` border. The footer legend - `Day` ·
 * `Night` · `from sluglines` - is `LocationNavFooter`, drawn by the column
 * outside the list.
 *
 * Which row is selected is the URL: `/locations/:locationId` names one,
 * `/locations` alone names the first in tree order. The find filter is
 * component state, and it matches names and the bound set texts the row
 * was given - "Find a location or slugline".
 */
export const LocationNav = ({
  projectId,
  rows,
  sceneTotal,
  pending,
  sluglinesOf,
}: {
  readonly projectId: ProjectId
  /** Tree order. */
  readonly rows: readonly LocationRow[]
  readonly sceneTotal: number
  /** Open slugline rows with a proposal - the rail badge's number. */
  readonly pending: number
  /** Every counted heading per record, for the find input. */
  readonly sluglinesOf: Readonly<Record<string, readonly string[]>>
}) => {
  const params = useParams<{ locationId?: string }>()
  const search = useSearchParams()
  const view = search.get('view') ?? 'record'
  const [query, setQuery] = useState('')

  const first = rows[0]?.id ?? null
  const selected = view === 'record' ? (params.locationId ?? first) : (params.locationId ?? null)
  const primary = rows.filter((row) => row.parentId === null).length

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return rows
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (sluglinesOf[row.id] ?? []).some((slugline) => slugline.toLowerCase().includes(needle)),
    )
  }, [rows, query, sluglinesOf])

  const resolveHref = `${projectRouteHref(projectId, 'locations')}?view=resolve` as const

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
            placeholder="Find a location or slugline"
            aria-label="Find a location or slugline"
            className="min-w-0 flex-1 border-none bg-transparent text-11-5 text-ink outline-none placeholder:text-ink3"
          />
        </label>
      </div>

      <div className="flex flex-col gap-[2px]" data-location-list>
        <div className="flex items-center pb-[4px] pl-[8px] pr-[8px]">
          <span className="flex-1 text-9-5 font-semibold uppercase tracking-label text-ink3">Locations</span>
          <span className="tabular flex-none text-9-5 text-ink3">
            {primary} · {sceneTotal} {sceneTotal === 1 ? 'scene' : 'scenes'}
          </span>
        </div>
        {shown.map((row) => {
          const active = row.id === selected && view === 'record'
          const sub = row.parentId !== null && query === ''
          return (
            <Link
              key={row.id}
              href={locationHref(projectId, row.id)}
              aria-current={active ? 'page' : undefined}
              data-location-row={row.id}
              data-location-depth={sub ? row.depth : 0}
              className={`flex items-center gap-[8px] rounded-chrome border py-[6px] pr-[8px] text-ink no-underline hover:bg-hover hover:no-underline ${
                active ? 'border-accent-line bg-accent-bg' : 'border-transparent'
              }`}
              style={{ paddingLeft: sub ? 8 + 14 * Math.min(row.depth, 3) : 8 }}
            >
              <span className="w-[30px] flex-none text-8-5 font-semibold tracking-[.06em] text-ink3">{row.ie ?? ABSENT}</span>
              <span
                className={`min-w-0 flex-1 truncate ${
                  sub ? 'text-11-5 text-ink2' : 'text-12 font-medium'
                } ${active ? 'text-ink' : ''}`}
              >
                {row.name}
              </span>
              <DayNightBar
                scenes={row.rollup.scenes}
                dayScenes={row.rollup.dayScenes}
                nightScenes={row.rollup.nightScenes}
                width={26}
                className="flex-none"
              />
              <span className="tabular w-[18px] flex-none text-right text-10-5 text-ink3">{row.rollup.scenes}</span>
            </Link>
          )
        })}
        {shown.length === 0 && query !== '' ? (
          <span className="px-[8px] py-[6px] text-10-5 text-ink3">No location matches.</span>
        ) : null}
      </div>

      {pending > 0 ? (
        <Link
          href={resolveHref}
          data-unmatched-row
          className={`mt-[4px] flex items-center gap-[8px] rounded-chrome border px-[9px] py-[7px] no-underline hover:bg-hover hover:no-underline ${
            view === 'resolve' ? 'border-note bg-note-bg' : 'border-line2'
          }`}
        >
          <span className="h-[6px] w-[6px] flex-none rounded-full bg-note" />
          <span className="flex-1 text-11-5 text-ink">Unmatched sluglines</span>
          <span className="tabular flex-none text-10-5 font-semibold text-note">{pending}</span>
        </Link>
      ) : null}
    </>
  )
}

/** The legend under the list: `Day` · `Night` · `from sluglines`. */
export const LocationNavFooter = () => (
  <div className="flex items-center gap-[8px] border-t border-line2 px-[10px] pb-[10px] pt-[8px] text-10 text-ink3">
    <span className="inline-flex items-center gap-[4px]">
      <span className="h-[8px] w-[8px] rounded-sheet bg-day" />
      Day
    </span>
    <span className="inline-flex items-center gap-[4px]">
      <span className="h-[8px] w-[8px] rounded-sheet bg-night" />
      Night
    </span>
    <span className="flex-1" />
    <span>from sluglines</span>
  </div>
)

/**
 * The header's `＋`: "New location". Opens a one-field form in place; the
 * record is created by hand, its name bound as its first set text, and the
 * record opened. The bundle's "Add by hand" - a place the script does not
 * name yet, or a primary set to hang sub-sets under.
 */
export const NewLocationButton = ({
  projectId,
  variant = 'icon',
  parentId = null,
  label = 'New location',
}: {
  readonly projectId: ProjectId
  /** The column's 22px `＋`, the header's accent `＋ New location`, or the record's dashed `＋ Sub-location`. */
  readonly variant?: 'icon' | 'accent' | 'dashed'
  /** Set on the record view's `＋ Sub-location`: the new record hangs under this one. */
  readonly parentId?: string | null
  readonly label?: string
}) => {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (name.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    const result = await createLocation(projectId, name, parentId)
    setBusy(false)
    if (result.status !== 'created') {
      setError(result.message)
      return
    }
    setOpen(false)
    setName('')
    router.push(locationHref(projectId, result.id))
  }

  return (
    <span className={`relative ${variant === 'dashed' ? 'flex' : 'flex-none'}`}>
      {variant === 'icon' ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          className="grid h-[22px] w-[22px] place-items-center rounded-chrome border-none bg-transparent text-14 text-ink3 hover:bg-hover"
          style={{ fontFamily: 'var(--font-glyph)' }}
        >
          ＋
        </button>
      ) : variant === 'accent' ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          data-new-location
          className="flex flex-none items-center gap-[6px] whitespace-nowrap rounded-chrome border-none bg-accent px-[11px] py-[5px] text-11-5 font-semibold text-accent-ink hover:opacity-90"
        >
          <span aria-hidden="true" className="text-11 opacity-75" style={{ fontFamily: 'var(--font-glyph)' }}>
            ＋
          </span>
          {label}
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value)
          }}
          data-new-sub-location
          className="flex flex-1 items-center justify-center gap-[6px] rounded-chrome border border-dashed border-line bg-transparent p-[9px] text-11-5 text-ink3 hover:bg-hover hover:text-ink"
        >
          <span aria-hidden="true" style={{ fontFamily: 'var(--font-glyph)' }}>
            ＋
          </span>
          {label}
        </button>
      )}
      {open ? (
        <form
          data-new-location-form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className={`absolute z-10 flex w-[220px] flex-col gap-[6px] rounded-chrome border border-line bg-panel p-[8px] shadow-[0_6px_18px_var(--scrim)] ${
            variant === 'dashed' ? 'left-0 top-[40px]' : 'right-0 top-[26px]'
          }`}
        >
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            placeholder="Location name"
            aria-label="Location name"
            className="w-full rounded-chrome border border-line2 bg-sheet px-[8px] py-[5px] text-11-5 text-ink outline-none placeholder:text-ink3"
          />
          {error === null ? null : <span className="text-10-5 text-del">{error}</span>}
          <span className="flex gap-[6px]">
            <button
              type="submit"
              disabled={busy || name.trim() === ''}
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
