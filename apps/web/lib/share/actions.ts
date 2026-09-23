'use server'

import { ShareLinkRoleSchema } from '@folio/contracts'
import { issueShareLink as issue, revokeShareLink as revoke } from '@folio/db'

import { ROLE } from '../auth/roles'
import { isRefusal, openProject } from '../script/gate'
import type { ShareLinkResult } from './result'

/**
 * The Share popover's two writes. Project-scoped: a link admits someone to
 * the project, not to an episode.
 *
 * This was the first role check in the repository, written by hand when
 * `memberships.role` was enforced nowhere else: a `reader` who could mint a
 * `writer` link (or revoke the project's own) would have turned "no
 * enforcement yet" into an open escalation loop rather than a gap (defect
 * 0.5). ADR 0003 **D2** ratified exactly that shape - share links are a
 * writer's - so the hand-written check is now the gate's, `ROLE.shareLink`,
 * and the bespoke refusal it carried is the one every other gate gives.
 */

export const issueShareLink = async (projectId: string, role: string): Promise<ShareLinkResult> => {
  const parsedRole = ShareLinkRoleSchema.safeParse(role)
  if (!parsedRole.success) return { status: 'error', message: 'A link is for a writer or a reader.' }
  const gate = await openProject(projectId, ROLE.shareLink)
  if (isRefusal(gate)) return gate
  const link = await issue(gate.scope, parsedRole.data)
  return { status: 'issued', link }
}

export const revokeShareLink = async (projectId: string): Promise<ShareLinkResult> => {
  const gate = await openProject(projectId, ROLE.shareLink)
  if (isRefusal(gate)) return gate
  await revoke(gate.scope)
  return { status: 'revoked' }
}
