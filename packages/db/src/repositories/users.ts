import type { ProjectCard, User, UserId } from '@folio/contracts'
import { userId as brandUserId } from '@folio/contracts'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { FolioDatabase } from '../client'
import { measurements, memberships, projects, sceneDerivations, users } from '../schema'
import { stamp, stampOrNull } from './mapping'
import { toProject } from './projects'

/**
 * The one repository that is not project-scoped, and why that is not a hole.
 *
 * AGENTS.md, Tenancy and data access: "Every table carries `project_id`. Every
 * query is tenant-scoped." `users` carries none, because a person exists before
 * they belong to a project and belongs to many. That is a real exception and it
 * is the only one.
 *
 * The exception is contained rather than waved through. Every function here
 * takes a `UserId` and scopes to **that person** - which is the same shape of
 * guarantee, with the actor as the tenant instead of the project. There is no
 * `listAllUsers`, no `readUserByEmail` and no unfiltered select anywhere in
 * this file.
 *
 * These functions take a raw `FolioDatabase` rather than a `ProjectScope`,
 * because the project is what they are looking for. That is exactly the
 * loophole a careless version of this file would become, so the rule is
 * written down: **a function belongs here only if its answer is "for this
 * person", and it must take the `UserId` it filters on.**
 */

const toUser = (row: typeof users.$inferSelect): User => ({
  id: brandUserId(row.id),
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  createdAt: stamp(row.createdAt),
  updatedAt: stamp(row.updatedAt),
})

/** One person's profile. */
export const readUser = async (db: FolioDatabase, id: UserId): Promise<User | null> => {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const row = rows[0]
  return row === undefined ? null : toUser(row)
}

/**
 * Create or refresh our profile row for a Supabase auth user.
 *
 * `id` is the `auth.users` id - one person, one id.
 *
 * The display name and avatar are refreshed on every sign-in rather than being
 * editable, because there is no settings page yet. For a Google account they
 * come from the OAuth claims. For an email + password account there are no
 * claims at all - `auth.users` carries an address and nothing else - so the
 * caller derives a provisional name from the address; see
 * `apps/web/lib/auth/identity.ts`, which is where that product decision is
 * written down and can be argued with.
 *
 * (AGENTS.md, Constraints said "Google OAuth only" when this was written. It
 * was rewritten when auth was built: email + password exists, with confirmation
 * and reset through Supabase's built-in sender.)
 */
export const upsertUser = async (
  db: FolioDatabase,
  input: {
    readonly id: UserId
    readonly email: string
    readonly displayName: string
    readonly avatarUrl: string | null
  },
): Promise<User> => {
  const inserted = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning()
  const row = inserted[0]
  if (row === undefined) {
    throw new Error('Folio: upserting a user returned no row. This is a bug in the repository.')
  }
  return toUser(row)
}

/**
 * The project list, as `/app/filmmaking` renders it.
 *
 * The design README: project cards show "**real derived metadata** - episode,
 * scene and page counts, last edited - never a placeholder string. If a project
 * has no script, the card says so."
 *
 * So the counts are assembled here from the derived and measurement tables
 * rather than read from columns on `projects` - there are no such columns, and
 * a `page_count` there would be the fastest way to make this card lie.
 *
 * `pages` is `null`, not `0`, when nothing has been measured. AGENTS.md, UI
 * fidelity: "things that legitimately count to zero show `0`; things that
 * either exist or don't show `—`". The two states of the card are exactly that
 * distinction, so the repository has to preserve it rather than coalescing.
 *
 * Trashed projects are excluded. Restoring one is a separate surface that does
 * not exist yet.
 */
export const listProjectsFor = async (
  db: FolioDatabase,
  userId: UserId,
): Promise<readonly ProjectCard[]> => {
  const rows = await db
    .select({ project: projects })
    .from(memberships)
    .innerJoin(projects, eq(projects.id, memberships.projectId))
    .where(and(eq(memberships.userId, userId), isNull(projects.trashedAt)))
    .orderBy(desc(projects.updatedAt))

  const cards: ProjectCard[] = []
  for (const row of rows) {
    const project = toProject(row.project)

    const episodeRows = await db
      .select({ id: measurements.episodeId })
      .from(measurements)
      .where(eq(measurements.projectId, row.project.id))

    const sceneRows = await db
      .select({ id: sceneDerivations.sceneNodeId })
      .from(sceneDerivations)
      .where(
        and(
          eq(sceneDerivations.projectId, row.project.id),
          eq(sceneDerivations.presence, 'present'),
        ),
      )

    const pageRows = await db
      .select({ totalPages: measurements.totalPages })
      .from(measurements)
      .where(eq(measurements.projectId, row.project.id))

    const pages =
      pageRows.length === 0
        ? null
        : pageRows.reduce((total, page) => total + page.totalPages, 0)

    cards.push({
      project,
      episodes: new Set(episodeRows.map((episode) => episode.id)).size,
      scenes: sceneRows.length,
      pages,
      lastEditedAt: stampOrNull(row.project.updatedAt),
    })
  }
  return cards
}
