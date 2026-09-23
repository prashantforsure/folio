import type { Episode, MembershipRole, PoolerMode, Project, ProjectId, UserId } from '@folio/contracts'
import { ProjectIdSchema, parseEpisodeSegment } from '@folio/contracts'
import {
  openProjectForRequest,
  openProjectForWorker,
  readEpisodeBySlug,
  readMembershipFor,
  readProject,
  sessionDatabase,
  transactionDatabase,
} from '@folio/db'
import type { ProjectScope } from '@folio/db'

import { ROLE, ROLE_REFUSED, meetsRole } from '../auth/roles'

/**
 * The gates, as a known person - roadmap task 4.2, ADR 0003 **D4**.
 *
 * `openProjectAs` and `openEpisodeAs` do everything the cookie gates in
 * `gate.ts` do **after** identity: parse the segments, read the membership, the
 * project and the episode in one round trip, refuse a stranger and a missing
 * project with the same words, and refuse a member whose role does not reach
 * the minimum with words of its own. They take the actor instead of reading a
 * cookie, so the worker can run a job as the person who started it; the cookie
 * gates resolve the identity and then call these, so there is one
 * implementation of the checks and the browser and the worker are refused
 * identically.
 *
 * **Nothing here reads a cookie or imports Next.** That is the point of the
 * file, and `tests/worker-import-graph.test.ts` holds the worker's import graph
 * to it. Everything a core function or a tool needs from a gate - the types,
 * `isRefusal`, the refusals - lives here, and `gate.ts` re-exports it.
 *
 * `pooler` picks the connection: `'transaction'` for a web request (the
 * default), `'session'` for the worker (`openProjectForWorker`).
 */

export type EpisodeGate = {
  readonly actor: UserId
  readonly scope: ProjectScope
  readonly project: Project
  readonly episode: Episode
  /**
   * The caller's own role, for an action whose refusal depends on more than
   * the gate could know - and for the tool registry, which needs the role it
   * is acting under without re-reading the membership row.
   */
  readonly role: MembershipRole
}

/**
 * The same without an episode, for the project-scoped routes. Characters
 * first; `issueShareLink` refuses further on the role it carries.
 */
export type ProjectGate = {
  readonly actor: UserId
  readonly scope: ProjectScope
  readonly project: Project
  readonly role: MembershipRole
}

export type GateRefusal = { readonly status: 'refused'; readonly message: string }

export const REFUSED: GateRefusal = {
  status: 'refused',
  message: 'That script could not be found.',
}

/** A member whose role does not reach what the action asked for. */
export const ROLE_REFUSAL: GateRefusal = { status: 'refused', message: ROLE_REFUSED }

export const isRefusal = <T extends EpisodeGate | ProjectGate>(value: T | GateRefusal): value is GateRefusal =>
  'status' in value

/**
 * A core function's own role check (roadmap task 4.2). The cookie gate a
 * thin action opens already asked for this role; a tool's gate asked only for
 * the turn's (`ROLE.assistant`), so the core asks again - the same `meetsRole`
 * on the same D2 table, and the same words.
 */
export const roleRefusal = (gate: { readonly role: MembershipRole }, minimum: MembershipRole): GateRefusal | null =>
  meetsRole(gate.role, minimum) ? null : ROLE_REFUSAL

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

const openScope = (pooler: PoolerMode, projectId: ProjectId, actor: UserId): Promise<ProjectScope> =>
  pooler === 'session' ? openProjectForWorker(projectId, actor) : openProjectForRequest(projectId, actor)

const membershipDatabase = (pooler: PoolerMode) => (pooler === 'session' ? sessionDatabase() : transactionDatabase())

/**
 * The episode gate as a known person, reading whatever else the caller needs
 * through the same scope **in the same round trip** - the membership, the
 * project, the episode and `alongside` run together, and the membership answer
 * is checked before the others are looked at.
 */
