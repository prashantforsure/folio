'use server'

import { ShareLinkRoleSchema } from '@folio/contracts'
import { issueShareLink as issue, revokeShareLink as revoke } from '@folio/db'

import { isRefusal, openProject } from '../script/gate'
import type { ShareLinkResult } from './result'

/**
 * The Share popover's two writes. Project-scoped: a link admits someone to
 * the project, not to an episode.
 *
 * Membership, not role, is the gate - `memberships.role` is enforced nowhere
 * (`docs/build-decisions.md`, "Open, and blocking"), and deciding here that a
 * `reader` may not invite would be the first line of a capability model
 * nobody has specified. Flagged, not solved.
 */

export const issueShareLink = async (projectId: string, role: string): Promise<ShareLinkResult> => {
  const parsedRole = ShareLinkRoleSchema.safeParse(role)
  if (!parsedRole.success) return { status: 'error', message: 'A link is for a writer or a reader.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  const link = await issue(gate.scope, parsedRole.data)
  return { status: 'issued', link }
}

export const revokeShareLink = async (projectId: string): Promise<ShareLinkResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  await revoke(gate.scope)
  return { status: 'revoked' }
}
