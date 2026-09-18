'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * Which of the Locations route's three views is showing: `Places · Scenes
 * here · Sheet`, drawn in the header's centre like every route's views
 * (`_chrome/writing-header.tsx`; `LocationsHeaderViews` below is what the
 * layout hands it).
 *
 * ## State, not a URL - ruled 2026-09-18
 *
 * The v2 pass put the view in `?view=`, as AGENTS.md's Routing rule has
 * every sub-view, and each tab was a link that re-ran the page's read
 * before the body changed. The client ruled it for this route as
 * Characters' (2026-09-16), the Storyboard's and Scenes' (2026-09-17) were
 * ruled: switching must be instant and the URL must stay `/locations` (or
 * `/locations/:id` with the drawer open) whichever tab is lit. So the view
 * is React state and the pill's tabs are buttons (`_chrome/view-pill.tsx`,
 * the `onSelect` target); `?view=` is an unknown key on this route and a
 * stale `?view=sheet` link opens the places, not a 404. AGENTS.md's
 * exception table names the row.
 *
 * ## It lives in the layout, so the drawer does not reset it
 *
 * Opening a record is a navigation, `/locations` → `/locations/:id`, and
 * the page's subtree remounts under `locations/layout.tsx`. The layout
 * wraps the route in this provider beside `FindProvider`, so the view
 * rides across the drawer's open and close - the Characters shape exactly.
 * It still starts on the places on every full load.
 */

export type LocationsView = 'places' | 'scenes' | 'sheet'

export const LOCATIONS_VIEWS: readonly ViewPillItem<LocationsView>[] = [
  { id: 'places', title: 'Places' },
  { id: 'scenes', title: 'Scenes here' },
  { id: 'sheet', title: 'Sheet' },
]

type ViewState = { readonly view: LocationsView; readonly setView: (view: LocationsView) => void }

const ViewContext = createContext<ViewState>({ view: 'places', setView: () => undefined })

export const LocationsViewProvider = ({ children }: { readonly children: ReactNode }) => {
  const [view, setView] = useState<LocationsView>('places')
  const value = useMemo<ViewState>(() => ({ view, setView }), [view])
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export const useLocationsView = (): ViewState => useContext(ViewContext)

/** The header's centre on this route: the three tabs as buttons over the provider's state. */
export const LocationsHeaderViews = () => {
  const { view, setView } = useLocationsView()
  return <ViewPill label={viewsLabel(ROUTE_TITLE.locations)} items={LOCATIONS_VIEWS} current={view} onSelect={setView} />
}
