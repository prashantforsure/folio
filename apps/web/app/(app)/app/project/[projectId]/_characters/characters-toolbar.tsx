'use client'

import { CHARACTER_STATUSES, CHARACTER_STATUS_LABELS } from '@folio/contracts'
import { memo } from 'react'

import type { CastFigure, CastGroup } from '../../../../../../lib/characters/cast'
import { CAST_GROUPS, CAST_GROUP_LABELS } from '../../../../../../lib/characters/cast'
import { setNewCharacterOpen } from '../../../../../../lib/characters/compose'
import { FilterMenu, NewButton, RecordToolbar } from '../_chrome/record-toolbar'

/**
 * The Characters toolbar row, on the record routes' shared pieces
 * (`_chrome/record-toolbar.tsx`) since 2026-09-17: the route name, the count
 * chip (`8`, or `3 of 8` while a filter narrows the cast), `flex: 1`, `All
 * characters ▾` and the solid `+ New`. The view pill is the header's
 * centre (`view-state.tsx`, `CharactersHeaderViews`), as every route's.
 *
 * The filter is real and applies to every view the same way - the cast,
 * the sheet, the map. A menu over the groups, the statuses and `No
 * description` (the assistant panel's report chip of the same name is this
 * filter's answer). Component state - a way of looking, not an address.
 */
export type CastFilter = 'all' | `group:${CastGroup}` | `status:${(typeof CHARACTER_STATUSES)[number]}` | 'no-description'

export const CAST_FILTERS: readonly CastFilter[] = [
  'all',
  ...CAST_GROUPS.map((group) => `group:${group}` as const),
  ...CHARACTER_STATUSES.map((status) => `status:${status}` as const),
  'no-description',
]

export const filterLabel = (filter: CastFilter): string => {
  if (filter === 'all') return 'All characters'
  if (filter === 'no-description') return 'No description'
  if (filter.startsWith('group:')) return CAST_GROUP_LABELS[filter.slice(6) as CastGroup]
  return CHARACTER_STATUS_LABELS[filter.slice(7) as (typeof CHARACTER_STATUSES)[number]]
}

/** Whether a figure passes the filter. One rule for every view. */
export const passesFilter = (figure: CastFigure, filter: CastFilter): boolean => {
  if (filter === 'all') return true
  if (filter === 'no-description') return figure.bio === null
  if (filter.startsWith('group:')) return `group:${figure.group}` === filter
  return `status:${figure.status}` === filter
}

export const CharactersToolbar = memo(
  ({
    count,
    filter,
    onFilter,
  }: {
    /** `8`, or `3 of 8` while filtered. */
    readonly count: string
    readonly filter: CastFilter
    readonly onFilter: (filter: CastFilter) => void
  }) => (
    <RecordToolbar title="Characters" total={count} countAttr="data-cast-count" attr="data-characters-toolbar">
      <FilterMenu
        value={filter}
        options={CAST_FILTERS}
        label={filterLabel}
        dividers={[1, 1 + CAST_GROUPS.length]}
        attr="data-cast-filter"
        onPick={onFilter}
      />
      <NewButton
        attr="data-new-character"
        label="+ New"
        onClick={() => {
          setNewCharacterOpen(true)
        }}
      />
    </RecordToolbar>
  ),
)
CharactersToolbar.displayName = 'CharactersToolbar'
