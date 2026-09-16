import { SHARE_LINK_ROLES } from '@folio/contracts'
import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { createdAtColumn, idColumn, projectIdColumn, timestampColumn } from './columns'
import { projects, users } from './tenancy'

/**
 * Share links. AUTHORED.
 *
 * AGENTS.md, Constraints: "Team invites are **share links** generated in-app
 * and copied by the inviter, never sent by Folio." `memberships.invited_via`
 * has had a `share_link` value since `0000`; this table, from migration
 * `0016`, is the link that value refers to.
 *
 * `token` is the whole secret: 32 URL-safe characters minted by
 * `repositories/share.ts` from `crypto.getRandomValues`, unique across the
 * database because the accept route looks a token up without knowing the
 * project. `role` is `writer | reader` - a link never issues ownership.
 * `revoked_at` keeps the row: the accept route can then say a link was
 * revoked rather than that it never existed. One live link per project at a
 * time is a repository rule, not a constraint - issuing a new link revokes
 * the last, so a copied URL stops working the moment the inviter replaces
 * it, which is the only "un-invite" a link-based system has.
 */

export const shareLinkRoleEnum = pgEnum('share_link_role', SHARE_LINK_ROLES)

export const shareLinks = pgTable(
  'share_links',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    role: shareLinkRoleEnum('role').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
    revokedAt: timestampColumn('revoked_at'),
  },
  (table) => [
    uniqueIndex('share_links_token_key').on(table.token),
    index('share_links_project_idx').on(table.projectId),
    check('share_links_token_shape', sql`${table.token} ~ '^[A-Za-z0-9_-]{32}$'`),
  ],
)
