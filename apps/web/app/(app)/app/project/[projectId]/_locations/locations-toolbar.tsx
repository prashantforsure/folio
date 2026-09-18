'use client'

import { LOCATION_STATUSES } from '@folio/contracts'
import { memo } from 'react'

import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import type { StatusFilter } from '../../../../../../lib/locations/view'
import { FILTER_LABELS } from '../../../../../../lib/locations/view'
import { FilterMenu, NewButton, RecordToolbar } from '../_chrome/record-toolbar'

/**
 * The Locations toolbar row - `Route - Locations v2.dc.html`: the route
 * name, the count chip, `flex: 1`, `All locations ▾` and the solid `＋ New`
 * (`_chrome/record-toolbar.tsx`). The mockup's `Places · Scenes here ·
 * Sheet` pill followed the chip; since 2026-09-17 it is the header's
 * centre (`lib/workspace/views.ts`, `_chrome/header-views.tsx`), as every
 * route's views are.
 *
 * The filter is real: a menu over the three statuses, narrowing every
 * view. Component state - a way of looking, not an address (the
 * Storyboard's ruling for its `All shots ▾`). The count chip reads `3 of
 * 8` while the filter or the sidebar's find narrows the rows.
 */
export type { LocationsView } from './view-state'

const FILTERS: readonly StatusFilter[] = ['all', ...LOCATION_STATUSES]

export const LocationsToolbar = memo(
  ({
    count,
    filter,
    onFilter,
  }: {
    /** `8`, or `3 of 8` while narrowed. */
    readonly count: string
    readonly filter: StatusFilter
    readonly onFilter: (filter: StatusFilter) => void
  }) => (
    <RecordToolbar title="Locations" total={count} countAttr="data-location-count" attr="data-locations-toolbar">
      <FilterMenu value={filter} options={FILTERS} label={(option) => FILTER_LABELS[option]} dividers={[1]} attr="data-location-filter" onPick={onFilter} />
      <NewButton
        attr="data-new-location"
        onClick={() => {
          setNewLocationOpen(true)
        }}
      />
    </RecordToolbar>
  ),
)
LocationsToolbar.displayName = 'LocationsToolbar'
