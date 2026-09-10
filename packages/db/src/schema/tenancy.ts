import { LEDGER_ENTRY_KINDS, MEMBERSHIP_ROLES, PROJECT_KINDS } from '@folio/contracts'
import { REVISION_COLOURS } from '@folio/script'
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  createdAtColumn,
  idColumn,
  projectIdColumn,
  timestampColumn,
  updatedAtColumn,
} from './columns'

/**
 * Users, memberships, projects, episodes - and the enums the whole schema uses.
 *
 * The enums are declared here rather than in a file of their own because
 * Postgres enum types are schema objects with a creation order, and keeping
 * them beside the first table that uses one makes that order visible in the
 * generated migration.
 *
 * **Every enum is built from a tuple that already exists** - in
 * `@folio/contracts` for boundary vocabulary, in `@folio/script` for the pure
 * core's closed sets. `pgEnum('revision_colour', ['white', 'blue', ...])`
 * written out by hand would be a second declaration of a set AGENTS.md calls
 * closed, and the two would drift on the first change.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const projectKindEnum = pgEnum('project_kind', PROJECT_KINDS)
export const membershipRoleEnum = pgEnum('membership_role', MEMBERSHIP_ROLES)
export const invitedViaEnum = pgEnum('invited_via', ['created', 'share_link'])
export const revisionColourEnum = pgEnum('revision_colour', REVISION_COLOURS)
export const ledgerEntryKindEnum = pgEnum('ledger_entry_kind', LEDGER_ENTRY_KINDS)

// ---------------------------------------------------------------------------
// users - the one table with no project_id
// ---------------------------------------------------------------------------

/**
 * Our half of a person. AUTHORED.
 *
 * AGENTS.md, Tech stack: "`auth.users` is identity; `users`/`memberships` are
 * ours." `id` **is** the `auth.users` id - one person, one id, no join between
 * two identity tables to find a display name. There is no foreign key to
 * `auth.users` in the generated migration: that table lives in another schema
 * owned by Supabase, and a cross-schema FK to it turns every auth change into a
 * migration problem. The link is maintained by a trigger on signup instead,
 * which is written in `0001_rls_and_grants.sql`.
 *
 * **This is the one table without `project_id`,** and the exception is
 * structural rather than an oversight - see `projectIdColumn` in `columns.ts`.
 * Because it has no such column it is not assignable to `ProjectScopedTable`,
 * so it cannot be passed to a scoped query at all: the exception is enforced by
 * the type system rather than by remembering.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

/**
 * A project. AUTHORED.
 *
 * `projects.id` **is** the `project_id` every other table carries, so the
 * tenancy rule holds here by identity rather than by a self-referencing column.
 *
 * Note what is absent: no `page_count`, no `scene_count`, no `episode_count`.
 * The design README requires project cards to show "real derived metadata ...
 * never a placeholder string", and a count column here is the fastest way to
 * make that card lie. Page counts are a function of the node list and the sheet
 * format, so AGENTS.md's exception table puts them on a measurement record. The
 * card reads a measurement; this row does not carry one.
 *
 * `trashed_at` is soft delete. AGENTS.md, When to ask first: deleting user data
 * needs a question, so nothing here hard-deletes.
 */
export const projects = pgTable(
  'projects',
  {
    id: idColumn(),
    title: text('title').notNull(),
    kind: projectKindEnum('kind').notNull(),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    trashedAt: timestampColumn('trashed_at'),
  },
  (table) => [index('projects_created_by_idx').on(table.createdBy)],
)

// ---------------------------------------------------------------------------
// memberships
// ---------------------------------------------------------------------------

/**
 * One person's place in one project. AUTHORED.
 *
 * The unique index on `(project_id, user_id)` is what makes membership a set
 * rather than a log: two rows for the same pair would mean two roles and no
 * rule for which wins. It is also what every RLS policy in the schema joins
 * against, so it has to be exactly one row.
 *
 * `invited_via` records AGENTS.md, Constraints: there is no email provider, so
 * "Team invites are **share links** generated in-app and copied by the
 * inviter." A membership therefore begins either by creation or by a link.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    invitedVia: invitedViaEnum('invited_via').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('memberships_project_user_key').on(table.projectId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
)

// ---------------------------------------------------------------------------
// episodes
// ---------------------------------------------------------------------------

/**
 * An episode. AUTHORED.
 *
 * **A film has exactly one row here.** AGENTS.md, Routing: "`projectType:
 * 'film'` **hides** the episode segment. The database still stores one episode
 * row. The router special-cases the shape; the schema never does." Nothing in
 * this table knows the project's kind, deliberately - the moment an episode is
 * optional, every episode-scoped join grows a null branch and the film case
 * becomes a second code path that nobody tests.
 *
 * `id` is an opaque UUID and `slug` is `ep_NNN`. That separation is
 * `docs/adr/0002-episode-identity.md`, and it is the third delegated ruling in
 * this repository rather than a considered product decision: `ep_007` visibly
 * encodes an ordinal, an ordinal moves when an episode is reordered or deleted,
 * and an identifier that changes is not an identifier. It is cheap to reverse
 * today and expensive once rows exist.
 *
 * The two unique indexes say the rest: a slug is unique within a project and so
 * is an ordinal, and neither is unique across projects.
 */
export const episodes = pgTable(
  'episodes',
  {
    id: idColumn(),
    projectId: projectIdColumn().references(() => projects.id, { onDelete: 'cascade' }),
    /** `ep_NNN`. A routing handle, not a key. Re-issuable. */
    slug: text('slug').notNull(),
    /** 1-based running order. Moves when episodes are reordered; the id does not. */
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    /**
     * The colour of the current production draft.
     *
     * AGENTS.md, UI fidelity: revision colours "are industry artefacts, not
     * palette tokens, and must survive a theme switch intact." Stored as the
     * value `@folio/script` defines. Never a token name.
     */
    revisionColour: revisionColourEnum('revision_colour').notNull().default('white'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('episodes_project_slug_key').on(table.projectId, table.slug),
    uniqueIndex('episodes_project_ordinal_key').on(table.projectId, table.ordinal),
    check('episodes_slug_shape', sql`${table.slug} ~ '^ep_[0-9]{3,}$'`),
    check('episodes_ordinal_positive', sql`${table.ordinal} >= 1`),
  ],
)
