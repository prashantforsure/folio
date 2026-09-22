'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * Which of the Props route's two views is showing: `Overview · List`,
 * drawn in the header's centre like every route's views.
 *
 * ## State, not a URL
 *
 * Ruled with the route, on the run of rulings that started with Characters
 * (2026-09-16) and took in the Storyboard and Scenes (2026-09-17) and
 * Locations and the Timeline (2026-09-18): switching must be instant and
 * the URL must stay `/props` (or `/props/:id` with the drawer open)
 * whichever tab is lit. So the view is React state and the pill's tabs are
 * buttons; `?view=` is an unknown key on this route and a stale
 * `?view=list` link opens the overview rather than 404ing.
 *
 * ## It lives in the layout, so the drawer does not reset it
 *
 * Opening a record is a navigation, `/props` -> `/props/:id`, and the
 * page's subtree remounts under `props/layout.tsx`. The layout wraps the
 * route in this provider beside `FindProvider`, so the view rides across
 * the drawer's open and close - the Locations shape exactly. Get this
 * wrong and every click on a card throws the writer back to the first tab.
 * It still starts on the overview on every full load.
 */

export type PropsView = 'overview' | 'list'

export const PROPS_VIEWS: readonly ViewPillItem<PropsView>[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'list', title: 'List' },
]

type ViewState = { readonly view: PropsView; readonly setView: (view: PropsView) => void }

const ViewContext = createContext<ViewState>({ view: 'overview', setView: () => undefined })

export const PropsViewProvider = ({ children }: { readonly children: ReactNode }) => {
  const [view, setView] = useState<PropsView>('overview')
  const value = useMemo<ViewState>(() => ({ view, setView }), [view])
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export const usePropsView = (): ViewState => useContext(ViewContext)

/** The header's centre on this route: the two tabs as buttons over the provider's state. */
export const PropsHeaderViews = () => {
  const { view, setView } = usePropsView()
  return <ViewPill label={viewsLabel(ROUTE_TITLE.props)} items={PROPS_VIEWS} current={view} onSelect={setView} />
}
