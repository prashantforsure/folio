'use server'

import { ShareLinkRoleSchema } from '@folio/contracts'
import { issueShareLink as issue, revokeShareLink as revoke } from '@folio/db'

import { isRefusal, openProject } from '../script/gate'
import type { ShareLinkResult } from './result'

/**
 * The Share popover's two writes. Project-scoped: a link admits someone to
 * the project, not to an episode.
 *
 * Membership, not role, is still the gate for everything else - full
 * enforcement of `memberships.role` is open decision 16, not this file's to
 * resolve. But a share link is how a role is *granted*, and a `reader` who
 * could mint a `writer` link (or revoke the project's own) would turn "no
 * enforcement yet" into an open escalation loop rather than a gap (defect
 * 0.5). That one path is closed here: issuing or revoking a link needs
 * `owner` or `writer`.
 */

const READER = { status: 'refused', message: 'Only a writer or the owner can manage share links.' } as const

export const issueShareLink = async (projectId: string, role: string): Promise<ShareLinkResult> => {
  const parsedRole = ShareLinkRoleSchema.safeParse(role)
  if (!parsedRole.success) return { status: 'error', message: 'A link is for a writer or a reader.' }
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  if (gate.role === 'reader') return READER
  const link = await issue(gate.scope, parsedRole.data)
  return { status: 'issued', link }
}

export const revokeShareLink = async (projectId: string): Promise<ShareLinkResult> => {
  const gate = await openProject(projectId)
  if (isRefusal(gate)) return gate
  if (gate.role === 'reader') return READER
  await revoke(gate.scope)
  return { status: 'revoked' }
}
