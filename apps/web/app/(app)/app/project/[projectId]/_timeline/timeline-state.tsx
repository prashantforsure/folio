'use client'

import type { StoryThreadId } from '@folio/contracts'
import type { NodeId } from '@folio/script'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * The Timeline's ephemeral state. Plain React state, shared between the
 * thread column (drawn by the route's layout) and the grid (drawn by its
 * page), which are two trees with no channel between them but this.
 *
 * `lib/state/README.md`: "URL first, then React state." The three things
 * here are the "then" case - none is worth a link, and none should
 * survive leaving the route:
 *
 *   `hidden`     threads whose rows are dimmed - the column's eye toggle.
 *                A filter, not a sub-view.
 *   `selected`   the scene the right panel shows. Selection is component
 *                state on every route (the Scenes ruling, 2026-09-11):
 *                `?selected=` is blocked on the `SCENE_xxx` id-shape
 *                decision.
 *   `byHand`     the empty state's "Place by hand": the writer asked for
 *                the grid before anything is placed. Reset on reload,
 *                which is the right lifetime for "show me anyway".
 *
 * Nothing is persisted, so there is no storage guard and no SSR branch.
 */

type TimelineStateValue = {
  readonly hidden: ReadonlySet<StoryThreadId>
  readonly toggleHidden: (id: StoryThreadId) => void
  readonly selected: NodeId | null
  readonly select: (id: NodeId | null) => void
  readonly byHand: boolean
  readonly setByHand: (value: boolean) => void
}

const TimelineStateContext = createContext<TimelineStateValue | null>(null)

export const TimelineStateProvider = ({ children }: { readonly children: ReactNode }) => {
  const [hidden, setHidden] = useState<ReadonlySet<StoryThreadId>>(() => new Set())
  const [selected, select] = useState<NodeId | null>(null)
  const [byHand, setByHand] = useState(false)

  const toggleHidden = useCallback((id: StoryThreadId) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const value = useMemo<TimelineStateValue>(
    () => ({ hidden, toggleHidden, selected, select, byHand, setByHand }),
    [hidden, toggleHidden, selected, byHand],
  )

  return <TimelineStateContext.Provider value={value}>{children}</TimelineStateContext.Provider>
}

export const useTimelineState = (): TimelineStateValue => {
  const value = useContext(TimelineStateContext)
  if (value === null) {
    throw new Error(
      'Folio: useTimelineState was called outside TimelineStateProvider. The provider is in timeline/layout.tsx.',
    )
  }
  return value
}
