import type { MembershipRole } from '@folio/contracts'
import { ProjectIdSchema, userId as brandUserId } from '@folio/contracts'
import type { ProjectScope } from '@folio/db'

import { ROLE } from '../auth/roles'
import { currentIdentity } from '../auth/session'
import type { EpisodeGate, GateRefusal, ProjectGate } from './actor-gate'
import { REFUSED, openEpisodeAsWith, openProjectAs, parseGateInput } from './actor-gate'

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
 * Membership **and role**, since 2026-09-23. Every gate takes the minimum
 * role the action needs - `ROLE.read` by default, which every member holds -
 * and refuses a member whose role does not reach it with a message of its own
 * (`lib/auth/roles.ts`, ADR 0003 **D2**).
 *
 * ## The cookie half, and the actor half (roadmap task 4.2)
 *
 * This file is the **cookie** half: it verifies who is signed in and nothing
 * else. Everything after identity - parsing, the membership, project and
 * episode reads, the role - is `actor-gate.ts`'s `openEpisodeAs` /
 * `openProjectAs`, which the worker calls with the run's starter instead of a
 * cookie (ADR 0003 D4). One implementation of the checks, two ways in, so a
 * request from the browser and a job in the worker are refused identically.
 * The types, `isRefusal` and the refusals are re-exported from there, so every
 * existing import of this file still reads.
 *
 * ## The reads run at once
 *
 * Identity is verified first and alone - nothing is asked of the database
 * on behalf of someone who is not signed in. Then the membership row, the
 * project row and the episode row are read **in parallel** (`actor-gate.ts`):
 * each is one parameterised statement, each is two round trips on the request
 * path (`@folio/db`'s `client.ts`), and in sequence they were the slowest thing
 * between a keystroke and "saved".
 */

export type { EpisodeGate, GateRefusal, ProjectGate } from './actor-gate'
export { REFUSED, ROLE_REFUSAL, isRefusal, parseGateInput, roleRefusal } from './actor-gate'

const SIGNED_OUT: GateRefusal = { status: 'refused', message: 'Sign in to keep writing.' }

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
  alongside: (scope: ProjectScope) => Promise<T>,
  minimum: MembershipRole = ROLE.read,
): Promise<(EpisodeGate & { readonly extra: T }) | GateRefusal> => {
  // Parsed before identity, as it always was: a malformed segment asks nothing of anybody.
  if (parseGateInput(rawProjectId, rawEpisode) === null) return REFUSED
  const identity = await currentIdentity()
  if (identity === null) return SIGNED_OUT
  return openEpisodeAsWith(brandUserId(identity.id), rawProjectId, rawEpisode, alongside, minimum)
}

export const openEpisode = async (
  rawProjectId: unknown,
  rawEpisode: unknown,
  minimum: MembershipRole = ROLE.read,
): Promise<EpisodeGate | GateRefusal> => {
  const gate = await openEpisodeWith(rawProjectId, rawEpisode, () => Promise.resolve(undefined), minimum)
  if ('status' in gate) return gate
  const { actor, scope, project, episode, role } = gate
  return { actor, scope, project, episode, role }
}

// ---------------------------------------------------------------------------
// The project-scoped gate
// ---------------------------------------------------------------------------

/**
 * The same gate without an episode, for the project-scoped routes -
 * Characters first. Identity, then membership and the project row in one
 * round trip, then a scope. A refusal is the same message for a stranger
 * and a missing project, for the reason the episode gate gives.
 */
export const openProject = async (
  rawProjectId: unknown,
  minimum: MembershipRole = ROLE.read,
): Promise<ProjectGate | GateRefusal> => {
  // Parsed before identity, as it always was.
  if (!ProjectIdSchema.safeParse(typeof rawProjectId === 'string' ? rawProjectId : '').success) return REFUSED
  const identity = await currentIdentity()
  if (identity === null) return SIGNED_OUT
  return openProjectAs(brandUserId(identity.id), rawProjectId, minimum)
}
