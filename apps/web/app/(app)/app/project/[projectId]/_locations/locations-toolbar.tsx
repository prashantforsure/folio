'use client'

import { LOCATION_STATUSES } from '@folio/contracts'
import { memo } from 'react'

import { setNewLocationOpen } from '../../../../../../lib/locations/compose'
import type { StatusFilter } from '../../../../../../lib/locations/view'
import { FILTER_LABELS } from '../../../../../../lib/locations/view'
import type { ProjectRoutePath } from '../../../../../../lib/workspace/hrefs'
import { FilterMenu, NewButton, RecordToolbar } from '../_chrome/record-toolbar'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * The Locations toolbar row - `Route - Locations v2.dc.html`: the route
 * name, the count chip, the `Places · Scenes here · Sheet` pill (the shared
 * `_chrome/view-pill.tsx`, text shape, over `?view=`), `flex: 1`, `All
 * locations ▾` and the solid `＋ New` (`_chrome/record-toolbar.tsx`).
 *
 * The filter is real: a menu over the three statuses, narrowing every
 * view. Component state - a way of looking, not an address (the
 * Storyboard's ruling for its `All shots ▾`).
 */
export type LocationsView = 'places' | 'scenes' | 'sheet'

export const LOCATIONS_VIEWS: readonly ViewPillItem<LocationsView>[] = [
  { id: 'places', title: 'Places' },
  { id: 'scenes', title: 'Scenes here' },
  { id: 'sheet', title: 'Sheet' },
]

const FILTERS: readonly StatusFilter[] = ['all', ...LOCATION_STATUSES]

export const LocationsToolbar = memo(
  ({
    total,
    view,
    baseHref,
    filter,
    onFilter,
  }: {
    readonly total: number
    readonly view: LocationsView
    readonly baseHref: ProjectRoutePath
    readonly filter: StatusFilter
    readonly onFilter: (filter: StatusFilter) => void
  }) => (
    <RecordToolbar
      title="Locations"
      total={total}
      countAttr="data-location-count"
      attr="data-locations-toolbar"
      pill={<ViewPill label="Location views" shape="text" items={LOCATIONS_VIEWS} current={view} baseHref={baseHref} />}
    >
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
