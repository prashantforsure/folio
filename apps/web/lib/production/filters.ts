import type { ReelShot, ShotStatus, SortMode, StatusFilter, ViewPreferences } from '@folio/contracts'
import { SHOT_STATUSES } from '@folio/contracts'

import { secondsOf, shotStatusOf } from './derive'

/**
 * §2.5, Filter & sort: which shots a reel shows and in what order. Pure;
 * the reel's own order (`position`) is the default and the timing bar,
 * the sheet and the numbers always use it - only the list is filtered.
 */

const ATTENTION: ReadonlySet<ShotStatus> = new Set(['refused', 'out_of_date', 'proposed'])

/** `To draw` matches To draw + Queued; `Needs attention` matches Refused, Out of date, Proposed. */
export const statusPasses = (status: ShotStatus, filter: StatusFilter): boolean => {
  switch (filter) {
    case 'all':
      return true
    case 'todraw':
      return status === 'to_draw' || status === 'queued'
    case 'drawn':
      return status === 'drawn'
    case 'attention':
      return ATTENTION.has(status)
  }
}

export const shotPasses = (shot: ReelShot, prefs: Pick<ViewPreferences, 'statusFilter' | 'unassignedOnly'>): boolean => {
  if (!statusPasses(shotStatusOf(shot), prefs.statusFilter)) return false
  if (prefs.unassignedOnly && shot.assigneeId !== null) return false
  return true
}

const statusRank = (status: ShotStatus): number => SHOT_STATUSES.indexOf(status)

/** `order` keeps the reel's order; `longest` sorts by seconds desc; `status` by the menu's order. Stable. */
export const sortShots = (shots: readonly ReelShot[], sort: SortMode): readonly ReelShot[] => {
  if (sort === 'order') return shots
  const indexed = shots.map((shot, index) => ({ shot, index }))
  indexed.sort((a, b) => {
    const delta = sort === 'longest' ? secondsOf(b.shot) - secondsOf(a.shot) : statusRank(shotStatusOf(a.shot)) - statusRank(shotStatusOf(b.shot))
    return delta !== 0 ? delta : a.index - b.index
  })
  return indexed.map((entry) => entry.shot)
}

/** The list a reel shows: filtered, then sorted. */
export const visibleShots = (shots: readonly ReelShot[], prefs: Pick<ViewPreferences, 'statusFilter' | 'unassignedOnly' | 'sort'>): readonly ReelShot[] =>
  sortShots(shots.filter((shot) => shotPasses(shot, prefs)), prefs.sort)

/** "When any filter or non-default sort is active the filter button … turn[s] accent." */
export const filterActive = (prefs: Pick<ViewPreferences, 'statusFilter' | 'unassignedOnly' | 'sort'>): boolean =>
  prefs.statusFilter !== 'all' || prefs.unassignedOnly || prefs.sort !== 'order'
