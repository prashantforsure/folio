import type { Episode, EpisodeId, EpisodeSlug, Membership, Project, UserId } from '@folio/contracts'
import { episodeId as brandEpisodeId, formatEpisodeSlug, projectId as brandProjectId } from '@folio/contracts'
import { asc, eq, isNull } from 'drizzle-orm'

import { episodes, memberships, projects, users } from '../schema'
import { dbOf, scoped, tenant } from '../scope'
import type { ProjectScope } from '../scope'
import { stamp, stampOrNull } from './mapping'

/**
 * Projects, memberships and episodes.
 *
 * Every function takes a `ProjectScope` first. That is not a convention - a
 * scope cannot be constructed outside `scope.ts`, so there is no value a caller
 * could pass instead, and omitting it is a missing argument. See
 * `../scope-guarantees.ts` for the compile-time proof.
 *
 * Note that even `readProject` is scoped. Reading "the project this scope is
 * for" is the only read this package offers, because a repository that could
 * fetch *any* project by id would be a repository that could fetch someone
 * else's. Listing the projects a person may see is a different question with a
 * different answer, and it lives in `users.ts` where the actor, not the project,
 * is the scope.
 */

type ProjectRow = typeof projects.$inferSelect
type EpisodeRow = typeof episodes.$inferSelect
type MembershipRow = typeof memberships.$inferSelect

export const toProject = (row: ProjectRow): Project => ({
  id: brandProjectId(row.id),
  title: row.title,
  kind: row.kind,
  tags: row.tags,
  createdBy: row.createdBy as UserId,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
  trashedAt: stampOrNull(row.trashedAt),
})

