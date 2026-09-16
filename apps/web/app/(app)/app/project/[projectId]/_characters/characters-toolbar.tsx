'use client'

import { CHARACTER_STATUSES, CHARACTER_STATUS_LABELS } from '@folio/contracts'
import { Icon } from '@folio/ui'
import { memo, useRef, useState } from 'react'

import type { CastGroup } from '../../../../../../lib/characters/cast'
import { CAST_GROUPS, CAST_GROUP_LABELS } from '../../../../../../lib/characters/cast'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { useDismiss } from '../_chrome/use-dismiss'

/**
 * The Characters toolbar row - `Route - Characters v2.dc.html`: the route
 * name, the count chip, `flex: 1`, `All characters ▾` and the solid `＋
 * New`. `12px 20px`, 10px gaps. The mockup's `Cast · Relationships · Sheet`
 * pill sat between the chip and the gap; since 2026-09-17 it is the
 * header's centre (`view-state.tsx`, `CharactersHeaderViews`), as every
 * route's views are.
 *
 * The filter is real: a menu over the groups and the statuses, narrowing
 * the cast and the sheet. Component state - a way of looking, not an
 * address (the Storyboard's ruling for its `All shots ▾`).
 */
export type CastFilter = 'all' | `group:${CastGroup}` | `status:${(typeof CHARACTER_STATUSES)[number]}`

export const filterLabel = (filter: CastFilter): string => {
  if (filter === 'all') return 'All characters'
  if (filter.startsWith('group:')) return CAST_GROUP_LABELS[filter.slice(6) as CastGroup]
  return CHARACTER_STATUS_LABELS[filter.slice(7) as (typeof CHARACTER_STATUSES)[number]]
}

const FilterMenu = memo(({ filter, onPick }: { readonly filter: CastFilter; readonly onPick: (filter: CastFilter) => void }) => {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, () => setOpen(false), root)
  const options: readonly CastFilter[] = ['all', ...CAST_GROUPS.map((group) => `group:${group}` as const), ...CHARACTER_STATUSES.map((status) => `status:${status}` as const)]
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-cast-filter={filter}
        className="folio-pill-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[13px] text-12-5"
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        {filterLabel(filter)}
        <Icon name="chevron" size={11} strokeWidth={1.5} className="opacity-60" />
      </button>
      {open ? (
        <div role="menu" className="folio-menu absolute right-0 top-[40px] w-[220px]">
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === filter}
              data-filter-option={option}
              className={`folio-menu-item ${index === 1 || index === 1 + CAST_GROUPS.length ? 'mt-[4px] border-t border-line2 pt-[10px]' : ''}`}
              onClick={() => {
                setOpen(false)
                onPick(option)
              }}
            >
              <span className="min-w-0 flex-1">{filterLabel(option)}</span>
              {option === filter ? <Icon name="check" size={13} strokeWidth={1.6} className="flex-none opacity-70" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
})
FilterMenu.displayName = 'FilterMenu'

export const CharactersToolbar = memo(
  ({
    total,
    filter,
    onFilter,
  }: {
    readonly total: number
    readonly filter: CastFilter
    readonly onFilter: (filter: CastFilter) => void
  }) => (
    <div data-characters-toolbar className="flex flex-none flex-wrap items-center gap-[10px] px-[20px] py-[12px]">
      <h1 className="m-0 whitespace-nowrap text-14 font-medium leading-normal tracking-title">Characters</h1>
      <span className="tabular whitespace-nowrap rounded-pill bg-s2 px-[10px] py-[4px] text-11-5 text-ink2" data-cast-count>
        {total}
      </span>
      <div className="flex-1" />
      <FilterMenu filter={filter} onPick={onFilter} />
      <button
        type="button"
        data-new-character
        onClick={() => {
          setNewCharacterOpen(true)
        }}
        className="folio-solid-button flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[10px] px-[14px] text-12-5 font-medium"
      >
        ＋ New
      </button>
    </div>
  ),
)
CharactersToolbar.displayName = 'CharactersToolbar'
