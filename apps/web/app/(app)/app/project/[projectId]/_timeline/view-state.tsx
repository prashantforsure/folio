'use client'

import type { StoryThreadId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { ROUTE_TITLE } from '../../../../../../lib/workspace/routes'
import { viewsLabel } from '../../../../../../lib/workspace/views'
import type { SaveIndicator } from '../_chrome/status-bar'
import type { Run } from '../_chrome/use-run'
import { useRun } from '../_chrome/use-run'
import { ViewPill } from '../_chrome/view-pill'
import type { ViewPillItem } from '../_chrome/view-pill'

/**
 * The Timeline route's state: which of its three views is showing, which
 * scene the drawer holds, which thread is solo, and whether the writer
 * asked for the grid before anything is placed. Plain React state in one
 * provider the route's layout wraps both trees in - the sidebar card is
 * the layout's and the grid is the page's, two trees with no channel
 * between them but this.
 *
 * ## The views are state, not a URL - ruled 2026-09-18
 *
 * The first pass put `story | chrono | continuity` in `?view=`, as
 * AGENTS.md's Routing rule has every sub-view, and each tab was a link that
 * re-ran the page's read before the body changed. The client ruled it for
 * this route as Characters' (2026-09-16), the Storyboard's and Scenes'
 * (2026-09-17) and Locations' (2026-09-18) were ruled: switching must be
 * instant and the URL must stay `/timeline` whichever tab is lit. So the
 * view is state here and the pill's tabs are buttons (`_chrome/view-pill.tsx`,
 * the `onSelect` target); `?view=` is an unknown key on this route and a
 * stale `?view=chrono` link opens story order, not a 404. `TimelineHeaderViews`
 * is what the layout hands the header for its centre.
 *
 * ## The rest, `lib/state/README.md`'s "then React state" case
 *
 *   `selected`   the scene the drawer shows. Selection is component state
 *                on every route (the Scenes ruling, 2026-09-11): `?selected=`
 *                and `/timeline/:sceneId` stay blocked on the `SCENE_xxx`
 *                id-shape decision (open decision 10), so unlike Characters'
 *                and Locations' drawers this one is not a path.
 *   `solo`       the thread whose row is lit while the others dim - the
 *                sidebar's click. A way of looking, not an address.
 *   `byHand`     the empty card's `＋ By hand`: the grid before anything is
 *                placed. Reset on reload, the right lifetime for "show me
 *                anyway".
 *
 * ## One save indicator for both trees
 *
 * The sidebar writes threads and the body writes story time, and the
 * status bar is the body's. The first pass ran two save pipelines - the
 * body's dot and the column's inline error - so a thread rename never
 * said "Saving…". `useRun` lives here now and both trees call the same
 * `run`, so every write on the route lights the one dot.
 */

export type TimelineView = 'story' | 'chrono' | 'continuity'

export const TIMELINE_VIEWS: readonly ViewPillItem<TimelineView>[] = [
  { id: 'story', title: 'Story order' },
  { id: 'chrono', title: 'Chronology' },
  { id: 'continuity', title: 'Continuity' },
]

type TimelineState = {
  readonly view: TimelineView
  readonly setView: (view: TimelineView) => void
  readonly selected: NodeId | null
  readonly select: (id: NodeId | null) => void
  readonly solo: StoryThreadId | null
  readonly toggleSolo: (id: StoryThreadId) => void
  readonly byHand: boolean
  readonly setByHand: (value: boolean) => void
  readonly save: SaveIndicator
  readonly run: Run
  /** The count the Continuity tab's badge prints; the body publishes it after each load. */
  readonly flags: number
  readonly setFlags: (count: number) => void
}

const TimelineContext = createContext<TimelineState | null>(null)

export const TimelineStateProvider = ({ children }: { readonly children: ReactNode }) => {
  const [view, setView] = useState<TimelineView>('story')
  const [selected, select] = useState<NodeId | null>(null)
  const [solo, setSolo] = useState<StoryThreadId | null>(null)
  const [byHand, setByHand] = useState(false)
  const [flags, setFlags] = useState(0)
  const { save, run } = useRun('idle')

  const toggleSolo = useCallback((id: StoryThreadId) => {
    setSolo((current) => (current === id ? null : id))
  }, [])

  const value = useMemo<TimelineState>(
    () => ({ view, setView, selected, select, solo, toggleSolo, byHand, setByHand, save, run, flags, setFlags }),
    [view, selected, solo, toggleSolo, byHand, save, run, flags],
  )
  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>
}

export const useTimelineState = (): TimelineState => {
  const value = useContext(TimelineContext)
  if (value === null) {
    throw new Error('Folio: useTimelineState was called outside TimelineStateProvider. The provider is in _chrome/timeline-layout.tsx.')
  }
  return value
}

/** The header's centre on this route: the three tabs as buttons over the provider's state, the flag count on Continuity. */
export const TimelineHeaderViews = () => {
  const { view, setView, flags } = useTimelineState()
  const items = useMemo<readonly ViewPillItem<TimelineView>[]>(
    () => TIMELINE_VIEWS.map((tab) => (tab.id === 'continuity' && flags > 0 ? { ...tab, badge: flags } : tab)),
    [flags],
  )
  return <ViewPill label={viewsLabel(ROUTE_TITLE.timeline)} items={items} current={view} onSelect={setView} />
}
