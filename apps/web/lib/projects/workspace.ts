import type { EpisodeSlug, Project } from '@folio/contracts'

import type { EpisodeRoutePath } from '../workspace/hrefs'
import { episodeRouteHref } from '../workspace/hrefs'

/**
 * Where a project opens.
 *
 * ## The film / series special case lives in the router and nowhere else
 *
 * AGENTS.md, Routing: "`projectType: 'film'` **hides** the episode segment. The
 * database still stores one episode row. The router special-cases the shape;
 * the schema never does." The special case is `lib/workspace/hrefs.ts`'s
 * `WorkspaceShape`; this function maps the project row onto it once. The
 * design README gives the two shapes:
 *
 *   series   /app/project/:projectId/:episodeId/script
 *   film     /app/project/:projectId/script      "routes collapse to /project/{uuid}/script"
 *
 * Both are built from the same episode row - a film's one episode is still
 * fetched, and its slug is simply not written into the path. Nothing upstream
 * of this function knows the difference.
 *
 * ## The `asRoute` that used to be here is gone
 *
 * The previous phase cast these strings because the workspace did not exist
 * and `typedRoutes` could not know the paths. It does now, so the href is the
 * template type `hrefs.ts` returns and the checker verifies it against a page
 * that is actually there.
 *
 * ## Filmmaking goes to its list, not to `script`
 *
 * AGENTS.md open decision 9: `/app/filmmaking` "is a project list and a
 * creation entry point. Stop there. It needs an ADR first." Which route a
 * filmmaking project lands on - whether it even has a `script` route - is the
 * substance of that ADR, so this function does not guess it. A filmmaking
 * project opens on the list it was created from, where its card is. When the
 * ADR lands, this is the branch it changes. (The workspace layout enforces the
 * same thing from the other side: a filmmaking project's URL redirects back.)
 */
export const workspaceHref = (
  project: Pick<Project, 'id' | 'kind' | 'projectType'>,
  episode: EpisodeSlug,
): EpisodeRoutePath | '/app/filmmaking' => {
  if (project.kind === 'filmmaking') return '/app/filmmaking'
  return episodeRouteHref(
    {
      projectId: project.id,
      shape: project.projectType === 'film' ? 'collapsed' : 'episodic',
      episode,
    },
    'script',
  )
}
