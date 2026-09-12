import type { EpisodeSlug, ProjectId } from '@folio/contracts'

import type { EpisodeRoute, ProjectRoute } from './routes'

/**
 * Every workspace URL is written here and nowhere else.
 *
 * ## The film / series special case, in the router and only in the router
 *
 * AGENTS.md, Routing: "`projectType: 'film'` **hides** the episode segment.
 * The database still stores one episode row. The router special-cases the
 * shape; the schema never does." `WorkspaceShape` is that special case as a
 * type: a `collapsed` workspace writes no episode into the path, an
 * `episodic` one always does. Every caller passes the shape it was given by
 * `context.ts`, which derives it from `project.projectType` once. Nothing
 * else in the app branches on the project type to build a URL.
 *
 *   episodic   /app/project/:projectId/:episodeId/script
 *   collapsed  /app/project/:projectId/script
 *
 * ## Why these return template literal types and not `Route`
 *
 * With `typedRoutes`, `Route` on its own is the static routes only; a dynamic
 * route is `Route<T>` for the specific template `T`, and `<Link>` and
 * `redirect()` infer `T` from what they are given. So each builder returns
 * its exact template type and the checker matches it against the generated
 * union at the call site. A page that does not exist is then a type error at
 * `href=`, not a 404 in production - and the one `as Route` this app allows
 * (`lib/routes.ts`) is not needed for any workspace URL.
 */

export type WorkspaceShape = 'episodic' | 'collapsed'

export type EpisodeAddress = {
  readonly projectId: ProjectId
  readonly shape: WorkspaceShape
  readonly episode: EpisodeSlug
}

type ProjectPath = `/app/project/${string}`
export type ProjectRoutePath = `${ProjectPath}/${ProjectRoute}`
export type CharacterPath = `${ProjectPath}/characters/${string}`
export type LocationPath = `${ProjectPath}/locations/${string}`
export type BibleEntryPath = `${ProjectPath}/bible/${string}`
type CollapsedEpisodePath = `${ProjectPath}/${EpisodeRoute}`
type EpisodicEpisodePath = `${ProjectPath}/${string}/${EpisodeRoute}`

export type EpisodeRoutePath = CollapsedEpisodePath | EpisodicEpisodePath

export const projectHref = (projectId: ProjectId): ProjectPath => `/app/project/${projectId}`

export const projectRouteHref = (projectId: ProjectId, route: ProjectRoute): ProjectRoutePath =>
  `/app/project/${projectId}/${route}`

export const projectSettingsHref = (projectId: ProjectId): `${ProjectPath}/settings` =>
  `/app/project/${projectId}/settings`

/**
 * One character's profile: `/characters/:characterId`, the route the spec
 * writes beside `/characters`. The id is the record's UUID - a character is
 * "a stable UUID with a name attribute" - so the URL survives every rename
 * and there is no slug to mint or to go stale.
 */
export const characterHref = (projectId: ProjectId, characterId: string): CharacterPath =>
  `/app/project/${projectId}/characters/${characterId}`

/** The episode's index; it redirects to `./script`. Episodic shape only. */
export const episodeHref = (
  projectId: ProjectId,
  episode: EpisodeSlug,
): `${ProjectPath}/${string}` => `/app/project/${projectId}/${episode}`

export const episodeRouteHref = (address: EpisodeAddress, route: EpisodeRoute): EpisodeRoutePath =>
  address.shape === 'collapsed'
    ? `/app/project/${address.projectId}/${route}`
    : `/app/project/${address.projectId}/${address.episode}/${route}`

/**
 * One location's record: `/locations/:locationId`, as the spec writes it
 * beside `/locations`. The record's UUID, for the reason `characterHref`
 * gives - the same identity model, so the same URL shape.
 */
export const locationHref = (projectId: ProjectId, locationId: string): LocationPath =>
  `/app/project/${projectId}/locations/${locationId}`

/**
 * One bible entry: `/bible/:entryId`, as the spec writes it beside `/bible`.
 * The entry's UUID - an entry is authored, retitled freely, and its cites
 * and conflicts point at it by id - so the URL survives every retitle and
 * there is no slug to mint or to go stale.
 */
export const bibleEntryHref = (projectId: ProjectId, entryId: string): BibleEntryPath =>
  `/app/project/${projectId}/bible/${entryId}`
