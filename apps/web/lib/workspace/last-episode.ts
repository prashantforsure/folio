import type { EpisodeSlug, ProjectId } from '@folio/contracts'

/**
 * "Last opened episode, else first." Where "last opened" lives.
 *
 * ## A cookie, per project, written by the browser
 *
 * The redirect from `/app/project/:projectId` happens on the server, so the
 * value has to reach the server with the request; localStorage does not.
 * There is no table for it either - it is per person per project, which is
 * neither a project row nor a user row, and a migration is a question
 * (AGENTS.md, When to ask first). AGENTS.md's exception table puts per-user,
 * per-session things in "localStorage or session state", and a cookie the
 * browser writes is the session-state answer that also survives the trip
 * back to the server.
 *
 * One cookie per project, path-scoped to that project's URL, so the browser
 * sends only the one that matters and the cookie header does not grow with
 * the number of projects a person has opened. The value is an `ep_NNN` slug,
 * and the server runs it through `parseEpisodeSegment` before trusting it -
 * a cookie is user input.
 *
 * Not `httpOnly`, because the browser is the writer. Not `secure` in
 * development; `SameSite=Lax` always. It carries nothing sensitive - which
 * episode of your own project you looked at last.
 *
 * Flagged in the phase report as the one place this phase invented a home
 * for state, because the brief specified the behaviour and nothing specified
 * the storage.
 */

const PREFIX = 'folio.episode.'

/** A year. Long enough that "last opened" means what it says. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const lastOpenedEpisodeCookie = (projectId: ProjectId): string => `${PREFIX}${projectId}`

/** The `Set-Cookie`-shaped string the client writes to `document.cookie`. */
export const lastOpenedEpisodeCookieValue = (projectId: ProjectId, slug: EpisodeSlug): string =>
  `${lastOpenedEpisodeCookie(projectId)}=${slug}; Path=/app/project/${projectId}; Max-Age=${String(MAX_AGE_SECONDS)}; SameSite=Lax`
