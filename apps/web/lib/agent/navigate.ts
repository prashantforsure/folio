import type { NavigateTarget } from '@folio/contracts'

import {
  characterHref,
  episodeRouteHref,
  locationHref,
  projectHref,
  projectRouteHref,
  propHref,
  researchSourceHref,
  sceneHref,
} from '../workspace/hrefs'

/**
 * A `navigate` event's target as a URL - roadmap task 2.5.
 *
 * Built with `lib/workspace/hrefs.ts` and nothing else: integration plan, *The
 * side panel* 5, "URLs are never concatenated by hand". The server resolved the
 * shape and the episode before it sent the target (`tools/core.ts`, the
 * `navigate` tool, following `enterEpisodeRoute`'s rules - it cannot run here,
 * it is a server function), so this is a lookup, not a decision. Pure, and
 * safe in the browser; the panel calls it and hands the result to
 * `router.push`.
 */
export const hrefOfTarget = (target: NavigateTarget): string => {
  switch (target.kind) {
    case 'project':
      return projectHref(target.projectId)
    case 'route':
      return projectRouteHref(target.projectId, target.route)
    case 'episode': {
      const address = { projectId: target.projectId, shape: target.shape, episode: target.episode }
      return target.route === 'script' && target.sceneNodeId !== undefined ? sceneHref(address, target.sceneNodeId) : episodeRouteHref(address, target.route)
    }
    case 'record':
      switch (target.entity) {
        case 'character':
          return characterHref(target.projectId, target.id)
        case 'location':
          return locationHref(target.projectId, target.id)
        case 'prop':
          return propHref(target.projectId, target.id)
        case 'research':
          return researchSourceHref(target.projectId, target.id)
      }
  }
}
