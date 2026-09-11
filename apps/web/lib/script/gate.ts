import type { Episode, Project, ProjectId } from '@folio/contracts'
import { ProjectIdSchema, parseEpisodeSegment } from '@folio/contracts'
import {
  openProjectForRequest,
  readEpisodeBySlug,
  readMembershipFor,
  readProject,
  transactionDatabase,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'

import { currentIdentity, shellUserFrom } from '../auth/session'
import type { ShellUser } from '../auth/session'

/**
 * The gate every Script server action runs before it touches a row.
 *
 * AGENTS.md, Development philosophy 5 and Feature workflow 7: identity, then
 * membership, then a scope. The same order as `lib/workspace/context.ts`,
 * without the `notFound()` / `redirect()` it uses - a server action returns
 * a discriminated result, never a throw across the boundary, so a caller who
 * is not signed in or not a member gets a `refused` value and the same
 * message for both. The existence of somebody else's project is not theirs
 * to learn.
 *
 * Membership, not role. `memberships.role` is stored and enforced nowhere
 * (`docs/build-decisions.md`); deciding here that a `reader` may not write a
 * script would be the first line of a capability model nobody has specified.
 * Flagged in the phase report, not solved in a commit.
 */

export type EpisodeGate = {
  readonly user: ShellUser
  readonly scope: ProjectScope<'transaction'>
  readonly project: Project
  readonly episode: Episode
}

export type GateRefusal = { readonly status: 'refused'; readonly message: string }

export const REFUSED: GateRefusal = {
  status: 'refused',
  message: 'That script could not be found.',
}

export const openEpisode = async (
  rawProjectId: unknown,
  rawEpisode: unknown,
): Promise<EpisodeGate | GateRefusal> => {
  const parsedId = ProjectIdSchema.safeParse(typeof rawProjectId === 'string' ? rawProjectId : '')
  if (!parsedId.success) return REFUSED
  const projectId: ProjectId = parsedId.data
  const segment = parseEpisodeSegment(typeof rawEpisode === 'string' ? rawEpisode : '')
  if (!segment.ok) return REFUSED

  const identity = await currentIdentity()
  if (identity === null) return { status: 'refused', message: 'Sign in to keep writing.' }
  const user = await shellUserFrom(identity)

  const db = await transactionDatabase()
  const membership = await readMembershipFor(db, user.id, projectId)
  if (membership === null) return REFUSED

  const scope = await openProjectForRequest(projectId, user.id)
  const project = await readProject(scope)
  if (project === null || project.kind !== 'screenwriting') return REFUSED
  const episode = await readEpisodeBySlug(scope, segment.slug)
  if (episode === null) return REFUSED

  return { user, scope, project, episode }
}

export const isRefusal = (value: EpisodeGate | GateRefusal): value is GateRefusal =>
  'status' in value
