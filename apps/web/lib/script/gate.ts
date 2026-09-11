import type { Episode, Project, ProjectId, UserId } from '@folio/contracts'
import { ProjectIdSchema, parseEpisodeSegment, userId as brandUserId } from '@folio/contracts'
import {
  openProjectForRequest,
  readEpisodeBySlug,
  readMembershipFor,
  readProject,
  transactionDatabase,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'

import { currentIdentity } from '../auth/session'

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
 *
 * ## The three reads run at once
 *
 * Identity is verified first and alone - nothing is asked of the database
 * on behalf of someone who is not signed in. Then the membership row, the
 * project row and the episode row are read **in parallel**: each is one
 * parameterised statement, each is two round trips on the request path
 * (`@folio/db`'s `client.ts`), and in sequence they were the slowest thing
 * between a keystroke and "saved". The membership answer is still checked
 * before the other two are looked at, and a non-member gets `REFUSED`
 * exactly as before - the project and episode rows they were read
 * alongside are dropped unread. The scope machinery guarantees those reads
 * could not have crossed projects; the gate guarantees nobody acts on them.
 *
 * The profile row (`shellUserFrom`) is no longer read here. No action needs
 * a display name; they need the actor's id, which the verified identity
 * carries and the scope records.
 */

export type EpisodeGate = {
  readonly actor: UserId
  readonly scope: ProjectScope<'transaction'>
  readonly project: Project
  readonly episode: Episode
}

export type GateRefusal = { readonly status: 'refused'; readonly message: string }

export const REFUSED: GateRefusal = {
  status: 'refused',
  message: 'That script could not be found.',
}

/** `null` when the two segments do not even parse. Nothing has been read. */
export const parseGateInput = (
  rawProjectId: unknown,
  rawEpisode: unknown,
): { readonly projectId: ProjectId; readonly slug: Episode['slug'] } | null => {
  const parsedId = ProjectIdSchema.safeParse(typeof rawProjectId === 'string' ? rawProjectId : '')
  if (!parsedId.success) return null
  const segment = parseEpisodeSegment(typeof rawEpisode === 'string' ? rawEpisode : '')
  if (!segment.ok) return null
  return { projectId: parsedId.data, slug: segment.slug }
}

/**
 * Open the gate, and read whatever else the caller needs through the same
 * scope **in the same round trip**.
 *
 * `alongside` receives the scope before membership is known and returns the
 * extra reads as a promise; the gate awaits it together with its own three
 * rows. On refusal the extra result is discarded with the rest. A save uses
 * this to read the document, its rows and the mention labels beside the
 * gate rather than after it.
 */
export const openEpisodeWith = async <T>(
  rawProjectId: unknown,
  rawEpisode: unknown,
  alongside: (scope: ProjectScope<'transaction'>) => Promise<T>,
): Promise<(EpisodeGate & { readonly extra: T }) | GateRefusal> => {
  const input = parseGateInput(rawProjectId, rawEpisode)
  if (input === null) return REFUSED

  const identity = await currentIdentity()
  if (identity === null) return { status: 'refused', message: 'Sign in to keep writing.' }
  const actor = brandUserId(identity.id)

  const db = await transactionDatabase()
  const scope = await openProjectForRequest(input.projectId, actor)
  const [membership, project, episode, extra] = await Promise.all([
    readMembershipFor(db, actor, input.projectId),
    readProject(scope),
    readEpisodeBySlug(scope, input.slug),
    alongside(scope),
  ])
  if (membership === null) return REFUSED
  if (project === null || project.kind !== 'screenwriting') return REFUSED
  if (episode === null) return REFUSED

  return { actor, scope, project, episode, extra }
}

export const openEpisode = async (
  rawProjectId: unknown,
  rawEpisode: unknown,
): Promise<EpisodeGate | GateRefusal> => {
  const gate = await openEpisodeWith(rawProjectId, rawEpisode, () => Promise.resolve(undefined))
  if (isRefusal(gate)) return gate
  const { actor, scope, project, episode } = gate
  return { actor, scope, project, episode }
}

export const isRefusal = <T extends EpisodeGate>(value: T | GateRefusal): value is GateRefusal =>
  'status' in value
