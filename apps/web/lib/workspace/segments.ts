import { isReservedProjectSegment } from '@folio/contracts'

import type { RailSection } from './routes'
import { isEpisodeRoute, isProjectRoute, railSectionOf } from './routes'

/**
 * Which rail section the current URL lights, from the layout segments below
 * `project/[projectId]`.
 *
 * `useSelectedLayoutSegments()` reports route groups as `(film)` and
 * `(writing)`; they are folded out first because they are file-system
 * structure, not URL. What is left is one of:
 *
 *   []                          the project index, on its way to a script
 *   ['characters']              a project route
 *   ['settings']                the stub; nothing in the rail is lit
 *   ['script']                  a collapsed (film) episode route
 *   ['ep_001'] / ['ep_001', 'script']   an episodic route or its index
 *
 * The episode segment is skipped when present - by shape, not by lookup:
 * anything that is neither a reserved project name nor an episode route name
 * is in the episode position. This is only a display decision; the real
 * validation of that segment happens server-side in `[episodeId]/layout.tsx`
 * with `parseEpisodeSegment`, and a segment this function skips over has
 * already been accepted or refused there.
 *
 * Pure, so it is unit-tested with segment lists rather than a router.
 */
export const railSectionFromSegments = (segments: readonly string[]): RailSection | null => {
  const path = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
  const head = path[0]
  if (head === undefined) return 'writing'
  if (isProjectRoute(head)) return head
  // `production` is both a reserved name and an episode route, so the route
  // check comes first: in a collapsed URL it sits in the episode position.
  if (isEpisodeRoute(head)) return railSectionOf(head)
  if (isReservedProjectSegment(head)) return null
  const route = path[1]
  if (route === undefined) return 'writing'
  return isEpisodeRoute(route) ? railSectionOf(route) : null
}

/**
 * The episode slug in the current URL, if the URL has one. Same folding as
 * above; `null` for a collapsed workspace or a project route.
 */
export const episodeSegmentFromSegments = (segments: readonly string[]): string | null => {
  const path = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
  const head = path[0]
  if (head === undefined) return null
  if (isProjectRoute(head) || isReservedProjectSegment(head) || isEpisodeRoute(head)) return null
  return head
}