export const toEpisode = (row: EpisodeRow): Episode => ({
  id: brandEpisodeId(row.id),
  projectId: brandProjectId(row.projectId),
  slug: row.slug as EpisodeSlug,
  ordinal: row.ordinal,
  title: row.title,
  revisionColour: row.revisionColour,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

const toMembership = (row: MembershipRow): Membership => ({
  id: row.id as Membership['id'],
  projectId: brandProjectId(row.projectId),
  userId: row.userId as UserId,
  role: row.role,
  invitedVia: row.invitedVia,
  createdAt: stamp(row.createdAt),
})

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** The project this scope is for, or null if it is trashed or gone. */
export const readProject = async (scope: ProjectScope): Promise<Project | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(projects)
    .where(scoped(scope, projects, isNull(projects.trashedAt)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toProject(row)
}

export const renameProject = async (scope: ProjectScope, title: string): Promise<void> => {
  await dbOf(scope)
    .update(projects)
    .set({ title, updatedAt: new Date() })
    .where(scoped(scope, projects))
}

/**
 * Soft delete. AGENTS.md, When to ask first: deleting user data needs a
 * question, so nothing here issues a `DELETE`. `credit_ledger` also references
 * `projects` with `ON DELETE restrict`, which means a project with any billing
 * history cannot be hard-deleted even by hand.
 */
export const trashProject = async (scope: ProjectScope): Promise<void> => {
  const now = new Date()
  await dbOf(scope)
    .update(projects)
    .set({ trashedAt: now, updatedAt: now })
    .where(scoped(scope, projects))
}

export const restoreProject = async (scope: ProjectScope): Promise<void> => {
  await dbOf(scope)
    .update(projects)
    .set({ trashedAt: null, updatedAt: new Date() })
    .where(scoped(scope, projects))
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export const listMemberships = async (scope: ProjectScope): Promise<readonly Membership[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(memberships)
    .where(scoped(scope, memberships))
    .orderBy(asc(memberships.createdAt))
  return rows.map(toMembership)
}

/**
 * Add somebody, or leave an existing membership alone.
 *
 * `onConflictDoNothing` rather than an upsert: a share link opened twice must
 * not silently change the role of someone who is already in the project. That
 * is a change somebody has to make deliberately.
 */
export const addMembership = async (
  scope: ProjectScope,
  userId: UserId,
  role: Membership['role'],
  invitedVia: Membership['invitedVia'],
): Promise<void> => {
  await dbOf(scope)
    .insert(memberships)
    .values({ ...tenant(scope), userId, role, invitedVia })
    .onConflictDoNothing({ target: [memberships.projectId, memberships.userId] })
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/**
 * Every episode, in running order.
 *
 * Ordered by `ordinal`, not by `slug`. They agree today and are allowed to stop
 * agreeing - that is the whole point of `docs/adr/0002-episode-identity.md`,
 * where the slug is a re-issuable routing handle and the ordinal is the running
 * order. Sorting by the slug would quietly make the slug authoritative again.
 */
export const listEpisodes = async (scope: ProjectScope): Promise<readonly Episode[]> => {
  const rows = await dbOf(scope)
    .select()
    .from(episodes)
    .where(scoped(scope, episodes))
    .orderBy(asc(episodes.ordinal))
  return rows.map(toEpisode)
}

/**
 * Resolve the `ep_NNN` in a URL to an episode.
 *
 * The only sanctioned way a slug becomes a key. AGENTS.md, Routing requires
 * every episode id in a path to be validated, and this is where an unknown one
 * becomes `null` rather than a 500.
 */
export const readEpisodeBySlug = async (
  scope: ProjectScope,
  slug: EpisodeSlug,
): Promise<Episode | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(episodes)
    .where(scoped(scope, episodes, eq(episodes.slug, slug)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toEpisode(row)
}

export const readEpisode = async (
  scope: ProjectScope,
  id: EpisodeId,
): Promise<Episode | null> => {
  const rows = await dbOf(scope)
    .select()
    .from(episodes)
    .where(scoped(scope, episodes, eq(episodes.id, id)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : toEpisode(row)
}

/**
 * Add an episode at the end.
 *
 * **A film gets exactly one of these, at creation.** AGENTS.md, Routing: the
 * router hides the segment; the schema never special-cases it. Nothing in this
 * function knows the project's kind, and that is deliberate - the moment an
 * episode is optional, every episode-scoped join grows a null branch.
 *
 * The slug is generated from the ordinal at creation and is not regenerated
 * afterwards. Reordering moves `ordinal`; the slug and the id both stay put,
 * which is the behaviour the ADR is arguing for.
 */
export const appendEpisode = async (
  scope: ProjectScope,
  title: string,
): Promise<Episode> => {
  const db = dbOf(scope)
  const existing = await db
    .select({ ordinal: episodes.ordinal })
    .from(episodes)
    .where(scoped(scope, episodes))
    .orderBy(asc(episodes.ordinal))
  const next = (existing.at(-1)?.ordinal ?? 0) + 1
  const inserted = await db
    .insert(episodes)
    .values({
      ...tenant(scope),
      slug: formatEpisodeSlug(next),
      ordinal: next,
      title,
    })
    .returning()
  const row = inserted[0]
  if (row === undefined) {
    throw new Error('Folio: inserting an episode returned no row. This is a bug in the repository.')
  }
  return toEpisode(row)
}

/**
 * `users` is reachable from here only to name a project's members.
 *
 * It is exported as a table reference rather than a query because the scoped
 * machinery cannot take it - `users` has no `project_id`, so it is not a
 * `ProjectScopedTable`. Joining to it from a scoped query is fine, because the
 * scoped side is what limits the rows.
 */
export const listMemberProfiles = async (
  scope: ProjectScope,
): Promise<readonly { readonly userId: UserId; readonly displayName: string; readonly email: string }[]> => {
  const rows = await dbOf(scope)
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(scoped(scope, memberships))
    .orderBy(asc(users.displayName))
  return rows.map((row) => ({
    userId: row.userId as UserId,
    displayName: row.displayName,
    email: row.email,
  }))
}
