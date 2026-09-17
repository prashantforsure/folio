'use client'

import { useSyncExternalStore } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * Which of the Storyboard's three views is showing: `Boards · Canvas ·
 * Shot list` - the mockup's pill (`Route - Storyboard v2.dc.html`), drawn
 * in the header's centre since 2026-09-17 like every route's views
 * (`_chrome/writing-header.tsx`; `StoryboardHeaderViews` below is what the
 * header draws there on this route).
 *
 * ## State, not a URL - ruled 2026-09-17
 *
 * The view was `?view=`, as AGENTS.md's Routing rule has every sub-view,
 * and each tab was a link: a click moved the address and re-ran the page
 * on the server - `loadStoryboard` again, a round trip to the database -
 * before the body changed. The client ruled it the way Characters' tabs
 * were ruled on 2026-09-16 and the Script's switches on 2026-09-11:
 * switching must be smooth and the URL must not change - it stays
 * `/storyboard` whichever tab is lit. So the view is client state, the
 * tabs are buttons (`_chrome/view-pill.tsx`, the `onSelect` target), and
 * `?view=` is an unknown key on this route: a stale `?view=canvas` link
 * opens the board, not a 404. AGENTS.md's exception table names the row.
 *
 * ## A cell, because the header and the body are in different trees
 *
 * Characters holds its view in a provider in its own layout. The
 * Storyboard has no layout of its own - the writing layout is shared with
 * Script, Outline and Scenes and cannot host one route's state - and the
 * header it renders is a sibling of the page, not a child. So the view is
 * the cell `lib/storyboard/coverage.ts` already is for the sidebar: one
 * module-level value both trees subscribe to, the header to light its tab
 * and take the click, the workspace to draw the body. It starts on the
 * board on every full load (the server snapshot), and the workspace resets
 * it when it unmounts, so the sidebar's Storyboard row and the episode
 * menu land on the board as their bare-path links did.
 */

export type StoryboardView = 'board' | 'canvas' | 'list'

/**
 * The three tabs. `title` is the mockup's name (the tooltip); `label` is
 * what the tab prints (`lib/workspace/views.ts`, "Titles and labels");
 * the icons are the mockup's own.
 */
export const STORYBOARD_VIEWS: readonly ViewPillItem<StoryboardView>[] = [
  { id: 'board', title: 'Scene boards', label: 'Boards', icon: 'board' },
  { id: 'canvas', title: 'Shot canvas', label: 'Canvas', icon: 'canvas' },
  { id: 'list', title: 'Shot list', icon: 'list' },
]

const DEFAULT_VIEW: StoryboardView = 'board'

type Listener = () => void

let current: StoryboardView = DEFAULT_VIEW
const listeners = new Set<Listener>()

export const setStoryboardView = (view: StoryboardView): void => {
  if (view === current) return
  current = view
  for (const listener of listeners) listener()
}

/** Back to the board: the workspace's unmount, so the next visit starts where a bare link did. */
export const resetStoryboardView = (): void => {
  setStoryboardView(DEFAULT_VIEW)
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const read = (): StoryboardView => current
const readServer = (): StoryboardView => DEFAULT_VIEW

export const useStoryboardView = (): StoryboardView => useSyncExternalStore(subscribe, read, readServer)

/**
 * The header's centre on this route: the three tabs as buttons over the
 * cell, where the routes still on `?view=` draw `_chrome/header-views.tsx`.
 * The header draws this itself when its segment is `storyboard` - the
 * writing layout cannot hand it in, since a layout cannot see which
 * route it renders.
 */
export const StoryboardHeaderViews = () => {
  const view = useStoryboardView()
  return <ViewPill label={viewsLabel(ROUTE_TITLE.storyboard)} items={STORYBOARD_VIEWS} current={view} onSelect={setStoryboardView} />
}
