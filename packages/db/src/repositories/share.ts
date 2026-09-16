import type { ProjectId, ShareLink, ShareLinkRole, UserId } from '@folio/contracts'
import { projectId as brandProjectId, shareLinkId } from '@folio/contracts'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { shareLinks } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp, stampOrNull } from './mapping'

/**
 * Share links. See `schema/share.ts` for what one is.
 *
 * Two of the three reads are scoped, as every repository's are. The third -
 * `readShareLinkByToken` - is not: the accept route holds a token and nothing
 * else, and has to find the project from it. It takes the raw database
 * handle, the way `readMembershipFor` does, and it is the only function here
 * that may. What it returns is then run through the membership gate by the
 * caller before anything is written.
 */

type ShareLinkRow = typeof shareLinks.$inferSelect

const toShareLink = (row: ShareLinkRow): ShareLink => ({
  id: shareLinkId(row.id),
  projectId: brandProjectId(row.projectId),
  token: row.token,
  role: row.role,
  createdBy: row.createdBy as UserId,
  createdAt: stamp(row.createdAt),
  revokedAt: stampOrNull(row.revokedAt),
})

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/** 32 characters over a 64-symbol alphabet: 192 bits, from the platform CSPRNG. */
const mintToken = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += TOKEN_ALPHABET[byte & 63] ?? '_'
  return out
}

/** The project's live link, if it has one. */
export const readShareLink = async (scope: ProjectScope): Promise<ShareLink | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(shareLinks)
    .where(scoped(scope, shareLinks, isNull(shareLinks.revokedAt)))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toShareLink(row)
}

/**
 * Issue a link. Revokes the live one first, in the same transaction, so a
 * project has at most one link that works - see the schema header.
 */
export const issueShareLink = async (scope: ProjectScope, role: ShareLinkRole): Promise<ShareLink> => {
  const actor = scope.actor
  if (actor === null) throw new Error('Folio: issuing a share link needs an actor.')
  return dbOf(scope).transaction(async (tx) => {
    const now = new Date()
    await tx
      .update(shareLinks)
      .set({ revokedAt: now })
      .where(scoped(scope, shareLinks, isNull(shareLinks.revokedAt)))
    const inserted = await tx
      .insert(shareLinks)
      .values({ ...tenant(scope), token: mintToken(), role, createdBy: actor })
      .returning()
    const row = inserted[0]
    if (row === undefined) throw new Error('Folio: inserting a share link returned no row.')
    return toShareLink(row)
  })
}

export const revokeShareLink = async (scope: ProjectScope): Promise<void> => {
  await dbOf(scope)
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(scoped(scope, shareLinks, isNull(shareLinks.revokedAt)))
}

/**
 * The link a token names, live or revoked. Unscoped by necessity - the
 * caller knows no project yet. Never returns another project's rows to a
 * scope: it returns one row, and the caller opens a scope for that row's
 * project only after the identity gate.
 */
export const readShareLinkByToken = async (
  db: FolioDatabase,
  token: string,
): Promise<ShareLink | null> => {
  const rows = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1)
  const row = rows[0]
  return row === undefined ? null : toShareLink(row)
}

/** Whether a live link with this token belongs to the project. A guard for the accept route's second look. */
export const isLiveShareLink = async (
  db: FolioDatabase,
  projectId: ProjectId,
  token: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: shareLinks.id })
    .from(shareLinks)
    .where(and(eq(shareLinks.projectId, projectId), eq(shareLinks.token, token), isNull(shareLinks.revokedAt)))
    .limit(1)
  return rows.length > 0
}
