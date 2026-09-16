'use client'

import type { ProjectId } from '@folio/contracts'
import { Icon } from '@folio/ui'
import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

import type { CastGroup } from '../../../../../../lib/characters/cast'
import { CAST_GROUPS, CAST_GROUP_LABELS, definedOf } from '../../../../../../lib/characters/cast'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { characterHref } from '../../../../../../lib/workspace/hrefs'
import { count } from '../../../../../../lib/workspace/format'
import { CastMark } from './cast-mark'

/**
 * The Characters sidebar's four slots - `Route - Characters v2.dc.html`:
 * the project's name with `+` (`New character`), the recessed `Find a
 * character` field, the grouped list (`Principal` · `Supporting`, an
 * eyebrow and a count each; a 24px gradient chip, the short name over the
 * role, the scene count), and the `Defined N / M` widget with its bar and
 * `2 still drafts`. The layout hands them to the shared `Sidebar` card
 * (`_chrome/sidebar.tsx`), which draws them in the writing sidebar's
 * places.
 *
 * ## The find field filters the list it sits above
 *
 * The mockup's field has no behaviour; here it narrows the groups below it
 * by name or role, and nothing else - the grid has its own `All characters
 * ▾` filter. The two slots are separate children of the server card, so
 * the query rides a context the layout wraps the card in
 * (`CastSidebarProvider`); component state, worth no link.
 *
 * ## Which row is lit
 *
 * The drawer is `/characters/:id`, so the selected record is the URL and
 * `useSelectedLayoutSegment` reads it from under the route's layout - no
 * cell to publish, and the first paint agrees with the page.
 */

export type CastSidebarRow = {
  readonly id: string
  readonly name: string
  readonly short: string
  readonly initial: string
  readonly hue: number
  readonly role: string | null
  readonly appearances: number
  readonly group: CastGroup
  readonly status: 'draft' | 'defined' | 'locked'
}

type Query = { readonly query: string; readonly setQuery: (value: string) => void }

const QueryContext = createContext<Query>({ query: '', setQuery: () => undefined })

export const CastSidebarProvider = ({ children }: { readonly children: ReactNode }) => {
  const [query, setQuery] = useState('')
  const value = useMemo<Query>(() => ({ query, setQuery }), [query])
  return <QueryContext.Provider value={value}>{children}</QueryContext.Provider>
}

/** The title row: the project's name and `+`. */
export const CastTitleRow = ({ title }: { readonly title: string }) => (
  <div className="flex flex-none items-center gap-[6px] pb-[10px] pl-[12px] pr-[12px] pt-[14px]">
    <span className="min-w-0 flex-1 truncate text-14 font-medium tracking-title">{title}</span>
    <button
      type="button"
      title="New character"
      aria-label="New character"
      data-sidebar-new-character
      onClick={() => {
        setNewCharacterOpen(true)
      }}
      className="folio-ghost-button grid h-[24px] w-[24px] place-items-center rounded-[8px] text-15 leading-none text-ink3"
    >
      +
    </button>
  </div>
)

/** The recessed search field. */
export const CastFind = () => {
  const { query, setQuery } = useContext(QueryContext)
  return (
    <div className="flex-none px-[10px] pb-[10px]">
      <label className="flex items-center gap-[8px] rounded-[10px] border border-line2 bg-sunk px-[10px] py-[7px]">
        <Icon name="search" size={13} strokeWidth={1.4} className="flex-none opacity-40" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Find a character"
          aria-label="Find a character"
          data-cast-find
          className="min-w-0 flex-1 border-none bg-transparent text-12-5 text-ink outline-none placeholder:text-ink3"
        />
      </label>
    </div>
  )
}

const matches = (row: CastSidebarRow, query: string): boolean => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return row.name.toLowerCase().includes(needle) || (row.role ?? '').toLowerCase().includes(needle)
}

/** The grouped list. */
export const CastGroups = ({ projectId, rows }: { readonly projectId: ProjectId; readonly rows: readonly CastSidebarRow[] }) => {
  const { query } = useContext(QueryContext)
  const selected = useSelectedLayoutSegment()
  const groups = CAST_GROUPS.map((group) => ({
    group,
    items: rows.filter((row) => row.group === group && matches(row, query)),
  })).filter((entry) => entry.items.length > 0)

  if (rows.length === 0) {
    return (
      <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3" data-cast-empty>
        Characters appear here as the script names them. Nothing to list yet.
      </p>
    )
  }
  if (groups.length === 0) {
    return (
      <p className="m-0 ml-[10px] mr-[10px] mt-[2px] text-12 leading-[1.55] text-ink3" data-cast-no-match>
        No character matches that.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-[16px]" data-cast-groups>
      {groups.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-[2px]" data-cast-group={group}>
          <div className="flex items-center pb-[6px] pl-[10px] pr-[10px]">
            <span className="folio-eyebrow flex-1">{CAST_GROUP_LABELS[group]}</span>
            <span className="tabular text-11 text-ink3">{count(items.length)}</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
            {items.map((row) => (
              <li key={row.id}>
                <Link
                  href={characterHref(projectId, row.id)}
                  data-cast-row={row.id}
                  aria-current={row.id === selected ? 'page' : undefined}
                  className="folio-cast-row"
                >
                  <CastMark initial={row.initial} hue={row.hue} size={24} radius={8} fontSize={9.5} />
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="truncate text-13">{row.short}</span>
                    <span className="truncate text-10-5 text-ink3">{row.role ?? 'No role yet'}</span>
                  </span>
                  <span className="tabular flex-none text-11 text-ink3">{count(row.appearances)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The `Defined N / M` widget pinned at the foot. */
export const DefinedWidget = ({ rows }: { readonly rows: readonly { readonly status: 'draft' | 'defined' | 'locked' }[] }) => {
  const defined = definedOf(rows)
  return (
    <div data-defined-card className="flex flex-col gap-[7px] rounded-card border border-line2 bg-s1 px-[12px] py-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="text-12 text-ink2">Defined</span>
        <span className="tabular text-13 font-medium" data-defined-count>
          {defined.defined} / {defined.total}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[3px] bg-s3">
        <div className="h-full rounded-[3px] bg-accent" style={{ width: `${String(defined.percent)}%` }} />
      </div>
      <span className="text-11 text-ink3" data-defined-note>
        {defined.note}
      </span>
    </div>
  )
}
