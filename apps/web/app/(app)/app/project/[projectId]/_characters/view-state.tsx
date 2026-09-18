'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * Which of the Characters route's three views is showing: `Cast ·
 * Presence · Sheet` - drawn in the header's centre since 2026-09-17 like
 * every route's views (`_chrome/writing-header.tsx`; `CharactersHeaderViews`
 * below is what the layout hands it). Presence replaced the Relationships
 * graph on 2026-09-18 (ruled 2026-09-17: a character × scene grid, the
 * pairs list and the findings under it).
 *
 * ## State, not a URL - ruled 2026-09-16
 *
 * The first v2 pass put the view in `?view=`, as AGENTS.md's Routing rule
 * has every sub-view. The client re-ruled it for this route the way the
 * Script route's two switches were ruled on 2026-09-11: switching must be
 * instant and must not change the address - the URL stays `/characters`
 * (or `/characters/:id` with the drawer open) whichever tab is lit. So the
 * view is React state and the pill's tabs are buttons (`_chrome/view-pill.tsx`,
 * the `onSelect` target); `?view=` is an unknown key on this route and a
 * stale link opens the cast, not a 404. AGENTS.md's exception table names
 * the row.
 *
 * ## It lives in the layout, so the drawer does not reset it
 *
 * Opening a record is a navigation, `/characters` → `/characters/:id`, and
 * the page's subtree remounts under `characters/layout.tsx`. State held in
 * the workspace would fall back to the cast every time a presence row or a
 * sheet row was clicked - which is what the URL-borne view did too, since
 * `characterHref` carries no query. The layout wraps the route in this
 * provider beside `CastSidebarProvider`, and the view rides across the
 * drawer's open and close. It still starts on the cast on every full load:
 * a peek that must not survive a navigation away.
 */

export type CharactersView = 'cast' | 'presence' | 'sheet'

export const CHARACTERS_VIEWS: readonly ViewPillItem<CharactersView>[] = [
  { id: 'cast', title: 'Cast' },
  { id: 'presence', title: 'Presence' },
  { id: 'sheet', title: 'Sheet' },
]

type ViewState = { readonly view: CharactersView; readonly setView: (view: CharactersView) => void }

const ViewContext = createContext<ViewState>({ view: 'cast', setView: () => undefined })

export const CharactersViewProvider = ({ children }: { readonly children: ReactNode }) => {
  const [view, setView] = useState<CharactersView>('cast')
  const value = useMemo<ViewState>(() => ({ view, setView }), [view])
  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export const useCharactersView = (): ViewState => useContext(ViewContext)

/**
 * The header's centre on this route: the three tabs as buttons over the
 * provider's state, where the other routes draw `_chrome/header-views.tsx`
 * over `?view=`. The layout renders the header inside the provider and
 * hands this in as `views`.
 */
export const CharactersHeaderViews = () => {
  const { view, setView } = useCharactersView()
  return <ViewPill label={viewsLabel(ROUTE_TITLE.characters)} items={CHARACTERS_VIEWS} current={view} onSelect={setView} />
}
