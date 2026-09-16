import { z } from 'zod'

import { ProjectIdSchema, ShareLinkIdSchema, UserIdSchema } from './ids'
import { TimestampSchema } from './primitives'

/**
 * Share links - the invite this product has.
 *
 * AGENTS.md, Constraints: there is no transactional email provider, so "Team
 * invites are **share links** generated in-app and copied by the inviter,
 * never sent by Folio." `memberships.invited_via = 'share_link'` has recorded
 * the outcome since the schema phase; this is the link itself, built with the
 * v2 redesign's `Share` button (2026-09-16).
 *
 * ## One token, one role, revocable
 *
 * A link grants the role it was issued with to whoever opens it while signed
 * in. `writer` and `reader` only: an owner is the person who created the
 * project, and ownership is not something a link hands out. Revoking sets
 * `revokedAt`; the row stays so an opened-after-revocation attempt can say
 * "this link was revoked" rather than "not found". Nothing here is a
 * capability model - `memberships.role` is still enforced nowhere
 * (`docs/build-decisions.md`, "Open, and blocking") - it is the role the
 * membership row will carry when that model arrives.
 *
 * The token is the URL. 32 URL-safe characters from a CSPRNG (`share.ts` in
 * `@folio/db` mints it); the schema only checks the shape so a mistyped URL
 * fails before a query.
 */

export const SHARE_LINK_ROLES = ['writer', 'reader'] as const

export type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number]

export const ShareLinkRoleSchema = z.enum(SHARE_LINK_ROLES)

export const ShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/)

export const ShareLinkSchema = z.object({
  id: ShareLinkIdSchema,
  projectId: ProjectIdSchema,
  token: ShareTokenSchema,
  role: ShareLinkRoleSchema,
  createdBy: UserIdSchema,
  createdAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
})

export type ShareLink = z.infer<typeof ShareLinkSchema>