export const openEpisodeAsWith = async <T>(
  actor: UserId,
  rawProjectId: unknown,
  rawEpisode: unknown,
  alongside: (scope: ProjectScope) => Promise<T>,
  minimum: MembershipRole = ROLE.read,
  pooler: PoolerMode = 'transaction',
): Promise<(EpisodeGate & { readonly extra: T }) | GateRefusal> => {
  const input = parseGateInput(rawProjectId, rawEpisode)
  if (input === null) return REFUSED

  const db = await membershipDatabase(pooler)
  const scope = await openScope(pooler, input.projectId, actor)
  const [membership, project, episode, extra] = await Promise.all([
    readMembershipFor(db, actor, input.projectId),
    readProject(scope),
    readEpisodeBySlug(scope, input.slug),
    alongside(scope),
  ])
  if (membership === null) return REFUSED
  if (project === null || project.kind !== 'screenwriting') return REFUSED
  if (episode === null) return REFUSED
  // Role last: a stranger learns nothing about the project, and a member is
  // told the truth about their own role rather than that the script is gone.
  if (!meetsRole(membership.role, minimum)) return ROLE_REFUSAL

  return { actor, scope, project, episode, role: membership.role, extra }
}

export const openEpisodeAs = async (
  actor: UserId,
  rawProjectId: unknown,
  rawEpisode: unknown,
  minimum: MembershipRole = ROLE.read,
  pooler: PoolerMode = 'transaction',
): Promise<EpisodeGate | GateRefusal> => {
  const gate = await openEpisodeAsWith(actor, rawProjectId, rawEpisode, () => Promise.resolve(undefined), minimum, pooler)
  if (isRefusal(gate)) return gate
  const { scope, project, episode, role } = gate
  return { actor, scope, project, episode, role }
}

export const openProjectAs = async (
  actor: UserId,
  rawProjectId: unknown,
  minimum: MembershipRole = ROLE.read,
  pooler: PoolerMode = 'transaction',
): Promise<ProjectGate | GateRefusal> => {
  const parsedId = ProjectIdSchema.safeParse(typeof rawProjectId === 'string' ? rawProjectId : '')
  if (!parsedId.success) return REFUSED

  const db = await membershipDatabase(pooler)
  const scope = await openScope(pooler, parsedId.data, actor)
  const [membership, project] = await Promise.all([readMembershipFor(db, actor, parsedId.data), readProject(scope)])
  if (membership === null) return REFUSED
  if (project === null || project.kind !== 'screenwriting') return REFUSED
  if (!meetsRole(membership.role, minimum)) return ROLE_REFUSAL
  return { actor, scope, project, role: membership.role }
}

/**
 * Is the gate's person still a member of its project? One statement, and the
 * gate's own words (`REFUSED`) when they are not - a member removed while a
 * turn runs learns nothing more than a stranger would. The tool registry asks
 * this before a step's tools run (`runTool`), which is what the wrapped
 * actions' cookie gates did for them before the tools called core functions
 * (roadmap task 4.2).
 */
export const stillMember = async (gate: ProjectGate): Promise<GateRefusal | null> => {
  const db = await membershipDatabase(gate.scope.pooler === 'session' ? 'session' : 'transaction')
  const membership = await readMembershipFor(db, gate.actor, gate.project.id)
  return membership === null ? REFUSED : null
}

/**
 * Narrow a gate already opened to one of its project's episodes, by slug -
 * for a tool whose operation names an episode other than the one the turn is
 * on. The membership and the role were checked when `gate` was opened; this
 * reads the episode row, and refuses a slug that is not this project's with the
 * gate's own words.
 */
export const episodeGateOf = async (gate: ProjectGate, rawEpisode: unknown): Promise<EpisodeGate | GateRefusal> => {
  const segment = parseEpisodeSegment(typeof rawEpisode === 'string' ? rawEpisode : '')
  if (!segment.ok) return REFUSED
  const episode = await readEpisodeBySlug(gate.scope, segment.slug)
  if (episode === null) return REFUSED
  return { actor: gate.actor, scope: gate.scope, project: gate.project, episode, role: gate.role }
}
