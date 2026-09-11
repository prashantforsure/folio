import type { Episode, Project, ProjectId } from '@folio/contracts'
import { ProjectIdSchema, parseEpisodeSegment } from '@folio/contracts'
import {
  listEpisodes,
  openProjectForRequest,
  readEpisodeBySlug,
  readMembershipFor,
  readProject,
  transactionDatabase,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

import { requireUser } from '../auth/session'
import type { ShellUser } from '../auth/session'
import type { EpisodeAddress, WorkspaceShape } from './hrefs'
import { episodeRouteHref } from './hrefs'
import { lastOpenedEpisodeCookie } from './last-episode'
import type { EpisodeRoute } from './routes'

/**
 * Who is looking at which project, and at which episode of it.
 *
 * ## The gate
 *
 * AGENTS.md, Feature workflow 7: every gate is enforced server-side. For a
 * workspace read the gates are identity and membership, in that order:
 * `requireUser()` says who is asking, `readMembershipFor()` says whether they
 * may see this project, and only then is a `ProjectScope` opened. A person who
 * is not a member gets a 404, not a 403 - the existence of somebody else's
 * project is not theirs to learn.
 *
 * ## `cache()`, because a layout cannot hand props to its page
 *
 * The rail's layout, the episode nav's layout and the page all need the same
 * project, and Next renders them in parallel with no channel between them.
 * React's per-request `cache()` makes the second and third calls memo hits on
 * the first, so one render is one membership check and one project read. The
 * cache is keyed by the raw params, which is why these take strings.
 *
 * ## The shape is decided here, once
 *
 * `shape` is `collapsed` for a film and `episodic` for a series - AGENTS.md,
 * Routing: the router hides a film's episode segment while "the database
 * still stores one episode row". Everything downstream builds URLs from
 * `shape` (see `hrefs.ts`) and nothing else reads `projectType` for a URL.
 */

export type ProjectContext = {
  readonly user: ShellUser
  readonly scope: ProjectScope<'transaction'>
  readonly project: Project
  readonly shape: WorkspaceShape
  /** Every episode, in running order. Never empty - creation writes one. */
  readonly episodes: readonly Episode[]
}

export type EpisodeContext = ProjectContext & {
  readonly episode: Episode
  readonly address: EpisodeAddress
  /** Whether the URL that reached us carried an episode segment. */
  readonly urlShape: WorkspaceShape
}

export const loadProject = cache(async (rawProjectId: string): Promise<ProjectContext> => {
  const user = await requireUser(`/app/project/${rawProjectId}`)

  const parsedId = ProjectIdSchema.safeParse(rawProjectId)
  if (!parsedId.success) notFound()
  const projectId: ProjectId = parsedId.data

  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, projectId)
  if (membership === null) notFound()

  const scope = await openProjectForRequest(projectId, user.id)
  const project = await readProject(scope)
  if (project === null) notFound()

  // AGENTS.md, Constraints: "/app/filmmaking is a project list and a creation
  // entry point. Stop there." A filmmaking project has no workspace until the
  // ADR that decides what one is; its card opens the list it lives on.
  if (project.kind === 'filmmaking') redirect('/app/filmmaking')

  const episodes = await listEpisodes(scope)
  if (episodes.length === 0) {
    throw new Error(
      `Folio: project ${projectId} has no episode row. Creation writes exactly one; this is a bug or a hand-edited database.`,
    )
  }

  return {
    user,
    scope,
    project,
    shape: project.projectType === 'film' ? 'collapsed' : 'episodic',
    episodes,
  }
})

/**
 * The episode a collapsed URL means: the last one opened, else the first.
 *
 * The brief: "`/app/project/:projectId` → `./:episodeId/script`, last opened
 * episode, else first." Last opened is a per-project cookie the episode
 * layout writes from the browser (`last-episode.ts`); it is read here, run
 * through the same validator as a URL segment, and checked against the
 * project's own episodes so a stale cookie for a deleted episode falls back
 * rather than 404s.
 */
export const rememberedOrFirstEpisode = async (context: ProjectContext): Promise<Episode> => {
  const first = context.episodes[0]
  if (first === undefined) throw new Error('Folio: a project context with no episodes.')

  const jar = await cookies()
  const remembered = jar.get(lastOpenedEpisodeCookie(context.project.id))?.value
  if (remembered === undefined) return first
  const checked = parseEpisodeSegment(remembered)
  if (!checked.ok) return first
  return context.episodes.find((episode) => episode.slug === checked.slug) ?? first
}

/**
 * Resolve the episode a URL names, or the one a collapsed URL implies.
 *
 * `segment` is the raw `[episodeId]` param, or `null` when the URL has no
 * episode position (the film shape). The validation is explicit and it runs
 * before any lookup: `parseEpisodeSegment` refuses the nine reserved names by
 * name and everything outside `ep_NNN` by shape, and either refusal is a 404.
 * Static-first precedence would also keep `characters` out of this function
 * today; AGENTS.md says not to rely on that, and this does not.
 */
export const loadEpisode = cache(
  async (rawProjectId: string, segment: string | null): Promise<EpisodeContext> => {
    const context = await loadProject(rawProjectId)

    let episode: Episode
    if (segment === null) {
      episode = await rememberedOrFirstEpisode(context)
    } else {
      const checked = parseEpisodeSegment(segment)
      if (!checked.ok) notFound()
      const found = await readEpisodeBySlug(context.scope, checked.slug)
      if (found === null) notFound()
      episode = found
    }

    return {
      ...context,
      episode,
      address: { projectId: context.project.id, shape: context.shape, episode: episode.slug },
      urlShape: segment === null ? 'collapsed' : 'episodic',
    }
  },
)

/**
 * What an episode page calls first.
 *
 * Loads the context and then makes the URL canonical for the project's
 * shape: a film reached through `/:episodeId/script` goes to `/script`, and a
 * series reached through `/script` goes to `/:episodeId/script` with the
 * remembered-or-first episode. The page knows its own route name, which is
 * why this lives at the page and not in a layout - a layout cannot see which
 * child it is rendering.
 */
export const enterEpisodeRoute = async (
  rawProjectId: string,
  segment: string | null,
  route: EpisodeRoute,
): Promise<EpisodeContext> => {
  const context = await loadEpisode(rawProjectId, segment)
  if (context.urlShape !== context.shape) redirect(episodeRouteHref(context.address, route))
  return context
}
