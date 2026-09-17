'use client'

import { useSyncExternalStore } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * Which of the Scenes route's three views is showing: `Cards · Index cards
 * · Scene list` - the mockup's pill (`Route - Scenes v2.dc.html`), drawn in
 * the header's centre since 2026-09-17 like every route's views
 * (`_chrome/writing-header.tsx`; `ScenesHeaderViews` below is what the
 * header draws there on this route).
 *
 * ## State, not a URL - ruled 2026-09-17
 *
 * The view was `?view=`, as AGENTS.md's Routing rule has every sub-view,
 * and each tab was a link: a click moved the address to `/scenes?view=index`
 * and re-ran the page on the server - `loadScenes` again, the node list and
 * the measurement read back through the pooler - before the body changed.
 * The client ruled it the way the Storyboard's tabs were ruled the same day
 * and Characters' on 2026-09-16: switching must be smooth and the URL must
 * not change - it stays `/scenes` whichever tab is lit. So the view is
 * client state, the tabs are buttons (`_chrome/view-pill.tsx`, the
 * `onSelect` target), and `?view=` is an unknown key on this route: a stale
 * `?view=index` link opens the cards, not a 404. AGENTS.md's exception
 * table names the row.
 *
 * ## A cell, because the header and the body are in different trees
 *
 * The Storyboard's reason, exactly (`_storyboard/view-state.tsx`): the
 * Scenes route has no layout of its own - the writing layout is shared with
 * Script, Outline and the Storyboard and cannot host one route's state - and
 * the header it renders is a sibling of the page, not a child. So the view
 * is a module-level value both trees subscribe to, the header to light its
 * tab and take the click, the route's `<main>` (`scenes-main.tsx`) and the
 * workspace to draw the body. It starts on the cards on every full load
 * (the server snapshot), and the route's root resets it when it unmounts,
 * so the sidebar's Scenes row and the episode menu land on the cards as
 * their bare-path links did.
 */

export type ScenesView = 'cards' | 'index' | 'list'

/** The mockup's name for each view: the tab's title, and the toolbar's word while no scene is selected. */
export const VIEW_LABEL: Readonly<Record<ScenesView, string>> = {
  cards: 'Scene cards',
  index: 'Index cards',
  list: 'Scene list',
}

/**
 * The three tabs. `title` is the mockup's name (the tooltip); `label` is
 * what the tab prints (`lib/workspace/views.ts`, "Titles and labels");
 * the icons are the mockup's own.
 */
export const SCENES_VIEWS: readonly ViewPillItem<ScenesView>[] = [
  { id: 'cards', title: VIEW_LABEL.cards, label: 'Cards', icon: 'cards' },
  { id: 'index', title: VIEW_LABEL.index, icon: 'board' },
  { id: 'list', title: VIEW_LABEL.list, icon: 'list' },
]

const DEFAULT_VIEW: ScenesView = 'cards'

type Listener = () => void

let current: ScenesView = DEFAULT_VIEW
const listeners = new Set<Listener>()

export const setScenesView = (view: ScenesView): void => {
  if (view === current) return
  current = view
  for (const listener of listeners) listener()
}

/** Back to the cards: the route's unmount, so the next visit starts where a bare link did. */
export const resetScenesView = (): void => {
  setScenesView(DEFAULT_VIEW)
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): ScenesView => current
const readServer = (): ScenesView => DEFAULT_VIEW

export const useScenesView = (): ScenesView => useSyncExternalStore(subscribe, read, readServer)

/**
 * The header's centre on this route: the three tabs as buttons over the
 * cell, where the routes still on `?view=` draw `_chrome/header-views.tsx`.
 * The header draws this itself when its segment is `scenes` - the writing
 * layout cannot hand it in, since a layout cannot see which route it
 * renders.
 */
export const ScenesHeaderViews = () => {
  const view = useScenesView()
  return <ViewPill label={viewsLabel(ROUTE_TITLE.scenes)} items={SCENES_VIEWS} current={view} onSelect={setScenesView} />
}
